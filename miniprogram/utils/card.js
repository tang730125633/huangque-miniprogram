const invite = require('./invite.js');
const ATTRIBUTION_KEY = 'hq_card_last_valid_invite';
const ATTRIBUTION_TTL = 7 * 24 * 60 * 60 * 1000;

function privacy(card) {
  const source = (card && card.privacy) || {};
  return {
    phone: !!source.phone,
    email: !!source.email,
    address: !!source.address,
    wechat_qr: !!source.wechat_qr
  };
}

function cardPayload(card) {
  card = card || {};
  return {
    avatar: String(card.avatar || ''), name: String(card.name || '').trim(), title: String(card.title || '').trim(),
    company: String(card.company || '').trim(), bio: String(card.bio || '').trim(), tags: String(card.tags || '').trim(),
    links: String(card.links || '').trim(), email: String(card.email || '').trim(), address: String(card.address || '').trim(),
    phone: String(card.phone || '').trim(), wechat_qr: String(card.wechat_qr || ''), privacy: privacy(card)
  };
}

function isComplete(card) {
  const value = cardPayload(card);
  return !!(value.name && value.title && value.company);
}

function rememberValidInvite(code, serverValidatedAt) {
  code = invite.normalizeInviteCode(code);
  if (!invite.validInviteCode(code)) return false;
  // 服务端是否有效是归因门槛；本地只缓存其已确认结果，便于注册请求携带。
  let validatedAt = Number(serverValidatedAt);
  if (validatedAt > 0 && validatedAt < 100000000000) validatedAt *= 1000;
  if (!validatedAt && serverValidatedAt) validatedAt = Date.parse(serverValidatedAt);
  wx.setStorageSync(ATTRIBUTION_KEY, { code: code, validated_at: validatedAt || Date.now() });
  return true;
}

function lastValidInvite(now) {
  const record = wx.getStorageSync(ATTRIBUTION_KEY) || {};
  const validAt = Number(record.validated_at || 0);
  if (!invite.validInviteCode(record.code) || !validAt || Number(now || Date.now()) - validAt > ATTRIBUTION_TTL) {
    wx.removeStorageSync(ATTRIBUTION_KEY);
    return '';
  }
  return record.code;
}

module.exports = { ATTRIBUTION_KEY, ATTRIBUTION_TTL, privacy, cardPayload, isComplete, rememberValidInvite, lastValidInvite };
