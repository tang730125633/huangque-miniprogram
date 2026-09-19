// 报障台 #10「文案卡点选后打字改选：配置卡回退、文案卡消失」——小程序端回归。
// 实锤链路（老板 09-15 展示旅程会话 fd926d9b）：
//   点选文案卡 A → 打字「就选 C …」改选 → 文案卡从页面消失、配置卡回退成「必选文案」死状态。
// 两端契约：
//   ① 后端每轮下发的卡组（批次收敛 + 跨轮续挂）决定卡片上屏，前端不得自己把卡片记成永久关闭；
//   ② 权威选择（selected_choices）随每轮 restore 下发，卡片「已选」状态跟着它走——
//      打字改选后卡片显示新版本、仍然可点，绝不回退成未选。
const test = require('node:test');
const assert = require('node:assert/strict');

let component;
const store = new Map();
global.wx = {
  getStorageSync: k => store.get(k),
  setStorageSync: (k, v) => store.set(k, v),
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

// 服务端权威卡片（digital-human 挂出的三版文案卡，film=true；与生产 payload 同形）
function scriptCard(gen = 1) {
  return {
    id: 'script_pick_qin_unify', type: 'script_pick', gen, batch: 1789456034859, film: true,
    title: '《秦朝为什么能统一六国》口播文案 · 请点选一版', hint: '选中哪版就按哪版出片；也可留言微调。',
    items: [
      { id: 'A', title: 'A · 悬念讲述版（当年课堂最带劲那版）' },
      { id: 'B', title: 'B · 三条硬道理版（通俗讲解、好记）' },
      { id: 'C', title: 'C · 讲给孙子听版（亲切口语、温暖）' },
    ],
  };
}

function ctx(extra = {}) {
  const c = Object.create(component.methods);
  c.alive = true;
  c.visible = true;
  c.data = Object.assign({
    busy: false, agentThinking: false, agentSessionId: '', agentMessages: [], agentWidgets: [],
    agentAttachments: [], agentAssets: [], agentHistorySessions: [],
  }, extra);
  c.setData = setData;
  c.scrollAgent = () => {};
  c.settleAgentPicks = () => {};
  c.toast = () => {};
  c.syncReportNotice = () => {};
  c.startReportPoll = () => {};
  c.startAgentWatch = () => {};
  c.refreshTaskQueue = () => {};
  return c;
}

// 后端每轮的 /restore 回执（卡片是否下发、权威选择是什么，全部由它决定）
function serve({ widgets, selected }) {
  api.request = async path => {
    assert.match(path, /\/workbench\/ip12\/api\/v4\/restore\//, '只应通过 restore 拉取会话状态');
    return {
      ok: true, history: [], history_total: 0, delegations: {}, report: {}, film: true,
      widgets, selected_choices: selected,
    };
  };
}

test('打字改选后：文案卡不消失，且「已选」跟后端权威选择更新为新版本', async () => {
  const saved = api.request;
  const c = ctx();
  // ① 点选 A（前端本地勾选 + 权威落盘）：卡片在屏、显示已选 A
  serve({ widgets: [scriptCard(2)], selected: { script: { id: 'A', label: 'A · 悬念讲述版', film: true } } });
  await c.restoreAgent('sid-reselect');
  assert.equal(c.data.agentWidgets.length, 1, '文案卡在屏上');
  assert.equal(c.data.agentWidgets[0].key, 'script_pick_qin_unify@2');
  assert.equal(c.data.agentWidgets[0].selectedId, 'A', '卡片显示已选 A');

  // ② 用户打字改选「就选 C 讲给孙子听版那个」：发消息只清屏，不把卡片记成永久关闭
  const sid = 'sid-reselect';
  c.data.agentSessionId = sid;
  let pending = null;
  c.run = fn => fn();
  c.ensureAgentSession = async () => sid;
  c.executeAgent = async job => { pending = job; };
  store.delete('hq-paper-agent-state');
  await c.sendAgentMessage('就选 C 讲给孙子听版那个');
  assert.equal(c.data.agentWidgets.length, 0, '发送瞬间旧卡先让位');
  assert.equal(
    ((api.read().ip12DismissedWidgets || {})[sid] || []).length, 0,
    '绝不把卡片记成永久关闭（这就是文案卡再也回不来的旧根因）'
  );
  assert.equal(pending.body.message, '就选 C 讲给孙子听版那个', '用户原话照发后端');

  c.data.agentPending = null; // executeAgent 收到 seq 后会清空发送记录

  // ③ 后端这轮把改选落盘（selected script=C），卡组仍带同一张文案卡（跨轮续挂，gen 不变）
  serve({ widgets: [scriptCard(2)], selected: { script: { id: 'C', label: 'C · 讲给孙子听版', film: true } } });
  await c.restoreAgent(sid);
  assert.equal(c.data.agentWidgets.length, 1, '打字改选后文案卡不消失（配置卡不会回退成「必选文案」死状态）');
  assert.equal(c.data.agentWidgets[0].key, 'script_pick_qin_unify@2', '同一张卡续挂：没有新 gen 把它顶掉');
  assert.equal(c.data.agentWidgets[0].selectedId, 'C', '卡片已选状态更新为新版本 C');
  assert.equal(c.data.agentWidgets[0].items.length, 3, '三个版本仍在，随时可再改选');
  api.request = saved;
});

test('打字改选后仍可点卡改选：点回上一版照样生效（卡片保持可交互）', async () => {
  const savedRequest = api.request;
  const savedMedia = api.mediaSource;
  api.mediaSource = async url => url;
  const c = ctx();
  serve({
    widgets: [scriptCard(2)],
    selected: { script: { id: 'C', label: 'C · 讲给孙子听版', film: true } },
  });
  await c.restoreAgent('sid-reselect-2');
  c.data.agentSessionId = 'sid-reselect-2';
  c.data.busy = false;
  c.data.agentThinking = false;
  let posted = null;
  const sent = [];
  c.sendAgentMessage = message => { sent.push(message); return Promise.resolve(); };
  api.request = async (path, method, body) => {
    if (path.endsWith('/selection')) { posted = body; return { ok: true, selected_choices: { script: body.choice } }; }
    throw new Error(path);
  };
  await c.chooseAgentWidget.call(c, { currentTarget: { dataset: { widget: 0, option: 0 } } });
  assert.equal(posted.kind, 'script');
  assert.equal(posted.choice.id, 'A', '点 A 就把选择改成 A（点卡改选与打字改选同口径）');
  assert.equal(c.data.agentWidgets[0].selectedId, 'A', '本地勾选立刻生效');
  assert.match(sent[0], /【点选】/, '单卡点选即发');
  api.request = savedRequest;
  api.mediaSource = savedMedia;
});


test('闲聊发送、队列恢复和刷新不复活旧卡，主动继续仍恢复原选择', async () => {
  const saved = api.request;
  const c = ctx({agentSessionId:'sid-chat'});
  const selected = {script:{id:'C',film:true}};
  try {
    serve({widgets:[scriptCard()],selected});
    await c.restoreAgent('sid-chat');
    assert.equal(c.data.agentWidgets.length,1);
    c._agentManualPicks = {'script_pick_qin_unify@1':'C'};
    c.data.agentQueue = [{seq:'2',message:'聊聊海森堡吧'}];
    await c.restoreAgent('sid-chat');
    assert.equal(c.data.agentWidgets.length,0,'上一轮恢复迟到，也不抢回卡片');
    assert.equal(c._agentManualPicks['script_pick_qin_unify@1'],'C','暂时退场不丢未回执的点选');
    c.data.agentQueue = [];
    serve({widgets:[],selected});
    await c.restoreAgent('sid-chat');
    await c.restoreAgent('sid-chat');
    assert.equal(c.data.agentWidgets.length,0,'闲聊回复和再次恢复都零操作卡');
    serve({widgets:[scriptCard()],selected});
    await c.restoreAgent('sid-chat');
    assert.equal(c.data.agentWidgets[0].selectedId,'C','主动继续任务后恢复已选 C');
  } finally { api.request = saved; }
});
