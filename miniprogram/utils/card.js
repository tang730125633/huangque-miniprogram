const invite = require('./invite.js');
const ATTRIBUTION_KEY = 'hq_card_last_valid_invite';
const ATTRIBUTION_TTL = 7 * 24 * 60 * 60 * 1000;
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

function cardPayload(card) {
  card = card || {};
  return {
    name: String(card.name || '').trim(), title: String(card.title || '').trim(),
    company: String(card.company || '').trim(), bio: String(card.bio || '').trim(), tags: String(card.tags || '').trim(),
    links: String(card.links || '').trim(), email: String(card.email || '').trim(), address: String(card.address || '').trim(),
    phone: String(card.phone || '').trim(), privacy: privacy(card)
  };
}

function isComplete(card) {
  const value = cardPayload(card);
  return !!(value.name && value.title && value.company);
}

function isPublished(card) {
  return !!(card && (card.published === true || card.is_published === true || card.status === 'published'));
}

function serverTime(value) {
  let time = Number(value);
  if (time > 0 && time < 100000000000) time *= 1000;
  if (!time && value) time = Date.parse(value);
  return time || 0;
}

function rememberValidInvite(code, attributionToken, expiresAt, serverValidatedAt) {
  code = invite.normalizeInviteCode(code);
  if (!invite.validInviteCode(code) || !attributionToken) return false;
  // 服务端是否有效是归因门槛；本地只缓存其已确认结果，便于注册请求携带。
  const validatedAt = serverTime(serverValidatedAt);
  const serverExpires = serverTime(expiresAt);
  const expires = validatedAt ? Math.min(serverExpires || (validatedAt + ATTRIBUTION_TTL), validatedAt + ATTRIBUTION_TTL) : serverExpires;
  if (!expires) return false;
  wx.setStorageSync(ATTRIBUTION_KEY, { code: code, attribution_token: String(attributionToken), expires_at: expires, validated_at: validatedAt });
  return true;
}

function lastValidAttribution(now) {
  const record = wx.getStorageSync(ATTRIBUTION_KEY) || {};
  if (!invite.validInviteCode(record.code) || !record.attribution_token || !Number(record.expires_at) || Number(now || Date.now()) > Number(record.expires_at)) {
    wx.removeStorageSync(ATTRIBUTION_KEY);
    return null;
  }
  return { code: record.code, attribution_token: record.attribution_token };
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
  privacy, cardPayload, isComplete, isPublished, rememberValidInvite,
  lastValidAttribution, lastValidInvite, prepareShareImage
};
