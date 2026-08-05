const invite = require('./invite.js');

const STORAGE_KEY = 'hq_pending_registration_invite';
const ATTRIBUTION_TTL = 7 * 24 * 60 * 60 * 1000;

function toMillis(value) {
  let number = Number(value || 0);
  if (number > 0 && number < 100000000000) number *= 1000;
  return Number.isFinite(number) ? number : 0;
}

function inviterView(value) {
  value = value && typeof value === 'object' ? value : {};
  return {
    name: String(value.name || '').trim(),
    account_id: String(value.account_id || '').trim()
  };
}

function normalized(source, value) {
  value = value && typeof value === 'object' ? value : {};
  const code = invite.normalizeInviteCode(value.code || value.invite_code);
  const validatedAt = toMillis(value.validated_at || value.invite_validated_at || value.server_time);
  const serverExpires = toMillis(value.expires_at || value.invite_expires_at);
  const expiresAt = validatedAt
    ? Math.min(serverExpires || (validatedAt + ATTRIBUTION_TTL), validatedAt + ATTRIBUTION_TTL)
    : 0;
  const attributionToken = String(value.attribution_token || value.invite_attribution_token || '').trim();
  if (!invite.validInviteCode(code) || !validatedAt || !expiresAt || expiresAt <= validatedAt) return null;
  if (source === 'card' && !attributionToken) return null;
  if (source !== 'link' && source !== 'card') return null;
  return {
    source,
    code,
    inviter: inviterView(value.inviter),
    attribution_token: source === 'card' ? attributionToken : '',
    validated_at: validatedAt,
    expires_at: expiresAt
  };
}

function stored(value) {
  value = value && typeof value === 'object' ? value : {};
  const source = value.source;
  const code = invite.normalizeInviteCode(value.code);
  const attributionToken = String(value.attribution_token || '').trim();
  const validatedAt = Number(value.validated_at || 0);
  const expiresAt = Number(value.expires_at || 0);
  if (!invite.validInviteCode(code) || !Number.isFinite(validatedAt) || !Number.isFinite(expiresAt)) return null;
  if (!validatedAt || expiresAt <= validatedAt) return null;
  if (source === 'card' && !attributionToken) return null;
  if (source !== 'link' && source !== 'card') return null;
  return {
    source,
    code,
    inviter: inviterView(value.inviter),
    attribution_token: source === 'card' ? attributionToken : '',
    validated_at: validatedAt,
    expires_at: expiresAt
  };
}

function write(record) {
  try {
    wx.setStorageSync(STORAGE_KEY, record);
    return true;
  } catch (_) {
    return false;
  }
}

function saveLink(value) {
  const record = normalized('link', value);
  return record ? write(record) : false;
}

function saveCard(value) {
  const record = normalized('card', value);
  return record ? write(record) : false;
}

function clear() {
  try { wx.removeStorageSync(STORAGE_KEY); } catch (_) {}
}

function current(now) {
  let raw;
  try { raw = wx.getStorageSync(STORAGE_KEY); } catch (_) { raw = null; }
  const record = stored(raw);
  if (!record || Number(now || Date.now()) > record.expires_at) {
    clear();
    return null;
  }
  return record;
}

function registrationPayload(now) {
  const record = current(now);
  if (!record) return {};
  const payload = { invite_code: record.code };
  if (record.source === 'card') payload.invite_attribution_token = record.attribution_token;
  return payload;
}

module.exports = {
  STORAGE_KEY, ATTRIBUTION_TTL,
  saveLink, saveCard, current, registrationPayload, clear
};
