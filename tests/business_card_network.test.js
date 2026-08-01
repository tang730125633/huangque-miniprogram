const assert = require('assert');
const fs = require('fs');
const path = require('path');

const store = {};
global.wx = {
  getStorageSync(key) { return store[key]; },
  setStorageSync(key, value) { store[key] = value; },
  removeStorageSync(key) { delete store[key]; }
};

const invite = require('../miniprogram/utils/invite.js');
const card = require('../miniprogram/utils/card.js');
assert.strictEqual(invite.cardSharePath('public-1', 'ABCD23'), '/pages/card/card?id=public-1&invite=ABCD23');
assert.strictEqual(invite.cardSharePath('', 'ABCD23'), '/pages/card/card');

const validatedAt = 1700000000000;
assert.strictEqual(card.rememberValidInvite('ABCD23', '', validatedAt + card.ATTRIBUTION_TTL, validatedAt), false);
assert.strictEqual(card.rememberValidInvite('ABCD23', 'server-token', validatedAt + card.ATTRIBUTION_TTL, validatedAt), true);
assert.deepStrictEqual(card.lastValidAttribution(validatedAt + card.ATTRIBUTION_TTL), { code: 'ABCD23', attribution_token: 'server-token' });
assert.strictEqual(card.lastValidInvite(validatedAt + card.ATTRIBUTION_TTL), 'ABCD23');
assert.strictEqual(card.lastValidAttribution(validatedAt + card.ATTRIBUTION_TTL + 1), null);
assert.strictEqual(card.rememberValidInvite('ABCD23', 'server-token', validatedAt + card.ATTRIBUTION_TTL * 2, validatedAt), true);
assert.strictEqual(store[card.ATTRIBUTION_KEY].expires_at, validatedAt + card.ATTRIBUTION_TTL);
assert.deepStrictEqual(card.privacy({}), { phone: false, email: false, address: false, wechat_qr: false });
assert.deepStrictEqual(card.privacy({ privacy: { phone: 1, email: true, address: 'yes', wechat_qr: false } }), { phone: true, email: true, address: true, wechat_qr: false });
assert.strictEqual(card.isComplete({ name: '王小明', title: '设计师', company: '黄雀' }), true);
assert.strictEqual(card.isPublished({ public_id: 'public-1', status: 'draft' }), false);
assert.strictEqual(card.isPublished({ public_id: 'public-1', is_published: false }), false);
assert.strictEqual(card.isPublished({ public_id: 'public-1', status: 'published' }), true);
assert.strictEqual(card.isPublished({ public_id: 'public-1', is_published: true }), true);
assert.deepStrictEqual(card.cardPayload({ avatar: 'signed-avatar', wechat_qr: 'signed-qr', name: '王小明' }), {
  name: '王小明', title: '', company: '', bio: '', tags: '', links: '', email: '', address: '', phone: '', privacy: { phone: false, email: false, address: false, wechat_qr: false }
});

global.Page = function () {};
const login = require('../miniprogram/pages/login/login.js');
const registration = login.buildRegistrationPayload('wang', 'secret', 'ABCD23', { name: '王小明', title: '设计师', company: '黄雀', privacy: { phone: true } });
assert.strictEqual(registration.invite_code, 'ABCD23');
assert.strictEqual(registration.card.name, '王小明');
assert.strictEqual(registration.display_name, '王小明');
assert.strictEqual(registration.card.privacy.phone, true);
assert.strictEqual(registration.card.privacy.email, false);

const recharge = require('../miniprogram/pages/recharge/recharge.js');
const experience = recharge.buildRechargeConfig({ membership_status: 'active', membership_active: true, membership_tier: 'experience' }, { items: [] });
assert.strictEqual(experience.packages[0].id, 'membership_experience_renewal');
assert.strictEqual(experience.packages[0].points, 0);
assert.deepStrictEqual(recharge.virtualPaymentPayload('membership_experience_renewal', 499, 'code'), {
  package_id: 'membership_experience_renewal', wx_code: 'code', product_type: 'membership_experience_renewal', order_type: 'membership_experience_renewal'
});
assert.strictEqual(recharge.EXPERIENCE_RENEWAL_PACKAGE.benefit.includes('1000'), false);
assert.strictEqual(recharge.buildRechargeConfig({ membership_status: 'active', membership_active: true, membership_tier: 'partner' }, { items: [] }).contactAdmin, true);

const root = path.resolve(__dirname, '..');
const appJson = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/app.json'), 'utf8'));
['pages/card/card', 'pages/card-edit/card-edit', 'pages/network/network'].forEach((page) => assert.ok(appJson.pages.includes(page)));
const publicCard = fs.readFileSync(path.join(root, 'miniprogram/pages/card/card.js'), 'utf8');
const publicCardWxml = fs.readFileSync(path.join(root, 'miniprogram/pages/card/card.wxml'), 'utf8');
const editCard = fs.readFileSync(path.join(root, 'miniprogram/pages/card-edit/card-edit.wxml'), 'utf8');
const editCardJs = fs.readFileSync(path.join(root, 'miniprogram/pages/card-edit/card-edit.js'), 'utf8');
const editCardWxss = fs.readFileSync(path.join(root, 'miniprogram/pages/card-edit/card-edit.wxss'), 'utf8');
const network = fs.readFileSync(path.join(root, 'miniprogram/pages/network/network.js'), 'utf8');
const networkWxml = fs.readFileSync(path.join(root, 'miniprogram/pages/network/network.wxml'), 'utf8');
const invitePage = fs.readFileSync(path.join(root, 'miniprogram/pages/invite/invite.js'), 'utf8');
const inviteWxml = fs.readFileSync(path.join(root, 'miniprogram/pages/invite/invite.wxml'), 'utf8');
const inviteWxss = fs.readFileSync(path.join(root, 'miniprogram/pages/invite/invite.wxss'), 'utf8');
const profilePage = fs.readFileSync(path.join(root, 'miniprogram/pages/profile/profile.js'), 'utf8');
assert.match(publicCard, /\/api\/auth\/card\/public/);
assert.match(publicCard, /data\.invite_valid === true/);
assert.match(publicCard, /rememberValidInvite/);
assert.match(publicCard, /invite_attribution_token/);
assert.match(publicCard, /imageUrl: '\/assets\/share\/invite-card\.jpg'/);
assert.match(publicCard, /wx\.hideShareMenu\(\)/);
assert.match(publicCard, /wx\.showShareMenu\(\{ menus: \['shareAppMessage'\] \}\)/);
assert.match(publicCard, /if \(!this\.data\.shareReady\)/);
assert.match(publicCardWxml, /open-type="share"/);
assert.match(publicCardWxml, /分享我的名片，邀请好友/);
assert.match(editCard, /card\.privacy\.phone/);
assert.match(editCard, /card\.privacy\.email/);
assert.match(editCard, /card\.privacy\.address/);
assert.match(editCard, /card\.privacy\.wechat_qr/);
assert.match(editCard, /legal\?type=terms/);
assert.match(editCard, /openPrivacyContract/);
assert.match(editCardJs, /indexOf\('yes'\) !== -1/);
assert.match(editCardJs, /pendingMedia/);
assert.match(editCardJs, /media\.size > 4 \* 1024 \* 1024/);
assert.match(editCardJs, /function uploadMedia\(filePath, field\)/);
assert.match(editCardJs, /field: field, data: 'data:image\/jpeg;base64,' \+ result\.data/);
assert.match(editCardJs, /uploadMedia\(pendingMedia\[field\], field\)/);
assert.doesNotMatch(editCardJs, /uploadPendingMedia[\s\S]*\/api\/auth\/card\/me/);
assert.match(editCardJs, /invite_attribution_token/);
assert.match(editCardJs, /display_name: payload\.name/);
assert.match(editCardJs, /\/api\/auth\/card\/unpublish/);
assert.match(editCardJs, /published: cardUtil\.isPublished\(data\.card\)/);
assert.match(editCardJs, /const published = cardUtil\.isPublished\(card\);/);
assert.doesNotMatch(editCardJs, /cardUtil\.isPublished\(card\) \|\| this\.data\.published/);
assert.match(editCardJs, /this\.publish\(warning\)/);
assert.match(editCardJs, /&mine=1/);
assert.match(editCardJs, /账号和文字名片已保存，请稍后重试图片/);
assert.match(editCard, /保存并公开名片/);
assert.match(editCard, /wx:if="\{\{!anonymous && published\}\}"/);
assert.match(editCardWxss, /\.field input \{ height: 84rpx; padding: 0 20rpx; line-height: 84rpx; \}/);
assert.match(editCardWxss, /\.field textarea \{ height: 220rpx; min-height: 220rpx; padding: 18rpx 20rpx; line-height: 1\.6; \}/);
assert.match(editCardWxss, /\.switch-field input \{ flex: 1; width: auto; min-width: 0; margin-top: 0; \}/);
assert.match(network, /\/api\/auth\/network\/ancestors/);
assert.match(network, /parent=self/);
assert.match(network, /loadBranch/);
assert.match(network, /node_id/);
assert.match(network, /next_cursor/);
assert.match(networkWxml, /wx:key="node_id"/);
assert.match(networkWxml, /item\.avatar/);
assert.match(invitePage, /\/api\/auth\/card\/me/);
assert.match(invitePage, /invite\.cardSharePath\(this\.data\.publicId, this\.data\.code\)/);
assert.match(invitePage, /cardUtil\.isPublished\(card\)/);
assert.match(invitePage, /invite\.validInviteCode\(code\.code\)/);
assert.match(invitePage, /wx\.hideShareMenu\(\)/);
assert.match(invitePage, /wx\.showShareMenu\(\{ menus: \['shareAppMessage'\] \}\)/);
assert.match(invitePage, /registrationSharePath\(this\.data\.code\)/);
assert.match(inviteWxml, /shareReady/);
assert.match(inviteWxml, /分享我的名片，邀请好友/);
assert.match(inviteWxml, /打开微信好友列表/);
assert.match(inviteWxss, /width: 100%; min-width: 0;/);
assert.match(inviteWxss, /box-sizing: border-box;/);
assert.match(profilePage, /goInvite\(\) \{ wx\.navigateTo/);
assert.doesNotMatch(profilePage, /goInvite\(\)[\s\S]*membership\.status/);

let editDefinition;
global.Page = function (definition) { editDefinition = definition; };
const editModule = require('../miniprogram/pages/card-edit/card-edit.js');
const cardEditDefinition = editDefinition;
const editContext = { data: Object.assign({}, editDefinition.data), setData(patch) { Object.assign(this.data, patch); } };
editDefinition.agreement.call(editContext, { detail: { value: ['yes'] } });
assert.strictEqual(editContext.data.agreed, true);
editDefinition.agreement.call(editContext, { detail: { value: [] } });
assert.strictEqual(editContext.data.agreed, false);

const api = require('../miniprogram/utils/api.js');
let mediaRequest;
global.wx.getFileSystemManager = function () {
  return { readFile(options) { options.success({ data: 'QUJD' }); } };
};
api.request = function (path, options) {
  mediaRequest = { path, options };
  return Promise.resolve({ statusCode: 200, data: { url: 'https://example.test/avatar.jpg' } });
};
editModule.uploadMedia('/tmp/avatar.jpg', 'avatar').then((url) => {
  assert.strictEqual(url, 'https://example.test/avatar.jpg');
  assert.deepStrictEqual(mediaRequest, {
    path: '/api/auth/card/media',
    options: { method: 'POST', data: { field: 'avatar', data: 'data:image/jpeg;base64,QUJD' }, timeout: 60000 }
  });
}).catch((error) => { throw error; });

require('node:test')('registering a draft card publishes it before redirecting', { timeout: 1000 }, async () => {
  delete store.hq_token;
  const requests = [];
  const completeCard = {
    name: '王小明', title: '设计师', company: '黄雀', bio: '', tags: '', links: '',
    email: '', address: '', phone: '', avatar: '', wechat_qr: '', privacy: card.privacy()
  };
  api.request = function (requestPath) {
    requests.push(requestPath);
    if (requestPath === '/api/auth/miniprogram-register') {
      return Promise.resolve({ statusCode: 200, data: { token: 'new-token', card: Object.assign({}, completeCard, { public_id: 'public-1', status: 'draft' }) } });
    }
    if (requestPath === '/api/auth/card/publish') {
      return Promise.resolve({ statusCode: 200, data: { card: Object.assign({}, completeCard, { public_id: 'public-1', status: 'published', invite_code: 'ABCD23' }) } });
    }
    return Promise.reject(new Error('unexpected request ' + requestPath));
  };
  global.wx.showToast = function () {};
  let finishRedirect;
  const redirected = new Promise((resolve) => { finishRedirect = resolve; });
  global.wx.redirectTo = function (options) { finishRedirect(options.url); };
  const context = {
    data: Object.assign({}, cardEditDefinition.data, {
      anonymous: true, agreed: true, username: 'wang', password: 'secret',
      card: completeCard, pendingMedia: {}, loading: false
    }),
    setData(patch) { Object.assign(this.data, patch); },
    publish: cardEditDefinition.publish,
    openCard: cardEditDefinition.openCard
  };
  cardEditDefinition.save.call(context);
  const redirect = await redirected;
  assert.strictEqual(redirect, '/pages/card/card?id=public-1&mine=1');
  assert.deepStrictEqual(requests, ['/api/auth/miniprogram-register', '/api/auth/card/publish']);
  assert.strictEqual(context.data.published, true);
});

const networkPage = require('../miniprogram/pages/network/network.js');
const roots = [networkPage.nodeView({ node_id: 'node-1', public_id: 'public-1', has_children: true }, 0, 'self')];
const once = networkPage.appendBranch(roots, 0, [{ node_id: 'node-2', has_children: true }], 'next-1');
const twice = networkPage.appendBranch(once, 1, [{ node_id: 'node-3', public_id: 'public-3' }], '');
assert.deepStrictEqual(twice.map((node) => [node.node_id, node.depth]), [['node-1', 0], ['node-2', 1], ['node-3', 2]]);
console.log('business card and network tests passed');
