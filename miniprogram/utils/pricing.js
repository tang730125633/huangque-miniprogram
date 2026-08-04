const api = require('./api.js');

const REFRESH_MS = 30000;
let inFlight = null;

function parseCatalog(res) {
  const items = res && res.statusCode === 200 && res.data && res.data.items;
  if (!Array.isArray(items)) throw new Error('pricing_unavailable');
  const prices = {};
  items.forEach((item) => {
    const key = String(item && item.key || '').trim();
    const points = Number(item && item.points);
    if (key && Number.isInteger(points) && points > 0) prices[key] = points;
  });
  if (!Object.keys(prices).length) throw new Error('pricing_empty');
  return prices;
}

function load() {
  if (inFlight) return inFlight;
  inFlight = api.request('/api/gen/pricing', { method: 'GET', auth: false, timeout: 10000 })
    .then(parseCatalog)
    .finally(() => { inFlight = null; });
  return inFlight;
}

function point(prices, key) {
  const value = Number(prices && prices[key]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function lowest(prices, keys) {
  const values = (keys || []).map((key) => point(prices, key)).filter(Boolean);
  return values.length ? Math.min.apply(null, values) : null;
}

function commerce(prices) {
  return {
    inviteRewardPoints: point(prices, 'invite.card_trial_reward'),
    membershipPriceYuan: point(prices, 'membership.experience.price_yuan'),
    membershipBonusPoints: point(prices, 'membership.experience.bonus_points')
  };
}

function watch(page, onPrices, onError) {
  stop(page);
  const token = page._pricingWatchToken;
  const refresh = () => load().then((prices) => {
    if (page._pricingWatchToken === token) onPrices(prices);
  }).catch((error) => {
    if (page._pricingWatchToken === token && typeof onError === 'function') onError(error);
  });
  page._pricingRefresh = refresh;
  page._pricingTimer = setInterval(refresh, REFRESH_MS);
  if (page._pricingTimer && typeof page._pricingTimer.unref === 'function') page._pricingTimer.unref();
  return refresh();
}

function stop(page) {
  if (page && page._pricingTimer) clearInterval(page._pricingTimer);
  if (page) {
    page._pricingWatchToken = Number(page._pricingWatchToken || 0) + 1;
    page._pricingTimer = null;
    page._pricingRefresh = null;
  }
}

function confirm(shownCost, calculate) {
  return load().then((prices) => {
    const cost = Number(calculate(prices));
    if (!Number.isInteger(cost) || cost < 1) throw new Error('pricing_incomplete');
    return { prices, cost, changed: Number(shownCost) !== cost };
  });
}

module.exports = { REFRESH_MS, load, point, lowest, commerce, watch, stop, confirm };
