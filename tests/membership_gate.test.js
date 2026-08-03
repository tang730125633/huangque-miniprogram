const assert = require('assert');
const fs = require('fs');
const path = require('path');

let modal = null;
let navigated = '';
global.getApp = function () {
  return { globalData: { apiBase: 'https://example.test' } };
};
global.getCurrentPages = function () { return []; };
global.wx = {
  getStorageSync() { return 'token'; },
  removeStorageSync() {},
  request(options) {
    options.success({
      statusCode: 403,
      data: {
        code: 'membership_required',
        detail: '请先开通会员'
      }
    });
  },
  showModal(options) {
    modal = options;
    options.success({ confirm: true });
    options.complete();
  },
  navigateTo(options) { navigated = options.url; }
};

const api = require('../miniprogram/utils/api.js');

(async function () {
  const response = await api.request('/api/gen/image', { method: 'POST' });
  assert.strictEqual(api.isMembershipRequired(response), true);
  assert.ok(modal);
  assert.strictEqual(modal.title, '需要有效会员');
  assert.strictEqual(navigated, '/pages/recharge/recharge');

  const root = path.resolve(__dirname, '..');
  const home = fs.readFileSync(path.join(root, 'miniprogram/pages/home/home.js'), 'utf8');
  assert.match(home, /membershipEnforced && !this\.data\.membershipActive/);
  assert.match(home, /membership_enforcement_enabled/);
  console.log('membership gate tests passed');
})().catch(function (error) {
  console.error(error);
  process.exit(1);
});
