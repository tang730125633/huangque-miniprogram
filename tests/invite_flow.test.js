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
assert.strictEqual(
  invite.registrationSharePath('abcd23'),
  '/pages/login/login?invite=ABCD23'
);
assert.strictEqual(invite.registrationSharePath('invalid'), '/pages/login/login');

const root = path.resolve(__dirname, '..');
const appJson = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/app.json'), 'utf8'));
const loginJs = fs.readFileSync(path.join(root, 'miniprogram/pages/login/login.js'), 'utf8');
const loginWxml = fs.readFileSync(path.join(root, 'miniprogram/pages/login/login.wxml'), 'utf8');
const profileWxml = fs.readFileSync(path.join(root, 'miniprogram/pages/profile/profile.wxml'), 'utf8');
const inviteJs = fs.readFileSync(path.join(root, 'miniprogram/pages/invite/invite.js'), 'utf8');
const inviteWxml = fs.readFileSync(path.join(root, 'miniprogram/pages/invite/invite.wxml'), 'utf8');

assert.ok(appJson.pages.includes('pages/invite/invite'));
assert.match(loginJs, /device_id: device\.getDeviceId\(\)/);
assert.doesNotMatch(loginJs, /miniprogram-register|invite_code/);
assert.doesNotMatch(loginWxml, /邀请码（选填）|注册并登录/);
assert.match(loginWxml, /先创建我的名片/);
assert.match(profileWxml, /邀请中心/);
assert.match(inviteJs, /\/api\/auth\/invite\/dashboard/);
assert.match(inviteJs, /\/api\/auth\/invite\/downlines/);
assert.match(inviteJs, /\/api\/auth\/invite\/referrer/);
assert.match(inviteJs, /\/api\/auth\/card\/me/);
assert.match(inviteJs, /onShareAppMessage\(\)/);
assert.match(inviteJs, /invite\.cardSharePath\(this\.data\.publicId, this\.data\.code\)/);
assert.match(inviteJs, /cardUtil\.isPublished\(card\)/);
assert.match(inviteJs, /invite\.validInviteCode\(code\.code\)/);
assert.match(inviteJs, /wx\.hideShareMenu\(\)/);
assert.match(inviteJs, /wx\.showShareMenu\(\{ menus: \['shareAppMessage'\] \}\)/);
assert.match(inviteJs, /registrationSharePath\(this\.data\.code\)/);
assert.match(inviteJs, /prepareShareImage\(this, card\)/);
assert.match(inviteJs, /imageUrl:\s*this\.data\.shareImageUrl/);
assert.match(inviteWxml, /open-type="share"/);
assert.match(inviteWxml, /shareReady/);
assert.match(inviteWxml, /分享我的名片，邀请好友/);
assert.match(inviteWxml, /打开微信好友列表/);
assert.doesNotMatch(inviteWxml, /bindtap="copyLink"/);
assert.ok(fs.existsSync(path.join(root, 'miniprogram/assets/share/invite-card.jpg')));

let invitePage;
global.Page = function (definition) { invitePage = definition; };
global.wx = { hideShareMenu() {}, showShareMenu() {} };
require('../miniprogram/pages/invite/invite.js');
assert.strictEqual(invitePage.onShareAppMessage.call({ data: { shareReady: false, code: 'ABCD23' } }).path, '/pages/login/login?invite=ABCD23');
const share = invitePage.onShareAppMessage.call({ data: { shareReady: true, shareImageUrl: 'https://example.test/avatar.jpg', code: 'ABCD23', publicId: 'public-1', cardName: '王小明' } });
assert.strictEqual(share.path, '/pages/card/card?id=public-1&invite=ABCD23');
assert.strictEqual(share.imageUrl, 'https://example.test/avatar.jpg');

require('node:test')('share cover uses avatar, then falls back to a generated name image', async () => {
  assert.strictEqual(await require('../miniprogram/utils/card.js').prepareShareImage({}, { avatar: 'https://example.test/avatar.jpg', name: '王小明' }), 'https://example.test/avatar.jpg');
  const text = [];
  global.wx.createCanvasContext = function () {
    return {
      setFillStyle() {}, fillRect() {}, setTextAlign() {}, setTextBaseline() {}, setFontSize() {},
      fillText(value) { text.push(value); }, draw(reserve, callback) { callback(); }
    };
  };
  global.wx.canvasToTempFilePath = function (options) { options.success({ tempFilePath: '/tmp/share-name.jpg' }); };
  assert.strictEqual(await require('../miniprogram/utils/card.js').prepareShareImage({}, { name: '王小明' }), '/tmp/share-name.jpg');
  assert.ok(text.includes('王小明'));
});

require('node:test')('stale share cover cannot overwrite a newer invite load', async () => {
  const cardUtil = require('../miniprogram/utils/card.js');
  const original = cardUtil.prepareShareImage;
  let finish;
  cardUtil.prepareShareImage = function () { return new Promise((resolve) => { finish = resolve; }); };
  let updated = false;
  const page = { _loadId: 2, setData() { updated = true; } };
  const pending = invitePage.enableShare.call(page, { name: '旧名片' }, 1);
  finish('/tmp/old-share.jpg');
  await pending;
  cardUtil.prepareShareImage = original;
  assert.strictEqual(updated, false);
});

console.log('invite flow tests passed');
