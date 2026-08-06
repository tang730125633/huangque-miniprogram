const assert = require('assert');
const fs = require('fs');
const path = require('path');

let page;
let modal;
const toasts = [];
global.Page = (definition) => { page = definition; };
global.wx = {
  showToast(options) { toasts.push(options); },
  showModal(options) { modal = options; }
};

const api = require('../miniprogram/utils/api.js');
require('../miniprogram/pages/admin/admin.js');

const calls = [];
api.request = (requestPath, options) => {
  calls.push({ path: requestPath, options });
  return Promise.resolve({ statusCode: 200, data: { ok: true } });
};

const context = {
  data: {
    users: [{ id: 7, account: 'ali**', display_name: 'Alice' }],
    target: {}, newPassword: '', confirmPassword: '', saving: false
  },
  setData(next) { Object.assign(this.data, next); },
  doPasswordReset: page.doPasswordReset,
  refreshAll() { this.refreshed = true; }
};

page.openPasswordReset.call(context, { currentTarget: { dataset: { userId: 7 } } });
assert.strictEqual(context.data.showPasswordReset, true);
context.data.newPassword = 'temporary456';
context.data.confirmPassword = 'different456';
page.submitPasswordReset.call(context);
assert.strictEqual(calls.length, 0);
assert.strictEqual(toasts.pop().title, '两次输入的密码不一致');

context.data.confirmPassword = 'temporary456';
page.submitPasswordReset.call(context);
assert.strictEqual(modal.title, '确认重置密码');
modal.success({ confirm: true });

setImmediate(() => {
  assert.deepStrictEqual(calls[0], {
    path: '/api/admin/users/password/reset',
    options: { method: 'POST', data: { user_id: 7, new_password: 'temporary456' } }
  });
  assert.strictEqual(context.data.showPasswordReset, false);
  assert.strictEqual(context.data.newPassword, '');
  assert.strictEqual(context.refreshed, true);
  const wxml = fs.readFileSync(path.join(__dirname, '..', 'miniprogram/pages/admin/admin.wxml'), 'utf8');
  assert.match(wxml, /password="\{\{true\}\}"/);
  assert.match(wxml, /catchtap="openPasswordReset"/);
  console.log('admin password reset tests passed');
});
