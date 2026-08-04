const assert = require('assert');

let catalog = { 'audio.tts': 10, 'video.grok.v1.480p': 12, 'invite.card_trial_reward': 88, 'membership.experience.price_yuan': 399, 'membership.experience.bonus_points': 900 };
global.getApp = () => ({ globalData: { apiBase: 'https://example.test' } });
global.getCurrentPages = () => [];
global.wx = {
  getStorageSync: () => '',
  request: (options) => options.success({
    statusCode: 200,
    data: { items: Object.keys(catalog).map((key) => ({ key, points: catalog[key] })) }
  })
};

const pricing = require('../miniprogram/utils/pricing.js');

(async function run() {
  const first = await pricing.load();
  assert.strictEqual(pricing.point(first, 'audio.tts'), 10);
  assert.strictEqual(pricing.lowest(first, ['audio.tts', 'video.grok.v1.480p']), 10);
  assert.deepStrictEqual(pricing.commerce(first), { inviteRewardPoints: 88, membershipPriceYuan: 399, membershipBonusPoints: 900 });

  catalog = { 'audio.tts': 14, 'video.grok.v1.480p': 12 };
  const latest = await pricing.confirm(10, (prices) => pricing.point(prices, 'audio.tts'));
  assert.deepStrictEqual({ cost: latest.cost, changed: latest.changed }, { cost: 14, changed: true });

  catalog = { 'video.grok.v1.480p': 12 };
  await assert.rejects(
    pricing.confirm(14, (prices) => pricing.point(prices, 'audio.tts')),
    /pricing_incomplete/
  );

  catalog = { 'audio.tts': 14, 'video.grok.v1.480p': 12 };
  const page = {};
  let watched;
  await pricing.watch(page, (prices) => { watched = pricing.point(prices, 'audio.tts'); });
  assert.strictEqual(watched, 14);
  assert.ok(page._pricingTimer);
  pricing.stop(page);
  assert.strictEqual(page._pricingTimer, null);

  console.log('dynamic pricing tests passed');
})().catch((error) => { console.error(error); process.exit(1); });
