const assert = require('assert');
const fs = require('fs');

const calls = [];
global.getApp = () => ({ globalData: { apiBase: 'https://huangquechuanmei.com' } });
global.wx = {
  redirectTo(value) { calls.push(['redirectTo', value]); },
  switchTab(value) { calls.push(['switchTab', value]); }
};

const api = require('../miniprogram/utils/api.js');

assert.strictEqual(api.loginRedirect('/pages/ip12/ip12'), 'ip12');
assert.strictEqual(api.loginRedirect('pages/ip12/ip12'), 'ip12');
assert.strictEqual(api.loginRedirect('https://example.com'), '');
assert.strictEqual(api.loginUrl('/pages/ip12/ip12'), '/pages/login/login?redirect=ip12');
assert.strictEqual(api.loginUrl('https://example.com'), '/pages/login/login');

api.navigateAfterLogin('ip12');
api.navigateAfterLogin('', '/pages/profile/profile');
assert.deepStrictEqual(calls, [
  ['redirectTo', { url: '/pages/ip12/ip12' }],
  ['switchTab', { url: '/pages/profile/profile' }]
]);

const loginPage = fs.readFileSync('miniprogram/pages/login/login.js', 'utf8');
assert.match(loginPage, /const redirect = api\.loginRedirect\(options && options\.redirect\)/);
assert.match(loginPage, /api\.navigateAfterLogin\(this\.data\.redirect/);

calls.length = 0;
let currentRoute = 'pages/ip12/ip12';
global.getCurrentPages = () => [{ route: currentRoute }];
global.wx.getStorageSync = () => 'expired-token';
global.wx.removeStorageSync = () => {};
global.wx.request = (options) => options.success({ statusCode: 401, data: {} });
global.wx.reLaunch = (value) => calls.push(['reLaunch', value]);

api.request('/api/gen/digital-ip/projects').then(() => {
  assert.deepStrictEqual(calls, [
    ['reLaunch', { url: '/pages/login/login?redirect=ip12' }]
  ]);
  calls.length = 0;
  currentRoute = 'pages/my-card/my-card';
  return api.request('/api/auth/card/me');
}).then(() => {
  assert.deepStrictEqual(calls, [
    ['reLaunch', { url: '/pages/my-card/my-card' }]
  ]);
  console.log('ip12 and card login return checks passed');
});
