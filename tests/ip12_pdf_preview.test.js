const assert = require('assert');

let page;
global.Page = (definition) => { page = definition; };
const api = require('../miniprogram/utils/api.js');
require('../miniprogram/pages/ip12/ip12.js');

function context() {
  return {
    data: Object.assign({}, page.data, { reportPdfUrl: '/report.pdf' }),
    setData(patch) { Object.assign(this.data, patch); }
  };
}

(async () => {
  let downloads = 0;
  global.wx = {
    getStorageSync() { return ''; },
    downloadFile(options) { downloads += 1; options.success({ statusCode: 200, tempFilePath: '/tmp/report-' + downloads + '.pdf' }); }
  };
  await api.downloadProtected('https://huangquechuanmei.com/report.pdf');
  await api.downloadProtected('https://huangquechuanmei.com/report.pdf');
  assert.strictEqual(downloads, 2, 'regenerated PDFs must not reuse an old temporary file');
  global.wx.downloadFile = (options) => options.success({ statusCode: 401 });
  await assert.rejects(
    api.downloadProtected('https://huangquechuanmei.com/unauthorized.pdf'),
    (error) => error.statusCode === 401
  );

  const calls = [];
  api.downloadProtected = () => Promise.resolve('/tmp/report.pdf');
  global.wx = {
    openDocument(options) { calls.push(options); options.success(); },
    reLaunch() { throw new Error('unexpected login redirect'); }
  };
  const ctx = context();
  await page.downloadReport.call(ctx);
  assert.strictEqual(calls[0].filePath, '/tmp/report.pdf');
  assert.strictEqual(calls[0].fileType, 'pdf');
  assert.strictEqual(calls[0].showMenu, true);
  assert.strictEqual(ctx.data.pdfBusy, false);
  assert.match(ctx.data.note, /保存或转发/);

  let redirected = '';
  api.downloadProtected = () => Promise.reject(Object.assign(new Error('unauthorized'), { statusCode: 401 }));
  api.clearToken = () => {};
  api.loginUrl = () => '/pages/login/login?redirect=ip12';
  global.wx.reLaunch = (options) => { redirected = options.url; };
  await page.downloadReport.call(context());
  assert.match(redirected, /login/);
  console.log('ip12 PDF preview checks passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
