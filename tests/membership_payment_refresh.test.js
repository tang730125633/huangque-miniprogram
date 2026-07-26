const assert = require('assert');

let page;
global.Page = function (definition) { page = definition; };

const api = require('../miniprogram/utils/api.js');
require('../miniprogram/pages/recharge/recharge.js');

const calls = [];
api.request = function (requestPath) {
  calls.push(requestPath);
  if (requestPath === '/api/auth/me') {
    return Promise.resolve({
      statusCode: 200,
      data: {
        user: {
          points: 16,
          membership_status: 'none',
          membership_active: false
        }
      }
    });
  }
  return Promise.resolve({ statusCode: 403, data: { code: 'membership_required' } });
};

const context = {
  data: { loading: false },
  setData(next) { this.data = Object.assign({}, this.data, next); },
  refreshOrders() { return Promise.resolve([]); }
};

(async function () {
  const refresh = page.refresh.call(context);
  assert.ok(refresh && typeof refresh.then === 'function');
  await refresh;
  assert.deepStrictEqual(calls, ['/api/auth/me']);
  assert.strictEqual(context.data.membershipActive, false);
  assert.strictEqual(context.data.packages.length, 1);

  calls.length = 0;
  api.request = function (requestPath) {
    calls.push(requestPath);
    return Promise.resolve({
      statusCode: 200,
      data: { items: [{ order_id: 'membership-1', status: 'created', created_at: 0, amount_fen: 49900 }] }
    });
  };
  const confirmed = [];
  const orderContext = {
    data: { membershipActive: false },
    setData(next) { this.data = Object.assign({}, this.data, next); },
    formatOrder: page.formatOrder,
    confirmVirtualOrder(orderId) { confirmed.push(orderId); return Promise.resolve({ ok: false }); }
  };
  await page.refreshOrders.call(orderContext, true);
  assert.deepStrictEqual(calls, ['/api/auth/virtual-pay/orders?limit=20']);
  assert.deepStrictEqual(confirmed, ['membership-1']);
  console.log('membership payment refresh tests passed');
})().catch(function (error) {
  console.error(error);
  process.exit(1);
});
