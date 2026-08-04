const assert = require('assert');
const fs = require('fs');

const storage = {};
const navigation = [];
global.getApp = () => ({ globalData: { apiBase: 'https://huangquechuanmei.com' } });
global.getCurrentPages = () => [{}];
global.wx = {
  getStorageSync(key) { return storage[key]; },
  setStorageSync(key, value) { storage[key] = value; },
  removeStorageSync(key) { delete storage[key]; },
  login({ success }) { success({ code: 'wx-code' }); },
  hideShareMenu() {},
  navigateTo({ url }) { navigation.push(url); },
  navigateBack() { navigation.push('back'); },
  switchTab({ url, success }) { navigation.push(url); if (success) success(); },
  showToast() {}
};

const api = require('../miniprogram/utils/api.js');
const card = require('../miniprogram/utils/card.js');

let myCardDefinition;
global.Page = (definition) => { myCardDefinition = definition; };
require('../miniprogram/pages/my-card/my-card.js');

let homeDefinition;
global.Page = (definition) => { homeDefinition = definition; };
require('../miniprogram/pages/home/home.js');

let loginDefinition;
global.Page = (definition) => { loginDefinition = definition; };
require('../miniprogram/pages/login/login.js');

function context(definition) {
  return Object.assign({}, definition, {
    data: Object.assign({}, definition.data),
    setData(patch, done) { Object.assign(this.data, patch); if (done) done(); }
  });
}

(async () => {
  storage.hq_token = 'workbench-token';
  storage.hq_card_token = 'card-token';
  let capturedRequest;
  wx.request = (options) => { capturedRequest = options; options.success({ statusCode: 200, data: {} }); };
  await api.request('/api/auth/card/me', { method: 'GET', cardAuth: true });
  assert.strictEqual(capturedRequest.header['X-HQ-Card-Token'], 'card-token');
  assert.strictEqual(capturedRequest.header.Authorization, undefined);
  api.clearToken();
  assert.strictEqual(storage.hq_token, undefined);
  assert.strictEqual(storage.hq_card_token, 'card-token');

  let cardLoginOptions;
  storage.hq_token = 'stale-account-token';
  api.request = (path, options) => {
    cardLoginOptions = { path, options };
    return Promise.resolve({ statusCode: 404, data: { code: 'card_unbound' } });
  };
  let page = context(myCardDefinition);
  await page.loginByWechat.call(page);
  assert.strictEqual(page.data.state, 'guest');
  assert.strictEqual(storage.hq_token, 'stale-account-token');
  assert.strictEqual(cardLoginOptions.path, '/api/auth/miniprogram/card-session');
  assert.strictEqual(cardLoginOptions.options.auth, false);

  storage.hq_token = 'explicit-ai-login';
  api.markCardBindIntent();
  for (let visit = 0; visit < 2; visit += 1) {
    let ownerLoaded = false;
    page = context(myCardDefinition);
    page.loadOwner = () => { ownerLoaded = true; return Promise.resolve(); };
    await page.loginByWechat.call(page);
    assert.strictEqual(ownerLoaded, true);
    assert.strictEqual(storage.hq_token, 'explicit-ai-login');
    assert.strictEqual(api.hasCardBindIntent(), true);
  }

  api.request = () => Promise.resolve({ statusCode: 200, data: { card_token: 'current-wechat-card-token', card: { name: '当前微信' } } });
  page = context(myCardDefinition);
  await page.loginByWechat.call(page);
  assert.strictEqual(page.data.state, 'owner');
  assert.strictEqual(storage.hq_token, 'explicit-ai-login');
  assert.strictEqual(storage.hq_card_token, 'current-wechat-card-token');
  assert.strictEqual(api.hasCardBindIntent(), false);

  const originalPrepareShareImage = card.prepareShareImage;
  let resolveOldShare;
  let shareCall = 0;
  card.prepareShareImage = () => {
    shareCall += 1;
    return shareCall === 1 ? new Promise((resolve) => { resolveOldShare = resolve; }) : Promise.resolve('new-share.jpg');
  };
  page = context(myCardDefinition);
  page._loadId = 1;
  myCardDefinition.showOwner.call(page, { card: { public_id: 'old-card', status: 'published', invite_code: 'ABCD23' } }, 1);
  page._loadId = 2;
  myCardDefinition.showOwner.call(page, { card: { public_id: 'new-card', status: 'published', invite_code: 'EFGH45' } }, 2);
  await new Promise((resolve) => setImmediate(resolve));
  resolveOldShare('old-share.jpg');
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(page.data.publicId, 'new-card');
  assert.strictEqual(page.data.shareImageUrl, 'new-share.jpg');
  card.prepareShareImage = originalPrepareShareImage;

  api.request = () => Promise.resolve({ statusCode: 404, data: { code: 'card_not_found' } });
  page = context(myCardDefinition);
  await page.loadOwner.call(page);
  assert.strictEqual(page.data.state, 'owner');
  assert.strictEqual(page.data.wechatBound, false);
  assert.strictEqual(page.data.complete, false);

  let tabSynced = false;
  let wechatChecked = false;
  page = context(myCardDefinition);
  page.getTabBar = () => ({ syncNavigation() { tabSynced = true; } });
  page.loginByWechat = () => { wechatChecked = true; };
  page.onShow.call(page);
  assert.strictEqual(tabSynced, true);
  assert.strictEqual(wechatChecked, true);

  storage.hq_token = 'workbench-account';
  api.request = (requestPath) => Promise.resolve(requestPath === '/api/auth/me'
    ? { statusCode: 200, data: { user: { points: 100, membership_active: false }, membership_enforcement_enabled: true } }
    : { statusCode: 200, data: { card: { name: '林知夏', title: '主理人', company: '黄雀', phone: '13800138000', wechat_bound: true }, wechat_bound: true } });
  let home = context(homeDefinition);
  await home.ensureWorkbenchSession.call(home);
  assert.strictEqual(home.data.membershipReady, true);
  assert.strictEqual(home.data.cardReady, true);
  assert.strictEqual(home.data.points, 100);

  api.request = () => Promise.reject(new Error('offline'));
  home = context(homeDefinition);
  await home.ensureWorkbenchSession.call(home);
  assert.strictEqual(home.data.membershipReady, true);
  assert.strictEqual(home.data.accountStateError, true);

  delete storage.hq_token;
  navigation.length = 0;
  home = context(homeDefinition);
  const loggedOut = await home.ensureWorkbenchSession.call(home);
  assert.strictEqual(loggedOut.state, 'logged-out');
  assert.strictEqual(home.data.membershipReady, true);
  assert.deepStrictEqual(navigation, []);

  const originalCardAccountLogin = card.loginCardAccount;
  card.loginCardAccount = () => Promise.resolve({ token: 'card-account-token' });
  let login = context(loginDefinition);
  login.data.agreed = true;
  await login.loginWithCard.call(login);
  assert.strictEqual(login.data.cardLoading, false);
  assert.strictEqual(navigation.pop(), '/pages/home/home');
  card.loginCardAccount = originalCardAccountLogin;

  navigation.length = 0;
  global.getCurrentPages = () => [{}, {}];
  login = context(loginDefinition);
  login.close.call(login);
  global.getCurrentPages = () => [{}];
  login.close.call(login);
  login.data.loading = true;
  login.close.call(login);
  assert.deepStrictEqual(navigation, ['back', '/pages/my-card/my-card']);

  ['my-card', 'home', 'inspiration', 'assets', 'profile'].forEach((name) => {
    const source = fs.readFileSync(`miniprogram/pages/${name}/${name}.js`, 'utf8');
    assert.match(source, /getTabBar/);
    assert.match(source, /syncNavigation/);
  });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync('miniprogram/pages/my-card/my-card.json', 'utf8')).usingComponents, {});
  assert.match(fs.readFileSync('miniprogram/pages/card-edit/card-edit.js', 'utf8'), /checkWechatSession/);

  console.log('new account navigation checks passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
