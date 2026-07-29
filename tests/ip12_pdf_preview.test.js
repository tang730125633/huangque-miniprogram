const assert = require('assert');

let page;
global.Page = (definition) => { page = definition; };
const api = require('../miniprogram/utils/api.js');
require('../miniprogram/pages/ip12/ip12.js');

const calls = [];
api.downloadProtected = (url) => { calls.push(url); return Promise.resolve('/tmp/report.pdf'); };
global.wx = { openDocument(options) { calls.push(options); options.success(); } };
const context = {
  data: Object.assign({}, page.data, { conversationId: 'same-session', pdfBusy: false }),
  setData(patch) { Object.assign(this.data, patch); }
};

(async () => {
  await page.downloadReport.call(context);
  assert.strictEqual(calls[0], '/workbench/ip12/api/foundation-report/same-session.pdf');
  assert.strictEqual(calls[1].filePath, '/tmp/report.pdf');
  assert.strictEqual(calls[1].showMenu, true);
  assert.strictEqual(context.data.pdfBusy, false);
  assert.match(context.data.note, /保存或转发/);
  console.log('IP12 Hermes PDF checks passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
