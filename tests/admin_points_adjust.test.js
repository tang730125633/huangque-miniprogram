const assert = require('assert');

let page;
let modal;
global.Page = (definition) => { page = definition; };
global.wx = {
  showToast() {},
  showModal(options) { modal = options; }
};

const api = require('../miniprogram/utils/api.js');
require('../miniprogram/pages/admin/admin.js');

const calls = [];
api.request = (requestPath, options) => {
  calls.push({ path: requestPath, options });
  return Promise.resolve({ statusCode: 200, data: { adjustment: { after: 1016 } } });
};

const context = {
  data: {
    users: [{ id: 7, account: '131****3191', display_name: '131****3191', points: 16 }],
    target: {}, delta: '1000', reason: '线下充值', saving: false
  },
  setData(next) { Object.assign(this.data, next); },
  doAdjust: page.doAdjust,
  refreshAll() { this.refreshed = true; }
};

page.openAdjust.call(context, { currentTarget: { dataset: { userId: 7 } } });
context.data.delta = '1000';
context.data.reason = '线下充值';
page.submitAdjust.call(context);
assert.match(modal.content, /131\*\*\*\*3191/);
modal.success({ confirm: true });

setImmediate(() => {
  assert.deepStrictEqual(calls[0], {
    path: '/api/admin/points/adjust',
    options: { method: 'POST', data: { user_id: 7, delta: 1000, reason: '线下充值' } }
  });
  assert.strictEqual(context.data.showAdjust, false);
  assert.strictEqual(context.refreshed, true);
  console.log('admin points adjust tests passed');
});
