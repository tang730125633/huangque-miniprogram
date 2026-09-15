// 组件卡「一次选完」（2026-09-16 老板定调）：多张卡一起勾、一次提交；
// 单卡点选即发不变；思考中可继续勾选、回复结束自动补交。
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

test('思考中勾选只暂存，回复结束自动补交一次', async () => {
  const original = api.request;
  api.request = async () => ({});
  const c = ctx([
    widget('voice_pick', 'voice_pick', { items: [{ id: '4053', title: '我的克隆音色' }] }),
    widget('script_pick', 'script_pick', { items: [{ id: 'C', title: '探店种草型' }] }),
  ], { agentThinking: true });
  await c.chooseAgentWidget.call(c, { currentTarget: { dataset: { widget: 0, option: 0 } } });
  await c.chooseAgentWidget.call(c, { currentTarget: { dataset: { widget: 1, option: 0 } } });
  assert.equal(c.sent.length, 0, '思考中不发送');
  assert.equal(c._agentPicksPendingSubmit, true, '标记待补交');
  c.setData.call(c, { agentThinking: false });
  c.settleAgentPicks.call(c);
  assert.equal(c.sent.length, 1, '思考结束自动补交一次');
  assert.match(c.sent[0], /卡·voice_pick/); assert.match(c.sent[0], /卡·script_pick/);
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
