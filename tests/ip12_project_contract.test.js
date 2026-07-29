const assert = require('assert');

let page;
global.Page = (definition) => { page = definition; };
global.wx = { getStorageSync() { return ''; } };
const api = require('../miniprogram/utils/api.js');
require('../miniprogram/pages/ip12/ip12.js');

const calls = [];
api.request = (path, options) => {
  calls.push({ path, options });
  return Promise.resolve({ statusCode: 200, data: { ok: true, state: { current_module: 5 } } });
};
const context = {
  data: Object.assign({}, page.data, { conversationId: 'same-session', busy: false }),
  setData(patch) { Object.assign(this.data, patch); },
  sendMessage(message) { this.sent = message; return Promise.resolve(); }
};

(async () => {
  await page.confirmReport.call(context);
  assert.strictEqual(calls[0].path, '/workbench/ip12/api/foundation-report/confirm');
  assert.deepStrictEqual(calls[0].options.data, { conversation_id: 'same-session' });
  assert.match(context.sent, /开始模块 5/);
  assert.strictEqual(context.data.busy, false);
  console.log('IP12 Hermes confirmation checks passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
