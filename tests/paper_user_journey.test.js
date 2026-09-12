const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const store = new Map();
let component;
global.wx = {
  getStorageSync: key => store.get(key),
  setStorageSync: (key, value) => store.set(key, structuredClone(value)),
  removeStorageSync: key => store.delete(key),
  showToast() {},
};
global.getApp = () => ({ globalData: { apiBase: 'https://huangquechuanmei.com' } });
global.getCurrentPages = () => [];
global.Component = value => { component = value; };

const api = require('../miniprogram/paper/services/api');
api.setSession({ token: 'journey-token', user: { username: 'journey-user' } });
require('../miniprogram/paper/components/screen/index');

function setData(patch) {
  for (const [key, value] of Object.entries(patch)) {
    const nested = key.match(/^agentMessages\[(\d+)\]\.(audios|videos)\[(\d+)\]\.(\w+)$/);
    if (nested) this.data.agentMessages[Number(nested[1])][nested[2]][Number(nested[3])][nested[4]] = value;
    else this.data[key] = value;
  }
}
function textOf(nodes) {
  return (nodes || []).map(node => node.type === 'text' ? node.text : textOf(node.children)).join('');
}

test('assistant Markdown becomes readable blocks and MP3 becomes a player', async () => {
  const originalRequest = api.request, originalMedia = api.mediaSource;
  api.request = async requestPath => {
    assert.equal(requestPath, '/workbench/ip12/api/v4/restore/sid-md?limit=30');
    return { ok: true, history: [{ role: 'assistant', content: '# 小结\n**重点**先做\n- 第一步\n> 慢慢来\n```\n**代码原样**\n```\n音频：https://cdn.example.com/demo.mp3' }], delegations: {}, widgets: [], film: false, report: {} };
  };
  api.mediaSource = async url => url;
  const ctx = { alive: true, data: { agentSessionId: '' }, setData, scrollAgent() {} };
  await component.methods.restoreAgent.call(ctx, 'sid-md');
  const message = ctx.data.agentMessages[0];
  assert.equal(message.audios.length, 1);
  assert.doesNotMatch(textOf(message.richNodes.slice(0, -2)), /\*\*|^#|^>|^- /m);
  assert.match(textOf(message.richNodes), /小结重点先做• 第一步慢慢来/);
  assert(message.richNodes.some(node => textOf([node]) === '**代码原样**'));

  let played = false;
  global.wx.createInnerAudioContext = () => ({ src: '', play() { played = true; }, pause() {}, destroy() {}, onEnded() {}, onError() {} });
  api.mediaSource = async () => 'wxfile://demo.mp3';
  ctx.data.agentMessages = [message];
  await component.methods.toggleAgentAudio.call(ctx, { currentTarget: { dataset: { message: 0, audio: 0 } } });
  assert.equal(played, true);
  assert.equal(ctx.data.agentMessages[0].audios[0].playing, true);
  api.request = originalRequest; api.mediaSource = originalMedia;
});

test('voice slots remain visible when the main turn film mode changes', async () => {
  const originalRequest = api.request;
  api.request = async () => ({ ok: true, history: [], film: true, delegations: {}, report: {}, selected_choices: {}, widgets: [{
    id: 'voice_pick:audio-slots', gen: 2, type: 'voice_pick', film: false, title: '声音克隆槽位',
    items: [{ id: 'slot-a', title: '我的克隆音色', slot_id: 'slot-a' }],
  }] });
  const ctx = { alive: true, data: { agentSessionId: '' }, setData, scrollAgent() {} };
  await component.methods.restoreAgent.call(ctx, 'sid-voice');
  assert.equal(ctx.data.agentWidgets.length, 1);
  assert.equal(ctx.data.agentWidgets[0].type, 'voice_pick');
  assert.equal(ctx.data.agentWidgets[0].items[0].slotId, 'slot-a');
  api.request = originalRequest;
});

test('history management calls the deployed batch-delete contract', async () => {
  const originalRequest = api.request;
  let request;
  api.request = async (requestPath, method, data) => { request = { requestPath, method, data }; return { ok: true, deleted: ['old'], failed: [] }; };
  global.wx.showModal = options => options.success({ confirm: true });
  const ctx = {
    alive: true,
    data: { agentSessionId: 'current', agentHistorySessions: [{ sid: 'current', selected: false }, { sid: 'old', selected: true }], agentSessions: [] },
    setData,
    run(fn) { this.pending = fn(); return this.pending; },
    toast() {},
  };
  component.methods.deleteAgentHistory.call(ctx);
  await ctx.pending;
  assert.deepEqual(request, { requestPath: '/workbench/ip12/api/v4/sessions/delete', method: 'POST', data: { session_ids: ['old'] } });
  assert.deepEqual(ctx.data.agentHistorySessions.map(item => item.sid), ['current']);
  api.request = originalRequest;
});

test('deleting the current conversation clears the dead session before replacement fails', async () => {
  const originalRequest = api.request;
  api.request = async requestPath => {
    if (requestPath.endsWith('/sessions/delete')) return { ok: true, deleted: ['dead'], failed: [] };
    if (requestPath.endsWith('/start')) throw new Error('start unavailable');
    throw new Error('unexpected request');
  };
  global.wx.showModal = options => options.success({ confirm: true });
  const ctx = {
    alive: true,
    data: { busy: false, agentSessionId: 'dead', agentMessages: [{ content: 'old' }], agentHistorySessions: [{ sid: 'dead', selected: true }], agentSessions: [] },
    setData,
    run(fn) { this.pending = fn().catch(error => { this.error = error.message; }); return this.pending; },
    startNewAgent: component.methods.startNewAgent,
    toast() {},
  };
  component.methods.deleteAgentHistory.call(ctx);
  await ctx.pending;
  assert.equal(ctx.data.agentSessionId, '');
  assert.deepEqual(ctx.data.agentMessages, []);
  assert.equal(global.wx.getStorageSync('hq-v4-session-id'), '__new__');
  assert.equal(ctx.error, 'start unavailable');
  api.request = originalRequest;
});

test('asset library uses server kinds, pagination, quota, preview and batch delete', async () => {
  const originalRequest = api.request, originalMedia = api.mediaSource;
  api.mediaSource = async url => 'wxfile://' + url.split('/').pop();
  api.request = async requestPath => {
    assert.match(requestPath, /\/assets\?session_id=sid-assets&filter=all&limit=24&offset=0$/);
    return { total: 3, quota: { used: 3 * 1024 * 1024, limit: 2 * 1024 * 1024 * 1024 }, assets: [
      { id: 'img', name: '茶杯.jpg', kind: 'image', size: 1000, thumb: '/api/v4/asset/img/thumb', url: '/api/v4/asset/img/file' },
      { id: 'vid', name: '门店.mp4', kind: 'video', size: 2000, thumb: '/api/v4/asset/vid/thumb', url: '/api/v4/asset/vid/file' },
      { id: 'aud', name: '口播.mp3', kind: 'audio', size: 3000, url: '/api/v4/asset/aud/file' },
    ] };
  };
  const ctx = { alive: true, visible: true, data: { agentSessionId: 'sid-assets', agentAssets: [], agentAssetSource: 'all', agentAssetKind: 'all', agentSheet: 'assets' }, setData };
  ctx.ensureAgentSession = component.methods.ensureAgentSession;
  ctx.applyAgentAssetFilter = component.methods.applyAgentAssetFilter;
  await component.methods.loadAgentAssets.call(ctx, true);
  assert.deepEqual(ctx.data.agentAssets.map(item => item.kind), ['image', 'video', 'audio']);
  assert.equal(ctx.data.agentAssetQuota, '已用 3.0MB / 2.0GB');
  component.methods.selectAgentAssetKind.call(ctx, { currentTarget: { dataset: { kind: 'video' } } });
  assert.deepEqual(ctx.data.agentVisibleAssets.map(item => item.id), ['vid']);
  ctx.data.agentAssets[0].selected = true; ctx.data.agentAssetSelectedCount = 1;
  component.methods.selectAgentAssetKind.call(ctx, { currentTarget: { dataset: { kind: 'audio' } } });
  assert.equal(ctx.data.agentAssetSelectedCount, 0);
  assert.equal(ctx.data.agentAssets.some(item => item.selected), false);
  ctx.data.busy = true;
  component.methods.selectAgentAssetSource.call(ctx, { currentTarget: { dataset: { source: 'site' } } });
  assert.equal(ctx.data.agentAssetSource, 'all');
  ctx.data.busy = false;

  let preview;
  global.wx.previewMedia = options => { preview = options; };
  ctx.run = fn => fn();
  await component.methods.previewAgentAsset.call(ctx, { currentTarget: { dataset: { id: 'vid' } } });
  assert.equal(preview.sources[0].type, 'video');

  let deletedBody;
  api.request = async (requestPath, method, data) => { deletedBody = { requestPath, method, data }; return { ok: true, deleted: ['vid'], failed: [] }; };
  global.wx.showModal = options => options.success({ confirm: true });
  ctx.data.agentAssets = [{ id: 'site:vid', source: 'site', main_kind: 'video', main_delete_id: 88, selected: true }]; ctx.data.agentAssetSelectedCount = 1;
  ctx.loadAgentAssets = async () => {};
  ctx.toast = () => {};
  component.methods.deleteAgentAssets.call(ctx);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(deletedBody, { requestPath: '/workbench/ip12/api/v4/assets/delete', method: 'POST', data: { session_id: 'sid-assets', items: [{ id: 'site:vid', main_kind: 'video', main_delete_id: 88 }] } });
  api.request = originalRequest; api.mediaSource = originalMedia;
});

test('degraded main-site assets stay an error instead of looking empty', async () => {
  const originalRequest = api.request;
  api.request = async () => ({ ok: true, assets: [], total: 0, degraded: true, error: '主站资产暂时读不到，请稍后重试', quota: { used: 0, limit: 100 } });
  const ctx = { alive: true, data: { agentSessionId: 'sid-site', agentAssets: [], agentAssetSource: 'site', agentAssetKind: 'all' }, setData };
  ctx.ensureAgentSession = component.methods.ensureAgentSession;
  await assert.rejects(component.methods.loadAgentAssets.call(ctx, true), /主站资产暂时读不到/);
  api.request = originalRequest;
});

test('a late video download cannot overwrite another conversation', async () => {
  const originalMedia = api.mediaSource;
  let finish;
  api.mediaSource = () => new Promise(resolve => { finish = resolve; });
  const oldVideo = { url: '/api/v4/render/' + 'a'.repeat(32), src: '', loading: false, domId: 'old-video' };
  const ctx = { alive: true, visible: true, data: { agentSessionId: 'old', agentMessages: [{ videos: [oldVideo] }] }, setData, fail(error) { throw error; } };
  const pending = component.methods.loadAgentVideo.call(ctx, { currentTarget: { dataset: { message: 0, video: 0 } } });
  ctx.data.agentSessionId = 'new';
  ctx.data.agentMessages = [{ videos: [{ url: '/api/v4/render/' + 'b'.repeat(32), src: '', loading: false, domId: 'new-video' }] }];
  finish('wxfile://old.mp4');
  await pending;
  assert.equal(ctx.data.agentMessages[0].videos[0].src, '');
  api.mediaSource = originalMedia;
});

test('visible copy states batch and size limits before upload', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/paper/components/screen/index.wxml'), 'utf8');
  assert.match(wxml, /每次最多导入 9 个/);
  assert.match(wxml, /单个图片、视频或音频不超过 200MB/);
  assert.match(wxml, /素材库空间以上方额度为准/);
  assert.match(wxml, /主站作品/);
  assert.match(wxml, /主站作品仅支持预览/);
  assert.match(wxml, /删除选中的.*个素材/);
});

test('library import stops before upload when the known quota is insufficient', async () => {
  const originalUpload = api.upload;
  let uploads = 0;
  api.upload = async () => { uploads += 1; };
  const ctx = {
    alive: true,
    data: { busy: false, agentAssetQuotaRemaining: 10, agentAttachments: [] },
    setData,
    ensureAgentSession: async () => 'sid-quota',
    fail(error) { this.error = error.message; },
  };
  ctx.run = component.methods.run;
  await component.methods.uploadAgentFiles.call(ctx, [{ path: 'large.mp4', name: 'large.mp4', size: 11 }], { attach: false });
  assert.equal(uploads, 0);
  assert.match(ctx.error, /剩余空间不足/);
  api.upload = originalUpload;
});

test('library import uses the no-session-residue endpoint', async () => {
  const originalUpload = api.upload;
  let uploadPath;
  api.upload = async requestPath => { uploadPath = requestPath; return { ok: true, asset: { asset_id: 'saved' } }; };
  const ctx = {
    alive: true,
    data: { busy: false, agentAssetQuotaRemaining: 100, agentAttachments: [] },
    setData,
    ensureAgentSession: async () => 'sid-import',
    loadAgentAssets: async () => {},
    toast() {},
    fail(error) { throw error; },
  };
  ctx.run = component.methods.run;
  await component.methods.uploadAgentFiles.call(ctx, [{ path: 'small.jpg', name: 'small.jpg', size: 10 }], { attach: false });
  assert.equal(uploadPath, '/workbench/ip12/api/v4/assets/import');
  api.upload = originalUpload;
});
