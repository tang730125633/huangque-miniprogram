const assert = require('assert');

const storage = {};
const navigation = [];
let modal = null;
global.getApp = () => ({ globalData: { apiBase: 'https://example.test' } });
global.getCurrentPages = () => [{}];
global.wx = {
  getStorageSync(key) { return storage[key]; },
  setStorageSync(key, value) { storage[key] = value; },
  removeStorageSync(key) { delete storage[key]; },
  switchTab({ url }) { navigation.push(url); },
  redirectTo({ url }) { navigation.push(url); },
  navigateTo({ url }) { navigation.push(url); },
  navigateBack() { navigation.push('back'); },
  showModal(options) {
    modal = options;
    if (options.success) options.success({ confirm: true });
  },
  openPrivacyContract() {}
};

const api = require('../miniprogram/utils/api.js');
const device = require('../miniprogram/utils/device.js');
const inviteContext = require('../miniprogram/utils/invite-context.js');
device.getDeviceId = () => 'device-id';
api.getToken = () => '';

let definition;
global.Page = (value) => { definition = value; };
require('../miniprogram/pages/login/login.js');

function page(overrides) {
  return Object.assign({}, definition, {
    data: Object.assign({}, definition.data, overrides || {}),
    setData(patch) { Object.assign(this.data, patch); }
  });
}

require('node:test')('direct login entry defaults to login mode', async () => {
  inviteContext.clear();
  const current = page();
  await definition.onLoad.call(current, {});
  assert.strictEqual(current.data.mode, 'login');
  assert.strictEqual(current.data.inviteRequired, false);
});

require('node:test')('link invite validates server context and defaults to registration', async () => {
  inviteContext.clear();
  api.request = (path) => {
    assert.strictEqual(path, '/api/auth/invite/validate?code=ABCD23');
    return Promise.resolve({ statusCode: 200, data: {
      code: 'ABCD23', inviter: { name: '邀请人 A', account_id: 'HQ-A' },
      invite_validated_at: 1700000000, invite_expires_at: 1700604800
    } });
  };
  const current = page();
  await definition.onLoad.call(current, { invite: 'ABCD23' });
  assert.strictEqual(current.data.mode, 'register');
  assert.strictEqual(current.data.inviteRequired, true);
  assert.strictEqual(current.data.inviterName, '邀请人 A');
  assert.strictEqual(inviteContext.current(1700000001000).source, 'link');
});

require('node:test')('invited registration submits validated context and returns home', async () => {
  navigation.length = 0;
  modal = null;
  inviteContext.clear();
  const nowSeconds = Math.floor(Date.now() / 1000);
  inviteContext.saveCard({
    code: 'EFGH45', inviter: { name: '邀请人 B' }, attribution_token: 'signed-token',
    validated_at: nowSeconds, expires_at: nowSeconds + 7 * 24 * 3600
  });
  let captured;
  api.request = (path, options) => {
    captured = { path, options };
    return Promise.resolve({ statusCode: 200, data: {
      token: 'new-token', user: { username: 'new-user' }, invite_bound: true,
      inviter: { name: '邀请人 B' }
    } });
  };
  api.setToken = (token) => { storage.hq_token = token; };
  const current = page({
    mode: 'register', username: 'new-user', password: 'secret123', agreed: true,
    inviteRequired: true, inviterName: '邀请人 B'
  });
  await definition.submit.call(current);
  assert.strictEqual(captured.path, '/api/auth/miniprogram-register');
  assert.deepStrictEqual(captured.options.data, {
    username: 'new-user', password: 'secret123', device_id: 'device-id',
    invite_code: 'EFGH45', invite_attribution_token: 'signed-token'
  });
  assert.strictEqual(storage.hq_token, 'new-token');
  assert.strictEqual(inviteContext.current(), null);
  assert.match(modal.content, /邀请人 B/);
  assert.deepStrictEqual(navigation, ['/pages/home/home']);
});

require('node:test')('existing-account login never sends invite fields and clears pending context', async () => {
  navigation.length = 0;
  inviteContext.clear();
  inviteContext.saveLink({
    code: 'JKLM67', inviter: { name: '邀请人 C' },
    validated_at: 1700000000, expires_at: 4102444800
  });
  let captured;
  api.request = (path, options) => {
    captured = { path, options };
    return Promise.resolve({ statusCode: 200, data: {
      token: 'existing-token', user: { username: 'existing' }
    } });
  };
  const current = page({ mode: 'login', username: 'existing', password: 'secret123', agreed: true });
  await definition.submit.call(current);
  assert.strictEqual(captured.path, '/api/auth/miniprogram-login');
  assert.deepStrictEqual(captured.options.data, {
    username: 'existing', password: 'secret123', device_id: 'device-id'
  });
  assert.strictEqual(inviteContext.current(), null);
  assert.deepStrictEqual(navigation, ['/pages/home/home']);
});

require('node:test')('invalid invited registration is blocked until the share is reopened', async () => {
  let requests = 0;
  inviteContext.clear();
  api.request = () => { requests += 1; return Promise.resolve({ statusCode: 200, data: {} }); };
  const current = page({
    mode: 'register', username: 'new-user', password: 'secret123', agreed: true,
    inviteRequired: true, inviteError: '邀请已失效，请重新打开分享链接'
  });
  await definition.submit.call(current);
  assert.strictEqual(requests, 0);
  assert.match(current.data.err, /重新打开分享链接/);
});
