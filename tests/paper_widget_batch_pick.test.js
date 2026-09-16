// 组件卡「一次选完」（2026-09-16 老板定调）：多张卡一起勾、一次提交；
// 单卡点选即发不变；黄雀思考中卡片不出现、点卡直接拦截（同日定调：任务没做完不许再点出新任务）。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

let component;
global.wx = {
  getStorageSync() { return null; },
  setStorageSync() {},
  showToast() {},
};
global.getApp = () => ({ globalData: { apiBase: 'https://huangquechuanmei.com' } });
global.Component = value => { component = value; };

const api = require('../miniprogram/paper/services/api');
require('../miniprogram/paper/components/screen/index');

function setData(patch) {
  for (const [key, value] of Object.entries(patch)) {
    const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
    let node = this.data;
    for (let i = 0; i < parts.length - 1; i++) node = node[parts[i]];
    node[parts[parts.length - 1]] = value;
  }
}

function widget(id, type, opts = {}) {
  return Object.assign({
    key: String(id), id, type, kind: type === 'voice_pick' ? 'voice' : 'script',
    film: true, title: '卡·' + id, hint: '', selectedId: '', selectionMode: 'single',
    minSelected: 0, maxSelected: 0, selectedCount: 0, layout: 'list',
    catalogExpanded: false, itemCount: 2, script: '', actions: [],
    items: [
      { key: 'a', id: 'A', title: '选项A', summary: '', body: '', imageUrl: '', displayImage: '', previewUrl: '', slotId: '', createdAt: '', recommended: false, selected: false },
      { key: 'b', id: 'B', title: '选项B', summary: '', body: '', imageUrl: '', displayImage: '', previewUrl: '', slotId: '', createdAt: '', recommended: false, selected: false },
    ],
  }, opts);
}

function ctx(widgets, extra = {}) {
  const c = Object.create(component.methods);
  c.alive = true;
  c.data = Object.assign({
    busy: false, agentThinking: false, agentSessionId: 'sid-x',
    agentWidgets: widgets, agentPicksCanConfirm: false, agentMessages: [],
  }, extra);
  c.setData = setData;
  c.toast = () => {};
  c.scrollAgent = () => {};
  c.startReportPoll = () => {};
  c.startAgentWatch = () => {};
  c.refreshTaskQueue = () => {};
  c.stopReportPoll = () => {};
  c._agentManualPicks = {};
  c.sent = [];
  c.sendAgentMessage = message => { c.sent.push(message); return Promise.resolve(); };
  return c;
}

test('多卡场景：勾选不逐张发送，全部勾齐自动一次提交', async () => {
  const original = api.request;
  api.request = async () => ({});
  const c = ctx([
    widget('voice_pick', 'voice_pick', { title: '音色（▶ 点一下试听）', items: [{ id: '4053', title: '我的克隆音色' }] }),
    widget('script_pick', 'script_pick', { title: '门店引流口播文案（三版，点一下选一版）', items: [{ id: 'A', title: '直给福利型' }, { id: 'B', title: '痛点共鸣型' }, { id: 'C', title: '探店种草型' }] }),
  ]);
  // 勾第一张：不发送、不清空其它卡、亮确认按钮
  await c.chooseAgentWidget.call(c, { currentTarget: { dataset: { widget: 0, option: 0 } } });
  assert.equal(c.sent.length, 0, '勾第一张不立即发送');
  assert.equal(c.data.agentWidgets.length, 2, '不清空其它卡');
  assert.equal(c.data.agentWidgets[0].selectedId, '4053', '本地勾选生效');
  assert.equal(c.data.agentPicksCanConfirm, true, '未全勾齐时亮确认按钮');
  // 勾第二张：全齐 → 自动一次提交（一条消息两行选择）
  await c.chooseAgentWidget.call(c, { currentTarget: { dataset: { widget: 1, option: 2 } } });
  assert.equal(c.sent.length, 1, '全勾齐自动发送一次');
  const msg = c.sent[0];
  assert.match(msg, /【点选】音色（▶ 点一下试听）：我的克隆音色（id=4053）/);
  assert.match(msg, /【点选】门店引流口播文案（三版，点一下选一版）：探店种草型（id=C）/);
  assert.equal(c.data.agentPicksCanConfirm, false, '提交后按钮收起');
  api.request = original;
});

test('单卡场景：点选即发（与旧行为一致）', async () => {
  const original = api.request;
  api.request = async () => ({});
  const c = ctx([widget('script_pick', 'script_pick', { items: [{ id: 'C', title: '探店种草型' }] })]);
  await c.chooseAgentWidget.call(c, { currentTarget: { dataset: { widget: 0, option: 0 } } });
  assert.equal(c.sent.length, 1, '单卡点选即发');
  assert.match(c.sent[0], /【点选】卡·script_pick：探店种草型（id=C）/);
  api.request = original;
});

test('后端已默认勾选的卡算已勾：补勾最后一张即自动提交', async () => {
  const original = api.request;
  api.request = async () => ({});
  const c = ctx([
    widget('voice_pick', 'voice_pick', { selectedId: '4053', items: [{ id: '4053', title: '我的克隆音色' }] }),
    widget('script_pick', 'script_pick', { items: [{ id: 'C', title: '探店种草型' }] }),
  ]);
  await c.chooseAgentWidget.call(c, { currentTarget: { dataset: { widget: 1, option: 0 } } });
  assert.equal(c.sent.length, 1, '默认已勾 + 补勾最后一张 → 自动提交');
  assert.match(c.sent[0], /我的克隆音色（id=4053）/);
  assert.match(c.sent[0], /探店种草型（id=C）/);
  api.request = original;
});

test('思考中点卡直接拦截：不发送、不暂存、不补交', async () => {
  const original = api.request;
  api.request = async () => ({});
  const c = ctx([
    widget('voice_pick', 'voice_pick', { items: [{ id: '4053', title: '我的克隆音色' }] }),
    widget('script_pick', 'script_pick', { items: [{ id: 'C', title: '探店种草型' }] }),
  ], { agentThinking: true });
  await c.chooseAgentWidget.call(c, { currentTarget: { dataset: { widget: 0, option: 0 } } });
  await c.chooseAgentWidget.call(c, { currentTarget: { dataset: { widget: 1, option: 0 } } });
  assert.equal(c.sent.length, 0, '思考中不发送');
  assert.deepEqual(c._agentManualPicks, {}, '思考中不暂存勾选');
  assert.equal(c.data.agentWidgets[0].selectedId, '', '思考中不记录选中');
  c.setData.call(c, { agentThinking: false });
  c.settleAgentPicks.call(c);
  assert.equal(c.sent.length, 0, '没有待补交，也不补发');
  api.request = original;
});

test('只勾一部分时点「确认选择」：只提交已勾的', async () => {
  const original = api.request;
  api.request = async () => ({});
  const c = ctx([
    widget('voice_pick', 'voice_pick', { items: [{ id: '4053', title: '我的克隆音色' }] }),
    widget('script_pick', 'script_pick', { items: [{ id: 'C', title: '探店种草型' }] }),
  ]);
  await c.chooseAgentWidget.call(c, { currentTarget: { dataset: { widget: 0, option: 0 } } });
  assert.equal(c.sent.length, 0);
  await c.confirmAgentPicksSubmit.call(c);
  assert.equal(c.sent.length, 1, '确认选择发送一次');
  assert.match(c.sent[0], /我的克隆音色（id=4053）/);
  assert.doesNotMatch(c.sent[0], /探店种草型/);
  api.request = original;
});

test('音色卡项自动拆分主名称与胶囊标签，且支持试听播放切换', async () => {
  const c = ctx([]);
  const originalRequest = api.request;
  api.request = async () => ({
    ok: true, history: [], film: true, delegations: {}, report: {}, selected_choices: {},
    widgets: [{
      id: 'voice_pick', type: 'voice_pick', title: '音色（▶ 点一下试听）',
      items: [
        { id: '1', title: '温柔女声（情感种草）', preview_url: 'https://example.com/v1.mp3' },
        { id: '2', title: '沉稳男声（知识口播）', preview_url: 'https://example.com/v2.mp3' },
        { id: '3', title: '我的克隆音色' }
      ]
    }]
  });
  await component.methods.restoreAgent.call(c, 'sid-v');
  const items = c.data.agentWidgets[0].items;
  assert.equal(items[0].parsedName, '温柔女声');
  assert.equal(items[0].parsedTag, '情感种草');
  assert.equal(items[1].parsedName, '沉稳男声');
  assert.equal(items[1].parsedTag, '知识口播');
  assert.equal(items[2].parsedName, '我的克隆音色');
  assert.equal(items[2].parsedTag, '');

  let innerAudioCreated = false;
  let vibrateCount = 0;
  global.wx.vibrateShort = (opts) => {
    assert.equal(opts.type, 'light');
    vibrateCount += 1;
  };
  global.wx.createInnerAudioContext = () => {
    innerAudioCreated = true;
    return {
      play() {}, stop() {}, destroy() {},
      onPlay(fn) { this._onPlay = fn; },
      onEnded() {}, onStop() {}, onError() {}
    };
  };
  await c.toggleVoicePreview.call(c, { currentTarget: { dataset: { widget: 0, option: 0 } } });
  assert.equal(innerAudioCreated, true);
  assert.equal(vibrateCount, 1);

  await c.chooseAgentWidget.call(c, { currentTarget: { dataset: { widget: 0, option: 0 } } });
  assert.equal(vibrateCount, 2);

  c.data.agentWidgets[0].selectionMode = 'multiple';
  await c.toggleAgentMultiOption.call(c, { currentTarget: { dataset: { widget: 0, option: 0 } } });
  assert.equal(vibrateCount, 3);

  api.request = originalRequest;
});

test('音色试听按钮：播放器不跟随手机静音键；无试听链接时如实提示、绝不假装在播', async () => {
  const c = ctx([]);
  const originalRequest = api.request;
  api.request = async () => ({
    ok: true, history: [], film: true, delegations: {}, report: {}, selected_choices: {},
    widgets: [{
      id: 'voice_pick', type: 'voice_pick', title: '音色（▶ 点一下试听）',
      items: [
        { id: '1', title: '温柔女声（情感种草）', preview_url: 'https://example.com/v1.mp3' },
        { id: '2', title: '我的克隆音色' }
      ]
    }]
  });
  await component.methods.restoreAgent.call(c, 'sid-v');
  const players = [];
  global.wx.createInnerAudioContext = () => {
    const p = { play() { if (this._onPlay) this._onPlay(); }, stop() {}, destroy() {}, onPlay(fn) { this._onPlay = fn; }, onEnded() {}, onStop() {}, onError() {} };
    players.push(p);
    return p;
  };
  const toasts = [];
  c.toast = (t) => toasts.push(t);
  // 有链接：出声播放，且 obeyMuteSwitch=false（iOS 静音键不吞试听声）
  await c.toggleVoicePreview.call(c, { currentTarget: { dataset: { widget: 0, option: 0 } } });
  assert.equal(players.length, 1);
  assert.equal(players[0].obeyMuteSwitch, false);
  assert.equal(c.data.agentWidgets[0].items[0].playing, true);
  // 无链接（克隆刚完成、卡未刷新）：如实提示，不建播放器、不闪「播放中」
  await c.toggleVoicePreview.call(c, { currentTarget: { dataset: { widget: 0, option: 1 } } });
  assert.equal(players.length, 1, '无链接不建播放器');
  assert.ok(toasts.some((t) => /还没生成好/.test(t)), '要给出诚实提示');
  assert.ok(!c.data.agentWidgets[0].items[1].playing, '不得假装在播');
  api.request = originalRequest;
});


test('渲染中提示条：按后端 started_at 显示已用时；渲染结束清零（2026-09-17 老板实录：渲染多久了必须看得见）', async () => {
  const c = ctx([]);
  const originalRequest = api.request;
  c.visible = true;
  const startedAt = Math.floor(Date.now() / 1000) - 95;
  c.startAgentWatch = component.methods.startAgentWatch;
  c.startAgentWatch({ 'digital-human': { state: 'running', started_at: startedAt } });
  assert.equal(c.data.agentBackgroundWorking, true, '渲染中标志置位');
  assert.ok(/分|秒/.test(c.data.agentWorkingElapsed), '提示条带已用时');
  assert.ok(c.data.agentWorkingElapsed.includes('1 分'), '用时从后端 started_at 起算（约 95 秒 → 1 分 x 秒）');
  // 渲染结束：标志与用时清零，提示条消失
  c.startAgentWatch({ 'digital-human': { state: 'completed', started_at: startedAt } });
  assert.equal(c.data.agentBackgroundWorking, false);
  assert.equal(c.data.agentWorkingElapsed, '');
  clearTimeout(c.agentWatchTimer);
  c.alive = false;
  api.request = originalRequest;
});
