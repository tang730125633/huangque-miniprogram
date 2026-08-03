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
const workSlots = card.workSlots([
  { type: 'image', key: 'cards/works/image-1.jpg', title: '品牌视觉' },
  { type: 'video', key: 'cards/works/video-1.mp4', title: '个人形象展示' },
  { type: 'legacy', value: 'preserve-me' }
]);
assert.strictEqual(workSlots.images.length, 3);
assert.strictEqual(workSlots.videos.length, 3);
assert.strictEqual(workSlots.images[0].title, '品牌视觉');
assert.strictEqual(workSlots.videos[0].title, '个人形象展示');
assert.deepStrictEqual(workSlots.other, [{ type: 'legacy', value: 'preserve-me' }]);
assert.deepStrictEqual(card.worksPayload(workSlots.images, workSlots.videos, workSlots.other), [
  { type: 'image', key: 'cards/works/image-1.jpg', title: '品牌视觉', slot: 1 },
  { type: 'video', key: 'cards/works/video-1.mp4', title: '个人形象展示', slot: 1 },
  { type: 'legacy', value: 'preserve-me' }
]);
assert.strictEqual(card.isComplete({ name: '王小明', title: '设计师', company: '黄雀' }), false);
assert.strictEqual(card.isComplete({ name: '王小明', title: '设计师', company: '黄雀', phone: '13800138000' }), true);
assert.strictEqual(card.validPhone('12800138000'), false);
assert.strictEqual(card.isPublished({ public_id: 'public-1', status: 'draft' }), false);
assert.strictEqual(card.isPublished({ public_id: 'public-1', is_published: false }), false);
assert.strictEqual(card.isPublished({ public_id: 'public-1', status: 'published' }), true);
assert.strictEqual(card.isPublished({ public_id: 'public-1', is_published: true }), true);
assert.deepStrictEqual(card.cardPayload({ avatar: 'signed-avatar', wechat_qr: 'signed-qr', name: '王小明' }), {
  name: '王小明', title: '', company: '', bio: '', tags: '', links: '', email: '', address: '', phone: '', privacy: { phone: false, email: false, address: false, wechat_qr: false }
});

let publicCardDefinition;
global.Page = function (definition) { publicCardDefinition = definition; };
const cardPage = require('../miniprogram/pages/card/card.js');
const cardPageDefinition = publicCardDefinition;
const mediaCard = cardPage.cardView({
  works: [
    { type: 'image', url: 'https://example.test/work.jpg', title: '品牌发布会' },
    { type: 'video', url: 'http://unsafe.test/work.mp4', title: '不展示' }
  ]
});
assert.deepStrictEqual(mediaCard.workImages.map((item) => item.title), ['品牌发布会']);
assert.deepStrictEqual(mediaCard.workVideos, []);
require('node:test')('joining records the server-validated journey without blocking navigation', () => {
  const cardApi = require('../miniprogram/utils/api.js');
  let request;
  let target;
  cardApi.request = function (requestPath, options) {
    request = { path: requestPath, options };
    return Promise.reject(new Error('analytics unavailable'));
  };
  global.wx.navigateTo = function (options) { target = options.url; };
  cardPageDefinition.goJoin.call({ data: { attributionToken: 'signed-token' } });
  assert.deepStrictEqual(request, {
    path: '/api/auth/invite/journey/start',
    options: { method: 'POST', auth: false, data: { invite_attribution_token: 'signed-token' } }
  });
  assert.strictEqual(target, '/pages/card-edit/card-edit?source=invite');
});
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
['pages/my-card/my-card', 'pages/card/card', 'pages/card-edit/card-edit', 'pages/network/network'].forEach((page) => assert.ok(appJson.pages.includes(page)));
assert.strictEqual(appJson.pages[0], 'pages/my-card/my-card');
assert.strictEqual(appJson.tabBar.custom, true);
assert.deepStrictEqual(appJson.tabBar.list.map((item) => [item.pagePath, item.text]), [
  ['pages/my-card/my-card', '我的名片'],
  ['pages/home/home', '黄雀AI工作台'],
  ['pages/inspiration/inspiration', '一键跟创'],
  ['pages/assets/assets', '历史作品'],
  ['pages/profile/profile', '我的']
]);
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
const myCardPage = fs.readFileSync(path.join(root, 'miniprogram/pages/my-card/my-card.js'), 'utf8');
const myCardWxml = fs.readFileSync(path.join(root, 'miniprogram/pages/my-card/my-card.wxml'), 'utf8');
const rechargePage = fs.readFileSync(path.join(root, 'miniprogram/pages/recharge/recharge.js'), 'utf8');
const loginPage = fs.readFileSync(path.join(root, 'miniprogram/pages/login/login.js'), 'utf8');
const loginWxml = fs.readFileSync(path.join(root, 'miniprogram/pages/login/login.wxml'), 'utf8');
const customTabBar = require('../miniprogram/custom-tab-bar/index.js');
assert.match(publicCard, /\/api\/auth\/card\/public/);
assert.match(myCardPage, /openAccount\(\) \{ wx\.switchTab\(\{ url: '\/pages\/profile\/profile' \}\); \}/);
assert.deepStrictEqual(customTabBar.navigationForRoute('pages/my-card/my-card').map((item) => item.text), ['我的名片', '黄雀AI工作台']);
assert.deepStrictEqual(customTabBar.navigationForRoute('pages/home/home').map((item) => item.text), ['首页', '一键跟创', '历史作品', '我的']);
assert.match(publicCard, /auth: false/);
assert.match(publicCard, /retry\(\)/);
assert.match(publicCard, /data\.invite_valid === true/);
assert.match(publicCard, /rememberValidInvite/);
assert.match(publicCard, /invite_attribution_token/);
assert.match(publicCard, /\/api\/auth\/invite\/journey\/start/);
assert.match(publicCard, /prepareShareImage\(this, card\)/);
assert.match(publicCard, /imageUrl: this\.data\.shareImageUrl/);
assert.match(publicCard, /wx\.hideShareMenu\(\)/);
assert.match(publicCard, /wx\.showShareMenu\(\{ menus: \['shareAppMessage'\] \}\)/);
assert.match(publicCard, /if \(!this\.data\.shareReady\)/);
assert.match(publicCardWxml, /open-type="share"/);
assert.match(publicCardWxml, /分享我的名片，邀请好友/);
assert.match(publicCardWxml, /重新加载/);
assert.doesNotMatch(publicCardWxml, /初始密码|登录账号|黄雀 AI 登录信息/);
assert.doesNotMatch(loginPage, /miniprogram-register|buildRegistrationPayload/);
assert.doesNotMatch(loginWxml, /注册并登录|邀请码（选填）|新用户注册即送/);
assert.match(loginWxml, /先创建我的名片/);
assert.match(publicCard, /card-edit\/card-edit\?source=invite/);
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
assert.match(editCardJs, /data: \{ field, data: 'data:image\/jpeg;base64,' \+ result\.data/);
assert.match(editCardJs, /uploadMedia\(pendingMedia\[field\], field\)/);
assert.doesNotMatch(editCardJs, /uploadPendingMedia[\s\S]*\/api\/auth\/card\/me/);
assert.match(editCardJs, /invite_attribution_token/);
assert.match(editCardJs, /\/api\/auth\/miniprogram\/card-register/);
assert.match(editCardJs, /\/api\/auth\/card\/wechat\/bind/);
assert.match(editCardJs, /phone: payload\.phone/);
assert.match(editCardJs, /\/api\/auth\/change_password/);
assert.doesNotMatch(editCard, /设置登录账号|设置登录密码/);
assert.match(editCard, /手机号 \*/);
assert.match(editCard, /workImages/);
assert.match(editCard, /workVideos/);
assert.match(editCard, /bindinput="workTitleInput"/);
assert.match(editCard, /maxlength="12"/);
assert.match(editCard, /maxlength="16"/);
assert.match(editCardJs, /cardUtil\.worksPayload/);
assert.match(editCardJs, /drafts\.save\(editDraftKey\(owner\)/);
assert.match(editCard, /loadFailed/);
assert.match(publicCardWxml, /card\.workImages/);
assert.match(publicCardWxml, /card\.workVideos/);
assert.match(publicCardWxml, /work-caption/);
assert.match(editCard, /初始密码与手机号一致/);
assert.match(editCardJs, /\/api\/auth\/card\/unpublish/);
assert.match(editCardJs, /published: cardUtil\.isPublished\(card\)/);
assert.match(editCardJs, /this\.publish\(warning\)/);
assert.match(editCardJs, /&mine=1/);
assert.match(editCardJs, /账号和文字名片已保存，请稍后重试图片/);
assert.match(editCard, /保存名片并开通黄雀 AI/);
assert.match(editCard, /!anonymous && published/);
assert.match(editCardWxss, /\.field input \{ height: 84rpx; padding: 0 20rpx; line-height: 84rpx; \}/);
assert.match(editCardWxss, /\.field textarea \{ height: 200rpx; min-height: 200rpx; padding: 18rpx 20rpx; line-height: 1\.6; \}/);
assert.match(editCardWxss, /\.field-grid \{ display: grid; grid-template-columns: 1fr 1fr;/);
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
assert.match(myCardPage, /\/api\/auth\/miniprogram\/card-login/);
assert.match(myCardPage, /\/api\/auth\/card\/wechat\/bind/);
assert.match(myCardPage, /card_unbound/);
assert.match(myCardPage, /if \(this\.data\.binding\) return/);
assert.match(myCardWxml, /已有黄雀 AI 账号/);
assert.match(myCardWxml, /disabled="\{\{binding\}\}"/);
assert.match(rechargePage, /充值前先修改初始密码/);

let editDefinition;
global.Page = function (definition) { editDefinition = definition; };
const editModule = require('../miniprogram/pages/card-edit/card-edit.js');
const cardEditDefinition = editDefinition;
const recoveredNotice = editModule.registrationNotice({ created: false, ai_account: 'old-account' }, { phone: '13900000000' });
assert.strictEqual(recoveredNotice.title, '已恢复原名片');
assert.match(recoveredNotice.content, /old-account/);
assert.doesNotMatch(recoveredNotice.content, /13900000000|100 点已到账|初始密码/);
const rewardedNotice = editModule.registrationNotice({ created: true, invite_rewarded: true, ai_account: '13800138000' }, { phone: '13800138000' });
assert.match(rewardedNotice.content, /100 点已到账/);
assert.notStrictEqual(editModule.editDraftKey('account-a'), editModule.editDraftKey('account-b'));
const recoveredDraft = editModule.draftPatch({ owner: '13800138000', card: { name: '草稿姓名', phone: '13800138000' } }, '13800138000');
assert.strictEqual(recoveredDraft.card.name, '草稿姓名');
assert.strictEqual(editModule.draftPatch({ owner: 'other', card: { phone: '13800138000' } }, '13800138000'), null);
const editContext = { data: Object.assign({}, editDefinition.data), setData(patch) { Object.assign(this.data, patch); } };
editDefinition.agreement.call(editContext, { detail: { value: ['yes'] } });
assert.strictEqual(editContext.data.agreed, true);
editDefinition.agreement.call(editContext, { detail: { value: [] } });
assert.strictEqual(editContext.data.agreed, false);
let titlePatch;
editDefinition.workTitleInput.call({ setData(patch) { titlePatch = patch; } }, { currentTarget: { dataset: { type: 'video', index: 1 } }, detail: { value: '我的品牌故事' } });
assert.deepStrictEqual(titlePatch, { 'workVideos[1].title': '我的品牌故事', error: '' });

require('node:test')('card save stops when the recovery draft cannot be stored', () => {
  const draftStore = require('../miniprogram/utils/drafts.js');
  const originalSave = draftStore.save;
  draftStore.save = () => false;
  try {
    const context = {
      data: Object.assign({}, cardEditDefinition.data, {
        anonymous: true,
        agreed: true,
        card: Object.assign({}, cardEditDefinition.data.card, { name: '王小明', title: '设计师', company: '黄雀', phone: '13800138000' })
      }),
      setData(patch) { Object.assign(this.data, patch); },
      saveDraft: cardEditDefinition.saveDraft
    };
    cardEditDefinition.save.call(context);
    assert.match(context.data.error, /本机存储空间不足/);
    assert.strictEqual(context.data.loading, false);
  } finally {
    draftStore.save = originalSave;
  }
});

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
    email: '', address: '', phone: '13800138000', avatar: '', wechat_qr: '', privacy: card.privacy()
  };
  let registerPayload;
  api.request = function (requestPath, options) {
    requests.push(requestPath);
    if (requestPath === '/api/auth/miniprogram/card-register') {
      registerPayload = options.data;
      return Promise.resolve({ statusCode: 200, data: { token: 'new-token', created: true, invite_bound: true, invite_rewarded: true, ai_account: '13800138000', initial_password: true, user: { username: '13800138000' }, card: Object.assign({}, completeCard, { public_id: 'public-1', status: 'draft' }) } });
    }
    if (requestPath === '/api/auth/card/publish') {
      return Promise.resolve({ statusCode: 200, data: { card: Object.assign({}, completeCard, { public_id: 'public-1', status: 'published', invite_code: 'ABCD23' }) } });
    }
    return Promise.reject(new Error('unexpected request ' + requestPath));
  };
  global.wx.login = function (options) { options.success({ code: 'wx-code' }); };
  let registrationModal;
  global.wx.showModal = function (options) { registrationModal = options; if (options.success) options.success({ confirm: true }); };
  global.wx.showToast = function () {};
  let finishRedirect;
  const redirected = new Promise((resolve) => { finishRedirect = resolve; });
  global.wx.redirectTo = function (options) { finishRedirect(options.url); };
  const titledWorks = card.workSlots();
  titledWorks.images[0].title = '品牌发布会';
  const context = {
    data: Object.assign({}, cardEditDefinition.data, {
      anonymous: true, agreed: true,
      card: completeCard, workImages: titledWorks.images, workVideos: titledWorks.videos, pendingMedia: {}, loading: false
    }),
    setData(patch) { Object.assign(this.data, patch); },
    saveDraft: cardEditDefinition.saveDraft,
    registerCard: cardEditDefinition.registerCard,
    uploadPendingMedia: cardEditDefinition.uploadPendingMedia,
    publish: cardEditDefinition.publish,
    openCard: cardEditDefinition.openCard
  };
  cardEditDefinition.save.call(context);
  const redirect = await redirected;
  assert.strictEqual(redirect, '/pages/card/card?id=public-1&mine=1');
  assert.deepStrictEqual(requests, ['/api/auth/miniprogram/card-register', '/api/auth/card/publish']);
  assert.strictEqual(registerPayload.wx_code, 'wx-code');
  assert.strictEqual(registerPayload.phone, '13800138000');
  assert.strictEqual(registerPayload.card.works[0].title, '品牌发布会');
  assert.strictEqual(context.data.published, true);
  assert.match(registrationModal.content, /100 点已到账/);

  requests.length = 0;
  const latestCard = Object.assign({}, completeCard, { name: '修改后的名字' });
  api.request = function (requestPath, options) {
    requests.push(requestPath);
    if (requestPath === '/api/auth/miniprogram/card-register') {
      return Promise.resolve({ statusCode: 200, data: { token: 'recovered-token', created: false, invite_bound: true, invite_rewarded: false, ai_account: '13800138000', initial_password: true, user: { username: '13800138000' }, card: Object.assign({}, completeCard, { name: '旧名字', public_id: 'public-1', status: 'draft' }) } });
    }
    if (requestPath === '/api/auth/card/me') {
      assert.strictEqual(options.method, 'PUT');
      assert.strictEqual(options.data.name, '修改后的名字');
      return Promise.resolve({ statusCode: 200, data: { card: Object.assign({}, options.data, { public_id: 'public-1', status: 'draft' }) } });
    }
    if (requestPath === '/api/auth/card/publish') {
      return Promise.resolve({ statusCode: 200, data: { card: Object.assign({}, latestCard, { public_id: 'public-1', status: 'published', invite_code: 'ABCD23' }) } });
    }
    return Promise.reject(new Error('unexpected request ' + requestPath));
  };
  let replayFinish;
  const replayRedirected = new Promise((resolve) => { replayFinish = resolve; });
  global.wx.redirectTo = function (options) { replayFinish(options.url); };
  const replayContext = {
    data: Object.assign({}, cardEditDefinition.data, {
      anonymous: true, agreed: true,
      card: latestCard, workImages: titledWorks.images, workVideos: titledWorks.videos, pendingMedia: {}, loading: false
    }),
    setData(patch) { Object.assign(this.data, patch); },
    saveDraft: cardEditDefinition.saveDraft,
    registerCard: cardEditDefinition.registerCard,
    uploadPendingMedia: cardEditDefinition.uploadPendingMedia,
    publish: cardEditDefinition.publish,
    openCard: cardEditDefinition.openCard
  };
  cardEditDefinition.save.call(replayContext);
  await replayRedirected;
  assert.deepStrictEqual(requests, ['/api/auth/miniprogram/card-register', '/api/auth/card/me', '/api/auth/card/publish']);
  assert.strictEqual(replayContext.data.card.name, '修改后的名字');
  assert.doesNotMatch(registrationModal.content, /100 点已到账/);
});

require('node:test')('follow-create requires a complete WeChat-bound card', async () => {
  let inspirationDefinition;
  global.Page = function (definition) { inspirationDefinition = definition; };
  delete require.cache[require.resolve('../miniprogram/pages/inspiration/inspiration.js')];
  require('../miniprogram/pages/inspiration/inspiration.js');
  api.getToken = () => 'token';
  const tabs = [];
  const pages = [];
  global.wx.showToast = function () {};
  global.wx.switchTab = ({ url }) => tabs.push(url);
  global.wx.navigateTo = ({ url }) => pages.push(url);
  const context = { _all: [{ id: 'case-1', prompt: '测试提示', engineKey: 'nb2' }] };
  api.request = () => Promise.resolve({ statusCode: 200, data: { card: { name: '王小明', title: '设计师', company: '黄雀', phone: '13800138000' }, wechat_bound: false } });
  await inspirationDefinition.follow.call(context, { currentTarget: { dataset: { id: 'case-1' } } });
  assert.deepStrictEqual(tabs, ['/pages/my-card/my-card']);
  assert.deepStrictEqual(pages, []);

  api.request = () => Promise.resolve({ statusCode: 200, data: { card: { name: '王小明', title: '设计师', company: '黄雀', phone: '13800138000' }, wechat_bound: true } });
  await inspirationDefinition.follow.call(context, { currentTarget: { dataset: { id: 'case-1' } } });
  assert.deepStrictEqual(pages, ['/pages/banana/banana']);
});

const networkPage = require('../miniprogram/pages/network/network.js');
const roots = [networkPage.nodeView({ node_id: 'node-1', public_id: 'public-1', has_children: true }, 0, 'self')];
const once = networkPage.appendBranch(roots, 0, [{ node_id: 'node-2', has_children: true }], 'next-1');
const twice = networkPage.appendBranch(once, 1, [{ node_id: 'node-3', public_id: 'public-3' }], '');
assert.deepStrictEqual(twice.map((node) => [node.node_id, node.depth]), [['node-1', 0], ['node-2', 1], ['node-3', 2]]);
console.log('business card and network tests passed');
