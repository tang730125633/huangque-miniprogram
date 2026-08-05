const invite = require('./invite.js');
const api = require('./api.js');
const inviteContext = require('./invite-context.js');
const ATTRIBUTION_KEY = inviteContext.STORAGE_KEY;
const ATTRIBUTION_TTL = inviteContext.ATTRIBUTION_TTL;
const DEFAULT_SHARE_IMAGE = '/assets/share/invite-card.jpg';
const SHARE_CANVAS_ID = 'cardShareCover';

function privacy(card) {
  const source = (card && card.privacy) || {};
  return {
    phone: !!source.phone,
    email: !!source.email,
    address: !!source.address,
    wechat_qr: !!source.wechat_qr
  };
}

function workSlots(works) {
  const groups = { image: [], video: [] };
  const other = [];
  (Array.isArray(works) ? works : []).forEach((item) => {
    if (item && typeof item === 'object' && !Array.isArray(item) && (item.type === 'image' || item.type === 'video')) groups[item.type].push(item);
    else other.push(item);
  });
  const slots = (type, limit) => {
    const result = Array.from({ length: 3 }, (_, index) => ({ type, slot: index + 1, title: '' }));
    const used = {};
    groups[type].forEach((item) => {
      let index = Number(item.slot) - 1;
      if (!Number.isInteger(index) || index < 0 || index > 2 || used[index]) index = result.findIndex((_, slot) => !used[slot]);
      if (index >= 0) {
        used[index] = true;
        result[index] = Object.assign({}, item, { type, slot: index + 1, title: String(item.title || '').trim().slice(0, limit) });
      }
    });
    return result;
  };
  return { images: slots('image', 12), videos: slots('video', 16), other };
}

function worksPayload(images, videos, other) {
  const visible = [].concat(images || [], videos || []).map((item) => {
    if (!item || typeof item !== 'object') return item;
    const clean = Object.assign({}, item);
    if (clean.key || !/^https:\/\//.test(String(clean.url || ''))) delete clean.url;
    return clean;
  }).filter((item) => item && (item.title || item.key || item.url || item.cover_key || item.poster));
  return visible.concat(Array.isArray(other) ? other : []);
}

function cardPayload(card) {
  card = card || {};
  const payload = {
    name: String(card.name || '').trim(), title: String(card.title || '').trim(),
    company: String(card.company || '').trim(), bio: String(card.bio || '').trim(), tags: String(card.tags || '').trim(),
    links: String(card.links || '').trim(), email: String(card.email || '').trim(), address: String(card.address || '').trim(),
    phone: String(card.phone || '').trim(), privacy: privacy(card)
  };
  if (Object.prototype.hasOwnProperty.call(card, 'works')) payload.works = Array.isArray(card.works) ? card.works : [];
  return payload;
}

function isComplete(card) {
  const value = cardPayload(card);
  return !!(value.name && value.title && value.company && validPhone(value.phone));
}

function validPhone(value) {
  return /^1[3-9]\d{9}$/.test(String(value || '').trim());
}

function wechatLoginCode() {
  return new Promise((resolve, reject) => {
    wx.login({
      timeout: 10000,
      success(result) {
        if (result && result.code) resolve(result.code);
        else reject(new Error('未获取到微信授权凭证'));
      },
      fail: reject
    });
  });
}

function loginCardSession() {
  return wechatLoginCode().then((code) => api.request('/api/auth/miniprogram/card-session', {
    method: 'POST', auth: false, data: { wx_code: code }
  })).then((res) => {
    const data = res.data || {};
    if (res.statusCode === 404 && data.code === 'card_unbound') {
      api.clearCardToken();
      if (api.getToken() && api.hasCardBindIntent()) return { state: 'pending-bind', data: {} };
      return { state: 'guest', data: {} };
    }
    if (res.statusCode !== 200 || !data.card_token) throw new Error(data.detail || '微信名片登录失败');
    api.setCardToken(data.card_token);
    api.clearCardBindIntent();
    return { state: 'owner', data };
  });
}

function loginCardAccount() {
  return loginCardSession().then((session) => {
    if (session.state !== 'owner') throw new Error('当前微信还没有绑定名片账号');
    return api.request('/api/auth/miniprogram/card-account-login', { method: 'POST', cardAuth: true });
  }).then((res) => {
    const data = res.data || {};
    if (res.statusCode !== 200 || !data.token) throw new Error(data.detail || '名片账号登录失败');
    api.setToken(data.token);
    return data;
  });
}

function isPublished(card) {
  return !!(card && (card.published === true || card.is_published === true || card.status === 'published'));
}

function rememberValidInvite(code, attributionToken, expiresAt, serverValidatedAt) {
  return inviteContext.saveCard({
    code,
    attribution_token: attributionToken,
    expires_at: expiresAt,
    validated_at: serverValidatedAt
  });
}

function lastValidAttribution(now) {
  const record = inviteContext.current(now);
  return record && record.source === 'card'
    ? { code: record.code, attribution_token: record.attribution_token }
    : null;
}

function clearValidAttribution() {
  inviteContext.clear();
}

function lastValidInvite(now) {
  const attribution = lastValidAttribution(now);
  return attribution ? attribution.code : '';
}

function prepareShareImage(page, card) {
  const avatar = String((card && card.avatar) || '').trim();
  if (avatar) return Promise.resolve(avatar);

  const name = String((card && card.name) || '黄雀').trim() || '黄雀';
  return new Promise((resolve) => {
    if (!wx.createCanvasContext || !wx.canvasToTempFilePath) {
      resolve(DEFAULT_SHARE_IMAGE);
      return;
    }
    try {
      const context = wx.createCanvasContext(SHARE_CANVAS_ID, page);
      context.setFillStyle('#0b0912');
      context.fillRect(0, 0, 500, 400);
      context.setTextAlign('center');
      context.setTextBaseline('middle');
      context.setFillStyle('#f4a847');
      context.setFontSize(112);
      context.fillText(Array.from(name)[0], 250, 168);
      context.setFillStyle('#ffffff');
      context.setFontSize(Array.from(name).length > 8 ? 30 : 38);
      context.fillText(Array.from(name).slice(0, 12).join(''), 250, 292, 420);
      context.setFillStyle('#9f98b3');
      context.setFontSize(22);
      context.fillText('黄雀公开名片', 250, 352);
      context.draw(false, () => {
        wx.canvasToTempFilePath({
          canvasId: SHARE_CANVAS_ID,
          width: 500,
          height: 400,
          destWidth: 1000,
          destHeight: 800,
          fileType: 'jpg',
          quality: 0.92,
          success: (result) => resolve(result.tempFilePath || DEFAULT_SHARE_IMAGE),
          fail: () => resolve(DEFAULT_SHARE_IMAGE)
        }, page);
      });
    } catch (error) {
      resolve(DEFAULT_SHARE_IMAGE);
    }
  });
}

module.exports = {
  ATTRIBUTION_KEY, ATTRIBUTION_TTL, DEFAULT_SHARE_IMAGE,
  privacy, workSlots, worksPayload, cardPayload, isComplete, validPhone, wechatLoginCode, loginCardSession, loginCardAccount, isPublished, rememberValidInvite,
  lastValidAttribution, lastValidInvite, clearValidAttribution, prepareShareImage
};
