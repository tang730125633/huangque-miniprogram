const assert = require('assert');
const fs = require('fs');
const path = require('path');

const loginWxml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/login/login.wxml'), 'utf8');
assert.match(loginWxml, /声音信息专项授权/);
assert.match(loginWxml, /legal\?type=voiceprint/);
assert.match(loginWxml, /登录不代表声纹授权/);
assert.match(loginWxml, /再次弹窗，并要求单独勾选同意/);

const apiPath = require.resolve('../miniprogram/utils/api.js');
const api = require(apiPath);
let requestCount = 0;
api.request = function () {
  requestCount += 1;
  return Promise.resolve({ statusCode: 500, data: { detail: 'test' } });
};

let definition = null;
global.Page = function (value) { definition = value; };
global.wx = {
  openPrivacyContract() {},
  navigateTo() {},
};

require('../miniprogram/pages/login/login.js');
assert.ok(definition, 'login page should register itself');
assert.strictEqual(definition.data.agreed, false, 'agreement must be unchecked by default');

function context(overrides) {
  return Object.assign({}, definition, {
    data: Object.assign({}, definition.data, overrides || {}),
    setData(patch) { Object.assign(this.data, patch); },
  });
}

const blocked = context({ username: 'reviewer', password: 'secret', agreed: false });
definition.submit.call(blocked);
assert.strictEqual(requestCount, 0, 'login request must be blocked until the user agrees');
assert.ok(blocked.data.err.includes('请先阅读并勾选'));

const changed = context();
definition.onAgreementChange.call(changed, { detail: { value: ['accepted'] } });
assert.strictEqual(changed.data.agreed, true);
definition.onAgreementChange.call(changed, { detail: { value: [] } });
assert.strictEqual(changed.data.agreed, false);

console.log('login consent tests passed');
