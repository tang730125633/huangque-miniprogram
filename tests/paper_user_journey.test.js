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
const screenWxml = fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'paper', 'components', 'screen', 'index.wxml'), 'utf8');
api.setSession({ token: 'journey-token', user: { username: 'journey-user' } });
require('../miniprogram/paper/components/screen/index');

function setData(patch) {
  for (const [key, value] of Object.entries(patch)) {
    const nested = key.match(/^agentMessages\[(\d+)\]\.(audios|videos)\[(\d+)\]\.(\w+)$/);
    if (nested) this.data.agentMessages[Number(nested[1])][nested[2]][Number(nested[3])][nested[4]] = value;
    else this.data[key] = value;
  }
}
function uploadContext(ctx) {
  for (const name of ['uploadOwner', 'detachAgentUploads', 'updateAgentUpload', 'reservedAgentAttachments', 'pumpAgentUploads', 'runAgentUpload', 'uploadAgentFiles', 'retryAgentUpload']) ctx[name] = component.methods[name];
  return ctx;
}
function textOf(nodes) {
  return (nodes || []).map(node => node.type === 'text' ? node.text : textOf(node.children)).join('');
}

test('conversation and library imports select original images and videos and preserve the chosen file', () => {
  const previousChooseMedia = wx.chooseMedia;
  try {
    for (const method of ['chooseAgentMedia', 'chooseAgentAssetImport']) {
      for (const kind of ['image', 'video']) {
        let selected, uploaded;
        wx.chooseMedia = options => { selected = options; };
        const ctx = {
          data: { busy: false, agentThinking: false, agentAttachments: [] }, setData,
          uploadAgentFiles(files, options) { uploaded = { files, options }; },
        };
        component.methods[method].call(ctx, { currentTarget: { dataset: { kind } } });
        assert.deepEqual(selected.sizeType, ['original']);
        assert.deepEqual(selected.mediaType, [kind]);
        selected.success({ tempFiles: [{ tempFilePath: 'wxfile://original', name: 'original', size: 5379896 }] });
        assert.deepEqual(uploaded.files, [{ path: 'wxfile://original', name: 'original', kind, size: 5379896 }]);
        assert.deepEqual(uploaded.options, method === 'chooseAgentAssetImport' ? { attach: false } : undefined);
      }
    }
  } finally { wx.chooseMedia = previousChooseMedia; }
});

test('assistant Markdown becomes readable blocks and MP3 becomes a player', async () => {
  const originalRequest = api.request, originalMedia = api.mediaSource;
  api.request = async requestPath => {
    assert.equal(requestPath, '/workbench/ip12/api/v4/restore/sid-md?limit=30');
    return { ok: true, history: [{ role: 'assistant', content: '# 小结\n**重点**先做\n- 第一步\n> 慢慢来\n```\n**代码原样**\n```\n音频：https://cdn.example.com/demo.mp3' }], delegations: {}, widgets: [], film: false, report: {} };
  };
  api.mediaSource = async url => url;
  const ctx = { alive: true, data: { agentSessionId: '' }, setData, scrollAgent() {}, settleAgentPicks() {}, maybeSubmitAgentPicks() {} };
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
  const ctx = { alive: true, data: { agentSessionId: '' }, setData, scrollAgent() {}, settleAgentPicks() {}, maybeSubmitAgentPicks() {} };
  await component.methods.restoreAgent.call(ctx, 'sid-voice');
  assert.equal(ctx.data.agentWidgets.length, 1);
  assert.equal(ctx.data.agentWidgets[0].type, 'voice_pick');
  assert.equal(ctx.data.agentWidgets[0].items[0].slotId, 'slot-a');
  api.request = originalRequest;
});

test('voice sample card restores with its structured script and actions', async () => {
  const originalRequest = api.request;
  // film=true（出片轮）也要渲染：后端契约是 film=false 的样音卡任何轮都在
  api.request = async () => ({
    ok: true, history: [], film: true, delegations: {}, report: {},
    selected_choices: {},
    widgets: [{
      id: 'voice_sample_clone', gen: 4, type: 'voice_sample', film: false,
      title: '录一段你的声音（30~60 秒）', hint: '克隆需要 30~60 秒连续说话的人声',
      script: '大家好，我是开服装店的小芳，做这行七八年了。我店里主要卖日常穿的衣服。谢谢大家。',
      actions: [{ mode: 'record', label: '开始录音' }, { mode: 'upload', label: '上传录音文件' }],
    }],
  });
  const ctx = { alive: true, data: { agentSessionId: '' }, setData, scrollAgent() {}, settleAgentPicks() {}, maybeSubmitAgentPicks() {} };
  await component.methods.restoreAgent.call(ctx, 'sid-voice-sample');
  assert.equal(ctx.data.agentWidgets.length, 1);
  const widget = ctx.data.agentWidgets[0];
  assert.equal(widget.type, 'voice_sample');
  assert.equal(widget.script, '大家好，我是开服装店的小芳，做这行七八年了。我店里主要卖日常穿的衣服。谢谢大家。');
  assert.deepEqual(widget.actions.map(action => action.mode), ['record', 'upload']);
  assert.equal(widget.actions[0].label, '开始录音');
  assert.equal(widget.actions[1].label, '上传录音文件');
  assert.equal(widget.items.length, 0);
  assert.match(screenWxml, /bindtap="chooseAgentVoiceSampleAction"/);
  api.request = originalRequest;
});

test('opening the recorder does not create an empty audio player', () => {
  let players = 0;
  global.wx.getRecorderManager = () => ({ onStart() {}, onStop() {}, onError() {} });
  global.wx.createInnerAudioContext = () => { players += 1; return { onEnded() {}, onError() {} }; };
  const ctx = { alive: true, data: { agentVoiceFlow: { stage: 'record' } }, setData, setAgentVoiceFlow: component.methods.setAgentVoiceFlow };
  assert.equal(component.methods.initAgentVoiceMedia.call(ctx), true);
  assert.equal(players, 0);
  assert.equal(component.methods.initAgentVoiceMedia.call(ctx, true), true);
  assert.equal(players, 1);
});

test('template catalog keeps the complete list in one horizontal card with inline expansion', async () => {
  const originalRequest = api.request, originalMedia = api.mediaSource;
  const templates = Array.from({ length: 22 }, (_, index) => ({
    id: 'template-' + index, title: '模板 ' + (index + 1), summary: '9:16 · 12 秒',
    body: '适合批量内容展示', image_url: '/api/v4/template-previews/template-' + index + '.jpg',
    recommended: index < 6,
  }));
  api.request = async () => ({ ok: true, history: [], film: true, delegations: {}, report: {}, selected_choices: {}, widgets: [{
    id: 'template_catalog', gen: 1, type: 'option_pick', film: false,
    title: '模板成片 · 全部模板', hint: '共 22 个', items: templates,
  }] });
  api.mediaSource = async url => url;
  const ctx = { alive: true, data: { agentSessionId: '' }, setData, scrollAgent() {}, settleAgentPicks() {}, maybeSubmitAgentPicks() {} };
  await component.methods.restoreAgent.call(ctx, 'sid-template-catalog');
  assert.equal(ctx.data.agentWidgets[0].layout, 'template_catalog');
  assert.equal(ctx.data.agentWidgets[0].items.length, 22);
  assert.equal(ctx.data.agentWidgets[0].items[5].recommended, true);
  assert.match(screenWxml, /scroll-x="{{!item\.catalogExpanded}}"/);
  assert.match(screenWxml, /查看全部/);
  api.request = originalRequest; api.mediaSource = originalMedia;
});

test('voice sample record action opens the inline recorder with the structured script', () => {
  let navigated = false;
  global.wx.navigateTo = () => { navigated = true; };
  const widget = {
    type: 'voice_sample', id: 'voice_sample_clone', title: '录一段你的声音（30~60 秒）',
    script: '大家好，这是我的专属声音。我会用平常说话的语速介绍自己的工作。',
    actions: [{ mode: 'record', label: '开始录音' }, { mode: 'upload', label: '上传录音文件' }],
  };
  const ctx = {
    data: { busy: false, agentThinking: false, agentSessionId: 'sid-voice-inline', agentVoiceFlow: null, agentWidgets: [widget] },
    setData, toast() {}, initAgentVoiceMedia() {}, openAgentVoiceFlow: component.methods.openAgentVoiceFlow,
  };
  component.methods.chooseAgentVoiceSampleAction.call(ctx, { currentTarget: { dataset: { widget: 0, mode: 'record' } } });
  assert.equal(navigated, false);
  assert.equal(ctx.data.agentVoiceFlow.stage, 'record');
  assert.equal(ctx.data.agentVoiceFlow.widgetId, 'voice_sample_clone');
  assert.equal(ctx.data.agentVoiceFlow.actionMode, 'record');
  assert.equal(ctx.data.agentVoiceFlow.script, widget.script);
  assert.match(screenWxml, /agent-voice-card/);
  assert.match(screenWxml, /bindtap="submitAgentVoiceSample"/);
  assert.doesNotMatch(screenWxml, /submitAgentVoiceClone|acceptAgentVoiceConsent/);
});

test('recorded sample uploads and sends the structured widget action to the chat endpoint', async () => {
  const originalUpload = api.upload, originalRequest = api.request;
  let chatBody = null;
  api.upload = async (requestPath, filePath, data) => {
    assert.equal(requestPath, '/workbench/ip12/api/v4/upload');
    assert.equal(filePath, 'wxfile://sample.mp3');
    assert.equal(data.session_id, 'sid-clone');
    return { file_id: 'f-audio-1', kind: 'audio', url: '/api/v4/file/sid-clone/f-audio-1.mp3' };
  };
  api.request = async (requestPath, method, data) => {
    if (requestPath === '/workbench/ip12/api/v4/chat') { chatBody = { method, data }; return { async: true, seq: 9 }; }
    if (requestPath.includes('/poll/')) return { state: 'done', seq: 9 };
    if (requestPath.includes('/restore/')) return { ok: true, history: [], delegations: {}, widgets: [], film: false, report: {}, selected_choices: {} };
    throw new Error('unexpected ' + requestPath);
  };
  const ctx = {
    alive: true, visible: true,
    data: {
      agentVoiceFlow: { sid: 'sid-clone', stage: 'review', samplePath: 'wxfile://sample.mp3', recSec: 35, widgetId: 'voice_sample_clone', widgetTitle: '录一段你的声音（30~60 秒）', actionMode: 'record', actionLabel: '开始录音', busy: false },
      agentSessionId: 'sid-clone', agentWidgets: [], agentAttachments: [], agentMessages: [], agentPending: null, agentThinking: false, agentProgress: '', busy: false,
    },
    setData,
    run: component.methods.run, fail(error) { throw error; },
    setAgentVoiceFlow: component.methods.setAgentVoiceFlow,
    stopAgentVoiceTimer: component.methods.stopAgentVoiceTimer,
    ensureAgentSession: component.methods.ensureAgentSession,
    addAgentAttachment: component.methods.addAgentAttachment,
    closeAgentVoiceFlow: component.methods.closeAgentVoiceFlow,
    sendAgentVoiceSampleAction: component.methods.sendAgentVoiceSampleAction,
    sendAgentMessage: component.methods.sendAgentMessage,
    submitAgentWidgetAction: component.methods.submitAgentWidgetAction,
    executeAgent: component.methods.executeAgent,
    pollAgent: component.methods.pollAgent,
    pollAgentStep: component.methods.pollAgentStep,
    stopAgentPoll: component.methods.stopAgentPoll,
    clearAgentWaiting: component.methods.clearAgentWaiting,
    restoreAgent: component.methods.restoreAgent,
    scrollAgent() {}, requireLogin: () => true, toast() {}, settleAgentPicks() {}, maybeSubmitAgentPicks() {},
  };
  await component.methods.submitAgentVoiceSample.call(ctx);
  await ctx.agentPoll;
  assert.equal(chatBody.method, 'POST');
  assert.equal(chatBody.data.message, '【点选】录一段你的声音（30~60 秒）：开始录音');
  assert.deepEqual(chatBody.data.attachments, ['f-audio-1']);
  assert.deepEqual(chatBody.data.widget_action, { widget_type: 'voice_sample', widget_id: 'voice_sample_clone', mode: 'record' });
  assert.equal(ctx.data.agentVoiceFlow, null);
  api.upload = originalUpload; api.request = originalRequest;
});

test('uploaded sample action goes through the file picker and the same structured submission', async () => {
  const originalUpload = api.upload, originalRequest = api.request;
  let picked = null, uploaded = null, chatBody = null;
  global.wx.chooseMessageFile = options => { picked = options; options.success({ tempFiles: [{ path: 'wxfile://my-voice.m4a', name: '我的样音.m4a', size: 1024 }] }); };
  api.upload = async () => { uploaded = true; return { file_id: 'f-audio-2', kind: 'audio', url: '/api/v4/file/sid-upload/f-audio-2.m4a' }; };
  api.request = async (requestPath, method, data) => {
    if (requestPath === '/workbench/ip12/api/v4/chat') { chatBody = { method, data }; return { async: true, seq: 9 }; }
    if (requestPath.includes('/poll/')) return { state: 'done', seq: 9 };
    if (requestPath.includes('/restore/')) return { ok: true, history: [], delegations: {}, widgets: [], film: false, report: {}, selected_choices: {} };
    throw new Error('unexpected ' + requestPath);
  };
  const widget = {
    type: 'voice_sample', id: 'voice_sample_clone', title: '录一段你的声音（30~60 秒）',
    script: '大家好，这是我的专属声音。', actions: [{ mode: 'upload', label: '上传录音文件' }],
  };
  const ctx = {
    alive: true, visible: true,
    data: { busy: false, agentThinking: false, agentSessionId: 'sid-upload', agentWidgets: [widget], agentAttachments: [], agentMessages: [], agentPending: null, agentThinking: false, agentProgress: '', agentSheet: '' },
    setData, toast() {},
    run: component.methods.run, fail(error) { throw error; },
    pickAgentVoiceSampleFile: component.methods.pickAgentVoiceSampleFile,
    ensureAgentSession: component.methods.ensureAgentSession,
    addAgentAttachment: component.methods.addAgentAttachment,
    closeAgentVoiceFlow: component.methods.closeAgentVoiceFlow,
    sendAgentVoiceSampleAction: component.methods.sendAgentVoiceSampleAction,
    sendAgentMessage: component.methods.sendAgentMessage,
    submitAgentWidgetAction: component.methods.submitAgentWidgetAction,
    executeAgent: component.methods.executeAgent,
    pollAgent: component.methods.pollAgent,
    pollAgentStep: component.methods.pollAgentStep,
    stopAgentPoll: component.methods.stopAgentPoll,
    clearAgentWaiting: component.methods.clearAgentWaiting,
    restoreAgent: component.methods.restoreAgent,
    scrollAgent() {}, requireLogin: () => true,
    settleAgentPicks() {}, maybeSubmitAgentPicks() {},
  };
  await component.methods.chooseAgentVoiceSampleAction.call(ctx, { currentTarget: { dataset: { widget: 0, mode: 'upload' } } });
  await ctx.agentPoll;
  assert.deepEqual(picked.extension, ['mp3', 'wav', 'm4a', 'aac', 'ogg']);
  assert.equal(uploaded, true);
  assert.equal(chatBody.data.message, '【点选】录一段你的声音（30~60 秒）：上传录音文件');
  assert.deepEqual(chatBody.data.attachments, ['f-audio-2']);
  assert.deepEqual(chatBody.data.widget_action, { widget_type: 'voice_sample', widget_id: 'voice_sample_clone', mode: 'upload' });
  api.upload = originalUpload; api.request = originalRequest;
});

test('sample file larger than 10 MB is rejected before upload', () => {
  let picked = null, toasts = [];
  global.wx.chooseMessageFile = options => { picked = options; options.success({ tempFiles: [{ path: 'wxfile://big.mp3', name: '大文件.mp3', size: 11 * 1024 * 1024 }] }); };
  const widget = { type: 'voice_sample', id: 'voice_sample_clone', title: '录一段你的声音（30~60 秒）', script: '大家好。', actions: [{ mode: 'upload', label: '上传录音文件' }] };
  const ctx = {
    data: { busy: false, agentThinking: false, agentWidgets: [widget], agentSheet: '' },
    setData, toast(title) { toasts.push(title); }, fail(error) { throw error; },
  };
  component.methods.pickAgentVoiceSampleFile.call(ctx, widget, { mode: 'upload', label: '上传录音文件' });
  assert.deepEqual(picked.extension, ['mp3', 'wav', 'm4a', 'aac', 'ogg']);
  assert.equal(toasts.length, 1);
  assert.match(toasts[0], /10 MB/);
});

function deepSetData(patch) {
  for (const [key, value] of Object.entries(patch)) {
    const path = key.replace(/\[(\d+)\]/g, '.$1').split('.');
    let target = this.data;
    for (let i = 0; i < path.length - 1; i++) target = target[path[i]];
    target[path[path.length - 1]] = value;
  }
}

test('multi-select option card toggles checked items and submits them in one message', async () => {
  const originalRequest = api.request;
  let chatBody = null;
  api.request = async (requestPath, method, data) => {
    if (requestPath === '/workbench/ip12/api/v4/chat') { chatBody = { method, data }; return { async: true, seq: 9 }; }
    if (requestPath.includes('/poll/')) return { state: 'done', seq: 9 };
    if (requestPath.includes('/restore/')) return { ok: true, history: [], delegations: {}, report: {}, selected_choices: {}, film: false, widgets: [{
      id: 'follow_plan', gen: 2, type: 'option_pick', film: false, selection_mode: 'multiple', min_selected: 2, max_selected: 3,
      title: '复刻方案', items: [
        { id: 'a', title: '剪辑节奏', summary: 'ChatCut 复刻' },
        { id: 'b', title: '模板同款', summary: '选近似模板' },
        { id: 'c', title: '封面样式', summary: '参考帧生成' },
      ],
    }] };
    throw new Error('unexpected ' + requestPath);
  };
  const ctx = {
    alive: true, visible: true,
    data: { agentSessionId: '', agentWidgets: [], agentAttachments: [], agentMessages: [], agentPending: null, agentThinking: false, agentProgress: '', busy: false },
    setData: deepSetData, scrollAgent() {}, toast() {},
    run: component.methods.run, fail(error) { throw error; },
    ensureAgentSession: component.methods.ensureAgentSession,
    sendAgentMessage: component.methods.sendAgentMessage,
    submitAgentWidgetAction: component.methods.submitAgentWidgetAction,
    executeAgent: component.methods.executeAgent,
    pollAgent: component.methods.pollAgent,
    pollAgentStep: component.methods.pollAgentStep,
    stopAgentPoll: component.methods.stopAgentPoll,
    clearAgentWaiting: component.methods.clearAgentWaiting,
    restoreAgent: component.methods.restoreAgent,
    requireLogin: () => true,
    settleAgentPicks() {}, maybeSubmitAgentPicks() {},
  };
  await component.methods.restoreAgent.call(ctx, 'sid-multi');
  const widget = ctx.data.agentWidgets[0];
  assert.equal(widget.type, 'option_pick');
  assert.equal(widget.selectionMode, 'multiple');
  assert.equal(widget.minSelected, 2);
  assert.equal(widget.maxSelected, 3);
  assert(widget.items.every(item => item.selected === false));

  const toasts = [];
  ctx.toast = title => toasts.push(title);
  await component.methods.confirmAgentMultiSelection.call(ctx, { currentTarget: { dataset: { widget: 0 } } });
  assert.equal(chatBody, null, '未选够下限不能提交');
  assert.match(toasts[0], /至少选择 2 项/);

  component.methods.toggleAgentMultiOption.call(ctx, { currentTarget: { dataset: { widget: 0, option: 0 } } });
  component.methods.toggleAgentMultiOption.call(ctx, { currentTarget: { dataset: { widget: 0, option: 1 } } });
  component.methods.toggleAgentMultiOption.call(ctx, { currentTarget: { dataset: { widget: 0, option: 1 } } });
  assert.equal(ctx.data.agentWidgets[0].selectedCount, 1, '再点一次取消勾选');
  component.methods.toggleAgentMultiOption.call(ctx, { currentTarget: { dataset: { widget: 0, option: 1 } } });
  component.methods.toggleAgentMultiOption.call(ctx, { currentTarget: { dataset: { widget: 0, option: 2 } } });
  assert.equal(ctx.data.agentWidgets[0].selectedCount, 3);
  assert(ctx.data.agentWidgets[0].items.every(item => item.selected));

  await component.methods.confirmAgentMultiSelection.call(ctx, { currentTarget: { dataset: { widget: 0 } } });
  await ctx.agentPoll;
  assert.equal(chatBody.method, 'POST');
  assert.equal(chatBody.data.message, '【点选】复刻方案：剪辑节奏、模板同款、封面样式');
  assert.deepEqual(chatBody.data.widget_action,{widget_type:'option_pick',widget_id:'follow_plan',gen:2,item_ids:['a','b','c']},'多选携带卡片代次，后台拒绝过期操作');
  api.request = originalRequest;
});

test('film-flagged and non-film cards both render in any round', async () => {
  const originalRequest = api.request;
  api.request = async () => ({
    ok: true, history: [], film: false, delegations: {}, report: {},
    selected_choices: {},
    widgets: [
      { id: 'script_10s', gen: 1, type: 'script_pick', film: true, title: '口播文案', items: [{ id: 's1', title: '10 秒版' }] },
      { id: 'template_catalog', gen: 1, type: 'option_pick', film: false, title: '模板成片 · 全部模板', items: [{ id: 't1', title: '模板 1' }] },
    ],
  });
  const ctx = { alive: true, data: { agentSessionId: '' }, setData, scrollAgent() {}, settleAgentPicks() {}, maybeSubmitAgentPicks() {} };
  await component.methods.restoreAgent.call(ctx, 'sid-both-sets');
  assert.equal(ctx.data.agentWidgets.length, 2, '网页端同口径：两套卡都渲染，film 不决定显隐');
  assert.equal(ctx.data.agentWidgets[0].film, true);
  assert.equal(ctx.data.agentWidgets[1].film, false);
  assert.equal(ctx.data.agentWidgets[1].layout, 'template_catalog');
  api.request = originalRequest;
});

test('inline recorder rejects samples shorter than 30 seconds', () => {
  const ctx = { alive: true, agentVoiceSeconds: 29, data: { agentVoiceFlow: { stage: 'recording' } }, setData, setAgentVoiceFlow: component.methods.setAgentVoiceFlow };
  component.methods.readAgentVoiceSample.call(ctx, 'short.mp3');
  assert.equal(ctx.data.agentVoiceFlow.stage, 'record');
  assert.match(ctx.data.agentVoiceFlow.error, /至少 30 秒/);
  ctx.agentVoiceSeconds = 30;
  component.methods.readAgentVoiceSample.call(ctx, 'valid.mp3');
  assert.equal(ctx.data.agentVoiceFlow.stage, 'review');
  assert.equal(ctx.data.agentVoiceFlow.samplePath, 'valid.mp3');
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

test('visible copy states original uploads and account storage quota', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/paper/components/screen/index.wxml'), 'utf8');
  assert.match(wxml, /每次最多导入 9 个/);
  assert.match(wxml, /素材容量以剩余云空间为准/);
  assert.doesNotMatch(wxml, /单个图片、视频或音频不超过 200MB/);
  assert.match(wxml, /主站作品/);
  assert.match(wxml, /主站作品仅支持预览/);
  assert.match(wxml, /删除选中的.*个素材/);
  assert.match(wxml, /agentUploads/);
  assert.match(wxml, /retryAgentUpload/);
  assert.match(wxml, /class="attachment-progress" percent="\{\{item\.progress\}\}"/);
  assert.match(wxml, /class="hq-view asset-upload-queue"/);
  assert.match(wxml, /class="asset-upload-progress" percent="\{\{item\.progress\}\}"/);
});

test('upload API forwards wx upload progress without changing its Promise result', async () => {
  const previousUploadFile = wx.uploadFile;
  let report;
  wx.uploadFile = options => {
    const task = { onProgressUpdate(callback) { report = callback; } };
    queueMicrotask(() => options.success({ statusCode: 200, data: '{"file_id":"progress-file"}' }));
    return task;
  };
  try {
    const progress = [];
    const pending = api.upload('/workbench/ip12/api/v4/upload', 'wxfile://progress.mp4', {}, { onProgress: value => progress.push(value) });
    report({ progress: 43 });
    report({ progress: 20 });
    assert.deepEqual(await pending, { file_id: 'progress-file' });
    report({ progress: 100 });
    assert.deepEqual(progress, [43,43]);
  } finally { wx.uploadFile = previousUploadFile; }
});

test('large original materials reach upload without a per-file size gate', async () => {
  const originalUpload = api.upload;
  const uploaded = [];
  api.upload = async (url, filePath) => {
    uploaded.push({ url, filePath });
    return { file_id: 'original', kind: 'video', asset: { saved: true } };
  };
  try {
    for (const attach of [false, true]) {
      const ctx = uploadContext({
        data: { agentAttachments: [], agentAssetQuotaRemaining: 2 * 1024 ** 3 }, setData,
        run: fn => fn(), ensureAgentSession: async () => 'sid-large',
        addAgentAttachment() {}, loadAgentAssets: async () => {}, toast() {},
      });
      await component.methods.uploadAgentFiles.call(ctx,
        [{ path: 'wxfile://large-original.mp4', name: 'large.mp4', size: 300 * 1024 ** 2 }], { attach });
    }
    assert.deepEqual(uploaded, [
      { url: '/workbench/ip12/api/v4/assets/import', filePath: 'wxfile://large-original.mp4' },
      { url: '/workbench/ip12/api/v4/upload', filePath: 'wxfile://large-original.mp4' },
    ]);
  } finally { api.upload = originalUpload; }
});

test('library import stops before upload when the known quota is insufficient', async () => {
  const originalUpload = api.upload;
  let uploads = 0;
  api.upload = async () => { uploads += 1; };
  const ctx = uploadContext({
    alive: true,
    data: { busy: false, agentAssetQuotaRemaining: 10, agentAttachments: [] },
    setData,
    ensureAgentSession: async () => 'sid-quota',
    fail(error) { this.error = error.message; },
  });
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
  const ctx = uploadContext({
    alive: true,
    data: { busy: false, agentAssetQuotaRemaining: 100, agentAttachments: [] },
    setData,
    ensureAgentSession: async () => 'sid-import',
    loadAgentAssets: async () => {},
    toast() {},
    fail(error) { throw error; },
  });
  ctx.run = component.methods.run;
  await component.methods.uploadAgentFiles.call(ctx, [{ path: 'small.jpg', name: 'small.jpg', size: 10 }], { attach: false });
  assert.equal(uploadPath, '/workbench/ip12/api/v4/assets/import');
  api.upload = originalUpload;
});

function queuedUploadContext(sid = 'sid-upload') {
  const ctx = uploadContext({
    alive: true,
    data: { agentSessionId: sid, agentAttachments: [], agentUploads: [], agentAssetQuotaRemaining: 2 * 1024 ** 3 },
    setData, ensureAgentSession: async () => sid, loadAgentAssets: async () => {}, toast() {},
  });
  ctx.addAgentAttachment = component.methods.addAgentAttachment;
  return ctx;
}

test('material uploads use two slots, show real progress, and keep later selections queued', async () => {
  const originalUpload = api.upload, waiting = [];
  let active = 0, peak = 0;
  api.upload = (requestPath, filePath, formData, options) => new Promise(resolve => {
    active += 1; peak = Math.max(peak, active);
    waiting.push({ filePath, progress: options.onProgress, resolve: () => { active -= 1; resolve({ file_id: filePath, kind: 'video' }); } });
  });
  try {
    const ctx = queuedUploadContext();
    const first = component.methods.uploadAgentFiles.call(ctx, [
      { path: 'wxfile://one.mp4', name: 'same.mp4', kind: 'video', size: 300 * 1024 ** 2 },
      { path: 'wxfile://two.mp4', name: 'same.mp4', kind: 'video', size: 300 * 1024 ** 2 },
      { path: 'wxfile://three.mp4', name: 'three.mp4', kind: 'video', size: 3 },
    ]);
    assert.equal(peak, 2);
    assert.equal(ctx.data.agentUploads.length, 3);
    assert.equal(new Set(ctx.data.agentUploads.map(item => item.id)).size, 3);
    assert.deepEqual(ctx.data.agentUploads.map(item => item.size), [300 * 1024 ** 2, 300 * 1024 ** 2, 3]);
    assert.equal(ctx.data.agentUploads[2].status, 'queued');

    const later = component.methods.uploadAgentFiles.call(ctx, [{ path: 'wxfile://four.mp4', name: 'four.mp4', kind: 'video', size: 4 }]);
    assert.equal(ctx.data.agentUploads.length, 4);
    waiting[0].progress(51);
    assert.equal(ctx.data.agentUploads[0].statusText, '上传中 51%');
    waiting[0].progress(100);
    assert.equal(ctx.data.agentUploads[0].statusText, '保存中');
    waiting[0].resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(peak, 2);
    assert.equal(waiting.length, 3);
    waiting[1].resolve();
    await new Promise(resolve => setImmediate(resolve));
    waiting[2].resolve();
    await new Promise(resolve => setImmediate(resolve));
    waiting[3].resolve();
    await Promise.all([first, later]);
    assert.equal(ctx.data.agentAttachments.length, 4);
  } finally { api.upload = originalUpload; }
});

test('failed material upload stays retryable and reserves attachment slots while pending', async () => {
  const originalUpload = api.upload;
  let calls = 0, finish;
  api.upload = () => {
    calls += 1;
    if (calls === 1) return Promise.reject(new Error('网络中断'));
    return new Promise(resolve => { finish = resolve; });
  };
  try {
    const ctx = queuedUploadContext();
    await component.methods.uploadAgentFiles.call(ctx, [{ path: 'wxfile://retry.mp4', name: 'retry.mp4', kind: 'video', size: 1 }]);
    assert.equal(ctx.data.agentUploads[0].status, 'error');
    component.methods.retryAgentUpload.call(ctx, { currentTarget: { dataset: { id: ctx.data.agentUploads[0].id } } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ctx.data.agentUploads[0].status, 'uploading');
    finish({ file_id: 'retry', kind: 'video' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ctx.data.agentAttachments[0].fileId, 'retry');

    const full = queuedUploadContext();
    full.data.agentAttachments = Array.from({ length: 9 }, (_, index) => ({ fileId: 'done-' + index }));
    let held;
    api.upload = () => new Promise(resolve => { held = resolve; });
    const pending = component.methods.uploadAgentFiles.call(full, [{ path: 'wxfile://held.mp4', name: 'held.mp4', kind: 'video', size: 1 }]);
    const blocked = await component.methods.uploadAgentFiles.call(full, [{ path: 'wxfile://blocked.mp4', name: 'blocked.mp4', kind: 'video', size: 1 }]);
    assert.deepEqual(blocked, []);
    assert.equal(full.data.agentUploads.length, 1);
    held({ file_id: 'held', kind: 'video' });
    await pending;
  } finally { api.upload = originalUpload; }
});

test('late material upload completion cannot attach to a new conversation', async () => {
  const originalUpload = api.upload;
  let finish;
  api.upload = () => new Promise(resolve => { finish = resolve; });
  try {
    const ctx = queuedUploadContext('sid-old');
    const pending = component.methods.uploadAgentFiles.call(ctx, [{ path: 'wxfile://old.mp4', name: 'old.mp4', kind: 'video', size: 1 }]);
    component.methods.detachAgentUploads.call(ctx);
    ctx.setData({ agentSessionId: 'sid-new', agentAttachments: [], agentUploads: [] });
    finish({ file_id: 'old-file', kind: 'video' });
    await pending;
    assert.deepEqual(ctx.data.agentAttachments, []);
    assert.deepEqual(ctx.data.agentUploads, []);
  } finally { api.upload = originalUpload; }
});
