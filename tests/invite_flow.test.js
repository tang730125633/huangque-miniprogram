const assert = require('assert');
const fs = require('fs');
const path = require('path');
const invite = require('../miniprogram/utils/invite.js');

assert.strictEqual(invite.normalizeInviteCode(' abcd23 '), 'ABCD23');
assert.strictEqual(invite.validInviteCode('ABCD23'), true);
assert.strictEqual(invite.validInviteCode('ABC010'), false);
assert.strictEqual(
  invite.extractLaunchInvite({ query: { invite: 'ABCD23' } }),
  'ABCD23'
);
assert.strictEqual(
  invite.extractLaunchInvite({ query: { scene: encodeURIComponent('invite=ABCD23') } }),
  'ABCD23'
);

const root = path.resolve(__dirname, '..');
const appJson = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/app.json'), 'utf8'));
const loginJs = fs.readFileSync(path.join(root, 'miniprogram/pages/login/login.js'), 'utf8');
const loginWxml = fs.readFileSync(path.join(root, 'miniprogram/pages/login/login.wxml'), 'utf8');
const profileWxml = fs.readFileSync(path.join(root, 'miniprogram/pages/profile/profile.wxml'), 'utf8');
const inviteJs = fs.readFileSync(path.join(root, 'miniprogram/pages/invite/invite.js'), 'utf8');

assert.ok(appJson.pages.includes('pages/invite/invite'));
assert.match(loginJs, /payload\.invite_code = inviteCode/);
assert.match(loginJs, /device_id: device\.getDeviceId\(\)/);
assert.match(loginWxml, /邀请码（选填）/);
assert.match(profileWxml, /邀请中心/);
assert.match(inviteJs, /\/api\/auth\/invite\/dashboard/);
assert.match(inviteJs, /\/api\/auth\/invite\/reward-points/);
assert.match(inviteJs, /\/api\/auth\/invite\/referrer/);

console.log('invite flow tests passed');
