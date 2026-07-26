const CODE_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

function normalizeInviteCode(value) {
  return String(value || '').trim().toUpperCase();
}

function validInviteCode(value) {
  return CODE_PATTERN.test(normalizeInviteCode(value));
}

function extractLaunchInvite(options) {
  const query = (options && options.query) || {};
  const direct = normalizeInviteCode(query.invite || query.invite_code);
  if (validInviteCode(direct)) return direct;

  let scene = '';
  try {
    scene = decodeURIComponent(String(query.scene || ''));
  } catch (_) {
    scene = String(query.scene || '');
  }
  const match = scene.match(/(?:^|[?&])(?:invite|invite_code)=([^&]+)/i);
  const candidate = normalizeInviteCode(match ? match[1] : scene);
  return validInviteCode(candidate) ? candidate : '';
}

function registrationSharePath(code) {
  const normalized = normalizeInviteCode(code);
  return validInviteCode(normalized)
    ? '/pages/login/login?invite=' + encodeURIComponent(normalized)
    : '/pages/login/login';
}

module.exports = { normalizeInviteCode, validInviteCode, extractLaunchInvite, registrationSharePath };
