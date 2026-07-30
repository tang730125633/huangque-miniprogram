const assert = require('assert');
const fs = require('fs');
const path = require('path');

const storage = { hq_token: 'token-a' };
const removedFiles = [];
const persistedFiles = [];
const readFailures = new Set();
let chooseMedia = null;
let failDraftWrite = false;
let delayedSave = null;
let modalConfirm = true;
let pageDefinition = null;

global.getApp = () => ({ globalData: { apiBase: 'https://example.test' } });
global.getCurrentPages = () => [];
global.wx = {
  getStorageSync: (key) => storage[key],
  setStorageSync: (key, value) => {
    if (failDraftWrite && key.indexOf('hq_draft_banana_v1:') === 0) throw new Error('storage full');
    storage[key] = value;
  },
  removeStorageSync: (key) => { delete storage[key]; },
  saveFile: ({ tempFilePath, success }) => {
    const savedFilePath = 'saved:' + tempFilePath;
    if (delayedSave) {
      delayedSave = () => { persistedFiles.push(savedFilePath); success({ savedFilePath }); };
      return;
    }
    persistedFiles.push(savedFilePath);
    success({ savedFilePath });
  },
  removeSavedFile: ({ filePath, complete }) => {
    removedFiles.push(filePath);
    if (complete) complete();
  },
  getFileSystemManager: () => ({
    readFile: ({ filePath, success, fail }) => {
      if (readFailures.has(filePath)) { fail(new Error('missing saved file')); return; }
      success({ data: 'base64:' + filePath });
    }
  }),
  chooseMedia: (options) => chooseMedia(options),
  showToast() {},
  showModal: ({ success }) => success({ confirm: modalConfirm }),
  reLaunch() {},
  stopPullDownRefresh() {}
};
global.Page = (definition) => { pageDefinition = definition; };

const api = require('../miniprogram/utils/api.js');
const drafts = require('../miniprogram/utils/drafts.js');
api.getToken = () => 'token-a';
require('../miniprogram/pages/banana/banana.js');

const draftKey = drafts.scopedKey('hq_draft_banana_v1', 'token-a');
const view = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/banana/banana.wxml'), 'utf8');

assert.match(view, /wx:for="\{\{refPreviews\}\}"/);
assert.match(view, /果肉最多 4 张/);
assert.match(view, /catchtap="removeRef"/);
assert.match(view, /bindtap="clearDraft">清空草稿/);
assert.match(view, /已自动保存|draftStatus/);

function reset() {
  Object.keys(storage).forEach((key) => { if (key !== 'hq_token') delete storage[key]; });
  removedFiles.length = 0;
  persistedFiles.length = 0;
  readFailures.clear();
  failDraftWrite = false;
  delayedSave = null;
  modalConfirm = true;
}

function page() {
  const instance = Object.assign({}, pageDefinition, {
    data: JSON.parse(JSON.stringify(pageDefinition.data)),
    setData(patch, callback) {
      Object.assign(this.data, patch);
      if (callback) callback();
    },
    poll() {}
  });
  instance.onLoad();
  return instance;
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

(async function () {
  reset();
  const debouncedPage = page();
  debouncedPage.onPrompt({ detail: { value: '快速离开也要保存' } });
  assert.strictEqual(storage[draftKey], undefined, '文字输入应防抖，不逐字同步写 storage');
  debouncedPage.onHide();
  assert.strictEqual(storage[draftKey].payload.prompt, '快速离开也要保存');

  reset();
  let chooseCalls = 0;
  let pendingChoose = null;
  chooseMedia = (options) => { chooseCalls += 1; pendingChoose = options; };
  const guardedPage = page();
  guardedPage.data.engine = 'xiaole';
  guardedPage.data.maxRefCount = 4;
  guardedPage.chooseRef();
  guardedPage.chooseRef();
  assert.strictEqual(chooseCalls, 1, '连续点击不能并发保存两批参考图');
  pendingChoose.fail();
  assert.strictEqual(guardedPage.data.refBusy, false);

  reset();
  let chosenCount = 0;
  chooseMedia = (options) => {
    chosenCount = options.count;
    options.success({ tempFiles: [1, 2, 3, 4].map((n) => ({ tempFilePath: 'temp:' + n })) });
  };
  let imagePage = page();
  imagePage.data.engine = 'xiaole';
  imagePage.data.maxRefCount = 4;
  imagePage.chooseRef();
  await flush();
  assert.strictEqual(chosenCount, 4);
  assert.deepStrictEqual(imagePage.data.refPreviews, persistedFiles);
  assert.strictEqual(imagePage._refImages.length, 4);
  assert.deepStrictEqual(storage[draftKey].payload.refFiles, persistedFiles);
  assert.strictEqual(JSON.stringify(storage[draftKey].payload).includes('base64:'), false, '草稿不能保存 base64');

  modalConfirm = false;
  imagePage.selectEngine({ currentTarget: { dataset: { k: 'gpt' } } });
  assert.strictEqual(imagePage.data.engine, 'xiaole', '取消确认必须保留多图和原引擎');
  assert.strictEqual(imagePage.data.refPreviews.length, 4);
  modalConfirm = true;
  imagePage.selectEngine({ currentTarget: { dataset: { k: 'gpt' } } });
  assert.strictEqual(imagePage.data.maxRefCount, 1);
  assert.deepStrictEqual(imagePage.data.refPreviews, ['saved:temp:1']);
  assert.deepStrictEqual(imagePage._refImages, ['base64:saved:temp:1']);
  assert.deepStrictEqual(removedFiles.slice(-3), ['saved:temp:2', 'saved:temp:3', 'saved:temp:4']);
  assert.deepStrictEqual(storage[draftKey].payload.refFiles, ['saved:temp:1']);

  modalConfirm = false;
  imagePage.clearRef();
  assert.deepStrictEqual(imagePage.data.refPreviews, ['saved:temp:1'], '取消清空必须保留参考图');

  reset();
  let requested = null;
  api.request = (endpoint, options) => {
    requested = { endpoint, body: options.data };
    return Promise.resolve({ statusCode: 500, data: { detail: 'upstream unavailable' } });
  };
  imagePage = page();
  Object.assign(imagePage.data, {
    engine: 'xiaole', prompt: '参考人物与场景生成海报', maxRefCount: 4,
    refPreviews: ['saved:a', 'saved:b', 'saved:c', 'saved:d']
  });
  imagePage._refImages = ['a', 'b', 'c', 'd'];
  imagePage.saveDraft();
  imagePage.generate();
  await flush();
  assert.strictEqual(requested.endpoint, '/api/gen/image');
  assert.deepStrictEqual(requested.body.reference_images, ['a', 'b', 'c', 'd']);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(requested.body, 'image'), false);
  assert.ok(storage[draftKey], '未受理任务必须保留草稿');

  const singlePage = page();
  Object.assign(singlePage.data, { engine: 'gpt', prompt: '单图修改', refPreviews: ['saved:a'] });
  singlePage._refImages = ['first', 'ignored'];
  singlePage.generate();
  await flush();
  assert.strictEqual(requested.endpoint, '/api/gen/image');
  assert.strictEqual(requested.body.image, 'first');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(requested.body, 'reference_images'), false);

  api.request = (endpoint, options) => {
    requested = { endpoint, body: options.data };
    return Promise.resolve({ statusCode: 200, data: { job_id: 91 } });
  };
  imagePage.generate();
  await flush();
  assert.strictEqual(storage[draftKey], undefined, '只有有效 job_id 才清草稿');
  assert.deepStrictEqual(imagePage.data.refPreviews, []);
  assert.match(imagePage.data.draftStatus, /任务已受理/);

  reset();
  drafts.save(draftKey, {
    prompt: '恢复草稿', promptTemplateKey: 'poster', tplBrand: '品牌', tplColor: '红色',
    tplSelling: '卖点', tplPrice: '99元', promptUndo: '', canUndoPrompt: false,
    engine: 'xiaole', ratio: '1:1', quality: 'std', count: 2,
    refFiles: ['saved:r1', 'saved:r2']
  }, ['saved:r1', 'saved:r2']);
  const restoredPage = page();
  restoredPage.restoreDraft();
  await flush();
  assert.strictEqual(restoredPage.data.prompt, '恢复草稿');
  assert.deepStrictEqual(restoredPage.data.refPreviews, ['saved:r1', 'saved:r2']);
  assert.deepStrictEqual(restoredPage._refImages, ['base64:saved:r1', 'base64:saved:r2']);

  reset();
  drafts.save(draftKey, {
    prompt: '缺图草稿', promptTemplateKey: 'poster', engine: 'xiaole', ratio: '1:1', quality: 'std', count: 1,
    refFiles: ['saved:ok', 'saved:missing']
  }, ['saved:ok', 'saved:missing']);
  readFailures.add('saved:missing');
  const missingPage = page();
  missingPage.restoreDraft();
  await flush();
  assert.deepStrictEqual(missingPage.data.refPreviews, ['saved:ok'], '失效持久文件不能留下假预览');
  assert.deepStrictEqual(missingPage._refImages, ['base64:saved:ok']);
  assert.strictEqual(missingPage.data.draftStatusError, true);
  assert.deepStrictEqual(storage[draftKey].payload.refFiles, ['saved:ok']);

  reset();
  chooseMedia = (options) => options.success({ tempFiles: [{ tempFilePath: 'temp:fail' }] });
  failDraftWrite = true;
  const failedPage = page();
  failedPage.data.engine = 'xiaole';
  failedPage.data.maxRefCount = 4;
  failedPage.chooseRef();
  await flush();
  assert.deepStrictEqual(failedPage.data.refPreviews, [], '保存失败不能留下假预览');
  assert.strictEqual(failedPage.data.draftStatusError, true);
  assert.deepStrictEqual(removedFiles, ['saved:temp:fail']);

  reset();
  delayedSave = true;
  chooseMedia = (options) => options.success({ tempFiles: [{ tempFilePath: 'temp:late' }] });
  const oldPage = page();
  oldPage.data.engine = 'xiaole';
  oldPage.data.maxRefCount = 4;
  oldPage.chooseRef();
  oldPage.onUnload();
  const newPage = page();
  newPage.onPrompt({ detail: { value: '新页面草稿' } });
  newPage.onHide();
  delayedSave();
  await flush();
  await flush();
  assert.strictEqual(storage[draftKey].payload.prompt, '新页面草稿', '旧页面异步回调不能覆盖新草稿');
  assert.deepStrictEqual(storage[draftKey].payload.refFiles, []);
  assert.ok(removedFiles.includes('saved:temp:late'));

  reset();
  let resolveSubmit;
  api.request = () => new Promise((resolve) => { resolveSubmit = resolve; });
  const editedPage = page();
  editedPage.data.prompt = '点击时的提示词';
  editedPage.saveDraft();
  editedPage.generate();
  editedPage.onPrompt({ detail: { value: '点击后继续编辑' } });
  resolveSubmit({ statusCode: 200, data: { job_id: 92 } });
  await flush();
  assert.strictEqual(storage[draftKey].payload.prompt, '点击后继续编辑', '已受理响应不能清掉提交后的编辑');

  reset();
  let resolveOldSubmit;
  api.request = () => new Promise((resolve) => { resolveOldSubmit = resolve; });
  const submittingPage = page();
  submittingPage.data.prompt = '旧页面提交';
  submittingPage.saveDraft();
  submittingPage.generate();
  submittingPage.onUnload();
  const replacementPage = page();
  replacementPage.onPrompt({ detail: { value: '新页面内容' } });
  replacementPage.onHide();
  resolveOldSubmit({ statusCode: 200, data: { job_id: 93 } });
  await flush();
  assert.strictEqual(storage[draftKey].payload.prompt, '新页面内容', '旧页面请求响应不能清新页面草稿');

  reset();
  let resolveBackgroundSubmit;
  api.request = () => new Promise((resolve) => { resolveBackgroundSubmit = resolve; });
  const backgroundPage = page();
  backgroundPage.data.prompt = '后台返回也应清理已受理草稿';
  backgroundPage.saveDraft();
  backgroundPage.generate();
  backgroundPage.onHide();
  resolveBackgroundSubmit({ statusCode: 200, data: { job_id: 94 } });
  await flush();
  assert.strictEqual(storage[draftKey], undefined, '后台收到有效 job_id 也应清理未变化草稿');

  reset();
  api.request = () => Promise.resolve({ statusCode: 500, data: { job_id: 95 } });
  const badStatusPage = page();
  badStatusPage.data.prompt = '错误状态不能清草稿';
  badStatusPage.saveDraft();
  badStatusPage.generate();
  await flush();
  assert.ok(storage[draftKey], '非 2xx 即使带 job_id 也不能视为已受理');

  reset();
  let resolveAbaSubmit;
  api.request = () => new Promise((resolve) => { resolveAbaSubmit = resolve; });
  const abaOldPage = page();
  abaOldPage.data.prompt = '旧请求';
  abaOldPage.saveDraft();
  abaOldPage.generate();
  const staleRevision = drafts.getRevision(draftKey);
  abaOldPage.onUnload();
  drafts.clear(draftKey);
  const abaNewPage = page();
  abaNewPage.data.prompt = '清空后重建的新草稿';
  abaNewPage.saveDraft();
  abaNewPage.saveDraft();
  assert.notStrictEqual(drafts.getRevision(draftKey), staleRevision);
  resolveAbaSubmit({ statusCode: 200, data: { job_id: 96 } });
  await flush();
  assert.strictEqual(storage[draftKey].payload.prompt, '清空后重建的新草稿', '旧请求不能因版本绕回删除新草稿');

  console.log('banana multi-reference and draft tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
