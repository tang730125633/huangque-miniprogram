const assert = require('assert');

let page;
global.Page = function (definition) { page = definition; };
const recharge = require('../miniprogram/pages/recharge/recharge.js');
const api = require('../miniprogram/utils/api.js');

const nonmember = recharge.buildRechargeConfig({ membership_status: 'none', membership_active: false });
assert.strictEqual(nonmember.membershipActive, false);
assert.deepStrictEqual(nonmember.packages, [recharge.MEMBERSHIP_PACKAGE]);
assert.strictEqual(nonmember.custom, null);

const member = recharge.buildRechargeConfig({ membership_status: 'active', membership_active: true });
assert.strictEqual(member.membershipActive, true);
assert.strictEqual(member.packages.length, 3);
assert.strictEqual(member.custom.min_amount_yuan, 10);
assert.strictEqual(member.custom.max_amount_yuan, 5000);

assert.deepStrictEqual(recharge.paymentPayload('membership_experience', 499, 'code'), {
  amount: 499,
  js_code: 'code',
  product_type: 'membership_experience'
});
assert.strictEqual(recharge.isMiniProgramWxPayOrder({ status: 'pending', note: '微信小程序开通体验官' }), true);
assert.strictEqual(recharge.isMiniProgramWxPayOrder({ status: 'pending', note: '人工充值申请' }), false);

const calls = [];
api.request = function (path, options) {
  calls.push({ path, options });
  if (path.indexOf('/orders') >= 0) return Promise.resolve({ statusCode: 200, data: { items: [{ order_id: 'pending-1', status: 'pending' }] } });
  return Promise.resolve({ statusCode: 200, data: { order: { order_id: 'pending-1', status: 'approved' } } });
};

const context = { reconcileOrder: page.reconcileOrder };
page.pollPaid.call(context, 'pending-1', 1).then(function (order) {
  assert.strictEqual(order.status, 'approved');
  assert.deepStrictEqual(calls[1], {
    path: '/api/auth/wxpay/reconcile',
    options: { method: 'POST', data: { order_id: 'pending-1' }, timeout: 30000 }
  });
  console.log('membership payment tests passed');
}).catch(function (error) {
  console.error(error);
  process.exit(1);
});
