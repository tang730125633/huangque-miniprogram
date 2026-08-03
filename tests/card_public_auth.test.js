const assert = require('node:assert');
const test = require('node:test');

const store = { hq_token: 'private-token' };
let captured;
let nextStatus = 200;
global.getApp = () => ({ globalData: { apiBase: 'https://example.test' } });
global.getCurrentPages = () => [];
global.wx = {
  getStorageSync(key) { return store[key]; },
  setStorageSync(key, value) { store[key] = value; },
  removeStorageSync(key) { delete store[key]; },
  request(options) {
    captured = options;
    options.success({ statusCode: nextStatus, data: {} });
  }
};

const api = require('../miniprogram/utils/api.js');

test('public card requests omit bearer while protected requests keep it', async () => {
  nextStatus = 401;
  await api.request('/api/auth/card/public?id=card-1', { auth: false });
  assert.strictEqual(captured.header.Authorization, undefined);
  assert.strictEqual(store.hq_token, 'private-token');
  nextStatus = 200;
  await api.request('/api/auth/card/me');
  assert.strictEqual(captured.header.Authorization, 'Bearer private-token');
});
