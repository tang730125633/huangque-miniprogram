const assert = require('assert');

const storage = {};
const removedFiles = [];
let failSet = false;
let failIndex = false;
global.wx = {
  getStorageSync: (key) => storage[key],
  setStorageSync: (key, value) => {
    if (failIndex && key === 'hq_draft_index_v1') throw new Error('index full');
    if (failSet && key !== 'hq_draft_index_v1') throw new Error('storage full');
    storage[key] = value;
  },
  removeStorageSync: (key) => { delete storage[key]; },
  saveFile: ({ tempFilePath, success }) => success({ savedFilePath: 'saved:' + tempFilePath }),
  removeSavedFile: ({ filePath, complete }) => { removedFiles.push(filePath); complete(); }
};

const drafts = require('../miniprogram/utils/drafts.js');

const keyA = drafts.scopedKey('draft', 'token-a');
const keyB = drafts.scopedKey('draft', 'token-b');
assert.notStrictEqual(keyA, keyB);

assert.strictEqual(drafts.save(keyA, { prompt: '你好' }, ['saved:a', 'saved:a']), true);
assert.deepStrictEqual(drafts.load(keyA), { prompt: '你好' });
assert.deepStrictEqual(storage[keyA].files, ['saved:a']);

assert.strictEqual(drafts.save(keyA, { prompt: '更新' }, ['saved:b']), true);
assert.deepStrictEqual(drafts.load(keyA), { prompt: '更新' });
assert.deepStrictEqual(removedFiles, ['saved:a']);

drafts.clear(keyA);
assert.strictEqual(drafts.load(keyA), null);
assert.deepStrictEqual(removedFiles, ['saved:a', 'saved:b']);

storage['draft:expired'] = {
  version: 1,
  updatedAt: Date.now() - drafts.MAX_AGE_MS - 1,
  payload: { prompt: '旧内容' },
  files: ['saved:old']
};
storage.hq_draft_index_v1 = ['draft:expired'];
assert.strictEqual(drafts.load('draft:expired'), null);
assert.deepStrictEqual(removedFiles, ['saved:a', 'saved:b', 'saved:old']);

storage['draft:invalid'] = { version: 0, payload: { prompt: '旧格式' }, files: ['saved:invalid'] };
storage.hq_draft_index_v1 = ['draft:invalid'];
drafts.cleanupExpired();
assert.strictEqual(storage['draft:invalid'], undefined);
assert.deepStrictEqual(removedFiles, ['saved:a', 'saved:b', 'saved:old', 'saved:invalid']);

failSet = true;
assert.strictEqual(drafts.save('draft:full', { prompt: '无法保存' }, ['saved:orphan']), false);
failSet = false;
assert.strictEqual(storage['draft:full'], undefined);
assert.deepStrictEqual(removedFiles, ['saved:a', 'saved:b', 'saved:old', 'saved:invalid', 'saved:orphan']);

failIndex = true;
assert.strictEqual(drafts.save('draft:unindexed', { prompt: '不能泄漏' }, ['saved:unindexed']), false);
failIndex = false;
assert.strictEqual(storage['draft:unindexed'], undefined);
assert.ok(removedFiles.includes('saved:unindexed'));

storage['draft:broken-files'] = {
  version: 1, revision: 2, updatedAt: Date.now(), payload: { prompt: '旧内容' }, files: 'not-an-array'
};
storage.hq_draft_index_v1 = (storage.hq_draft_index_v1 || []).concat(['draft:broken-files']);
assert.strictEqual(drafts.save('draft:broken-files', { prompt: '修复后' }, ['saved:fixed']), true);
assert.deepStrictEqual(drafts.load('draft:broken-files'), { prompt: '修复后' });
assert.deepStrictEqual(storage['draft:broken-files'].files, ['saved:fixed']);
const fixedRevision = drafts.getRevision('draft:broken-files');
assert.strictEqual(drafts.clearIfRevision('draft:broken-files', 'stale-revision'), false);
assert.ok(storage['draft:broken-files']);
assert.strictEqual(drafts.clearIfRevision('draft:broken-files', fixedRevision), true);
assert.strictEqual(storage['draft:broken-files'], undefined);

assert.strictEqual(drafts.save('draft:aba', { prompt: '旧草稿' }, []), true);
const staleRevision = drafts.getRevision('draft:aba');
drafts.clear('draft:aba');
assert.strictEqual(drafts.save('draft:aba', { prompt: '新草稿' }, []), true);
assert.notStrictEqual(drafts.getRevision('draft:aba'), staleRevision);
assert.strictEqual(drafts.clearIfRevision('draft:aba', staleRevision), false);
assert.deepStrictEqual(drafts.load('draft:aba'), { prompt: '新草稿' });

(async function () {
  assert.strictEqual(await drafts.persistFile('temp:image'), 'saved:temp:image');
  console.log('draft utility tests passed');
})().catch((error) => { console.error(error); process.exit(1); });
