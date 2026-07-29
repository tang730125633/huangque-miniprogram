const assert = require('assert');

let page;
global.Page = (definition) => { page = definition; };
global.wx = { getStorageSync() { return ''; } };
const api = require('../miniprogram/utils/api.js');
require('../miniprogram/pages/ip12/ip12.js');

const calls = [];
api.request = (path, options) => {
  calls.push({ path, options });
  return Promise.resolve({ statusCode: 200, data: { ok: true } });
};
const context = {
  data: Object.assign({}, page.data, { conversationId: 'mine', input: '我的经历', busy: false }),
  setData(patch) { Object.assign(this.data, patch); },
  openConversation(id) { this.opened = id; return Promise.resolve({ id }); }
};

(async () => {
  await page.sendMessage.call(context, '');
  assert.strictEqual(calls[0].path, '/workbench/ip12/api/chat-complete');
  assert.deepStrictEqual(calls[0].options.data, { conversation_id: 'mine', message: '我的经历' });
  assert.strictEqual(context.opened, 'mine');
  assert.strictEqual(context.data.busy, false);
  console.log('IP12 Hermes chat checks passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
