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
  redirectTo({ url }) { navigation.push(url); },
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

  let cardRequest;
  storage.hq_token = 'account-token';
  api.request = (path, options) => {
    cardRequest = { path, options };
    return Promise.resolve({ statusCode: 404, data: { code: 'card_not_found' } });
  };
  let page = context(myCardDefinition);
  await page.loadOwner.call(page);
  assert.strictEqual(page.data.state, 'missing');
  assert.strictEqual(cardRequest.path, '/api/auth/card/me?create=0');
  assert.strictEqual(cardRequest.options.cardAuth, undefined);

  api.request = () => Promise.resolve({ statusCode: 200, data: { card: { name: '当前账号' } } });
  page = context(myCardDefinition);
  await page.loadOwner.call(page);
  assert.strictEqual(page.data.state, 'owner');
  assert.strictEqual(storage.hq_token, 'account-token');

  api.request = () => Promise.reject({ errMsg: 'request:fail url not in domain list' });
  page = context(myCardDefinition);
  await page.loadOwner.call(page);
  assert.strictEqual(page.data.state, 'error');
  assert.strictEqual(page.data.error, 'request:fail url not in domain list');

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

  let ownerLoaded = false;
  page = context(myCardDefinition);
  page.loadOwner = () => { ownerLoaded = true; return Promise.resolve(); };
  page.onShow.call(page);
  assert.strictEqual(ownerLoaded, true);

  delete storage.hq_token;
  navigation.length = 0;
  page = context(myCardDefinition);
  page.onShow.call(page);
  assert.deepStrictEqual(navigation, ['/pages/login/login?redirect=my-card']);

  storage.hq_token = 'workbench-account';
  const workbenchRequests = [];
  api.request = (requestPath) => {
    workbenchRequests.push(requestPath);
    return Promise.resolve({ statusCode: 200, data: { user: { points: 100, membership_active: false }, membership_enforcement_enabled: true } });
  };
  let home = context(homeDefinition);
  await home.ensureWorkbenchSession.call(home);
  assert.strictEqual(home.data.membershipReady, true);
  assert.strictEqual(home.data.points, 100);
  assert.deepStrictEqual(workbenchRequests, ['/api/auth/me']);

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

  navigation.length = 0;
  global.getCurrentPages = () => [{}, {}];
  let login = context(loginDefinition);
  login.close.call(login);
  global.getCurrentPages = () => [{}];
  login.close.call(login);
  login.data.loading = true;
  login.close.call(login);
  assert.deepStrictEqual(navigation, ['back', '/pages/home/home']);

  ['home', 'inspiration', 'assets', 'profile'].forEach((name) => {
    const source = fs.readFileSync(`miniprogram/pages/${name}/${name}.js`, 'utf8');
    assert.match(source, /getTabBar/);
    assert.match(source, /syncNavigation/);
  });
  assert.doesNotMatch(fs.readFileSync('miniprogram/pages/my-card/my-card.js', 'utf8'), /getTabBar|syncNavigation|loginCardSession|wechat\/bind/);
  assert.doesNotMatch(fs.readFileSync('miniprogram/pages/login/login.js', 'utf8'), /loginCardAccount|loginWithCard|openCardRegistration/);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync('miniprogram/pages/my-card/my-card.json', 'utf8')).usingComponents, {});
  assert.doesNotMatch(fs.readFileSync('miniprogram/pages/card-edit/card-edit.js', 'utf8'), /checkWechatSession|loginCardSession|wechat\/bind|card-register|cardAuth: true/);

  console.log('new account navigation checks passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
