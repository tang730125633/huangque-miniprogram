const assert = require('assert');
const fs = require('fs');
const path = require('path');

let page;
global.Page = function (definition) { page = definition; };
const recharge = require('../miniprogram/pages/recharge/recharge.js');
const api = require('../miniprogram/utils/api.js');

const nonmember = recharge.buildRechargeConfig({ membership_status: 'none', membership_active: false });
assert.strictEqual(nonmember.membershipActive, false);
assert.deepStrictEqual(nonmember.packages, [recharge.MEMBERSHIP_PACKAGE]);
assert.strictEqual(nonmember.custom, null);

const virtualConfig = {
  configured: true,
  environment: 'production',
  items: [
    { id: 'points_1000', title: '1000 点', price_yuan: '75.00', points: 1000 }
  ],
  custom: {
    package_id: 'custom_points',
    min_amount_yuan: 10,
    max_amount_yuan: 5000,
    points_per_yuan: 10
  }
};
const member = recharge.buildRechargeConfig(
  { membership_status: 'active', membership_active: true },
  virtualConfig
);
assert.strictEqual(member.membershipActive, true);
assert.deepStrictEqual(member.packages, virtualConfig.items);
assert.strictEqual(member.packages[0].price_yuan, '75.00');
assert.strictEqual(member.custom.min_amount_yuan, 10);
assert.strictEqual(member.custom.max_amount_yuan, 5000);
assert.strictEqual(member.configured, true);
assert.strictEqual(member.environment, 'production');

assert.deepStrictEqual(recharge.paymentPayload('membership_experience', 499, 'code'), {
  amount: 499,
  js_code: 'code',
  product_type: 'membership_experience'
});
assert.strictEqual(recharge.paymentMode('membership_experience'), 'jsapi');
assert.strictEqual(recharge.paymentMode('points_1000'), 'virtual');
assert.strictEqual(recharge.paymentMode('custom_points'), 'virtual');
assert.deepStrictEqual(recharge.virtualPaymentPayload('points_1000', null, 'code'), {
  package_id: 'points_1000',
  wx_code: 'code'
});
assert.deepStrictEqual(recharge.virtualPaymentPayload('custom_points', 123, 'code'), {
  package_id: 'custom_points',
  wx_code: 'code',
  custom_amount_yuan: 123
});

const rechargeWxml = fs.readFileSync(
  path.join(__dirname, '..', 'miniprogram', 'pages', 'recharge', 'recharge.wxml'),
  'utf8'
);
assert.ok(rechargeWxml.includes('微信官方虚拟支付'));
assert.ok(!rechargeWxml.includes('微信支付 V3'));
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
