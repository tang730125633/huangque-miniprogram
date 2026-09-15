const test = require('node:test'), assert = require('node:assert/strict');
const store = new Map();
global.wx = { getStorageSync: (k) => store.get(k), setStorageSync: (k, v) => store.set(k, structuredClone(v)), removeStorageSync: (k) => store.delete(k) };
global.getApp = () => ({ globalData: { apiBase: 'https://huangquechuanmei.com' } });
global.getCurrentPages = () => [];
let definition; global.Component = (c) => (definition = c);
require('../miniprogram/paper/components/screen/index');
const api = require('../miniprogram/paper/services/api');

function setup() {
  store.clear();
  api.setSession({ token: 'isolated-test', user: { username: 'test' } });
  return Object.assign({}, definition.methods, {
    alive: true, visible: true, properties: { pageId: 'chat' },
    data: { agentSessionId: 'sid', agentReport: {}, agentReportNotice: null, agentReportOpening: false },
    setData(p) { Object.assign(this.data, p); },
    toast() {},
  });
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const PDF = { status: 'draft_ready', files: { pdf: 'api/download/sid/sid_a.pdf' } };

test('报告到终态后停止轮询，不再发请求', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const c = setup(); let calls = 0;
  api.request = async () => { calls++; return { status: 'final', files: { pdf: 'api/download/sid/sid_f.pdf' } }; };
  c.startReportPoll('sid');
  t.mock.timers.tick(5000); await flush();
  assert.equal(calls, 1);
  assert.equal(c.reportPollOwner.timer, null, '终态后不该再排下一次');
  t.mock.timers.tick(60000); await flush();
  assert.equal(calls, 1, '终态后不再请求');
});

test('未到终态（draft_ready）继续轮询', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const c = setup(); let calls = 0;
  api.request = async () => { calls++; return PDF; };
  c.startReportPoll('sid');
  t.mock.timers.tick(5000); await flush();
  t.mock.timers.tick(5000); await flush();
  t.mock.timers.tick(5000); await flush();
  assert.equal(calls, 3, '初稿不是终态，应持续轮询');
});

test('临时网络失败继续重试', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const c = setup(); let calls = 0;
  api.request = async () => { calls++; const e = new Error('网络连接中断'); e.uncertain = true; throw e; };
  c.startReportPoll('sid');
  t.mock.timers.tick(5000); await flush();
  t.mock.timers.tick(5000); await flush();
  assert.equal(calls, 2, '临时失败应继续重试');
  assert.ok(c.reportPollOwner.timer !== null || c.reportPollOwner.idle > 1, '仍处于轮询中');
});

test('401/403/404 直接停止轮询', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const c = setup(); let calls = 0;
  api.request = async () => { calls++; const e = new Error('无权限'); e.status = 403; throw e; };
  c.startReportPoll('sid');
  t.mock.timers.tick(5000); await flush();
  assert.equal(calls, 1);
  assert.equal(c.reportPollOwner.timer, null, '权限/不存在类错误不该继续打');
  t.mock.timers.tick(30000); await flush();
  assert.equal(calls, 1);
});

test('页面隐藏后停止轮询，重新显示可再次启动', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const c = setup(); let calls = 0;
  api.request = async () => { calls++; return PDF; };
  c.startReportPoll('sid');
  t.mock.timers.tick(5000); await flush();
  assert.equal(calls, 1);
  c.visible = false;           // 等价于 pageLifetimes.hide
  c.stopReportPoll();
  t.mock.timers.tick(30000); await flush();
  assert.equal(calls, 1, '隐藏后不再请求');
  c.visible = true;            // 重新显示：restoreAgent 会再启动
  c.startReportPoll('sid');
  t.mock.timers.tick(5000); await flush();
  assert.equal(calls, 2, '重新显示后恢复轮询');
});

test('跨会话/跨账号的迟到响应直接丢弃，不写页面状态', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const c = setup(); let release;
  api.request = () => new Promise((r) => { release = r; });
  c.startReportPoll('sid');
  t.mock.timers.tick(5000); await flush();
  c.data.agentSessionId = 'other-sid';      // 期间切了会话
  release({ status: 'final', files: { pdf: 'api/download/sid/sid_f.pdf' } });
  await flush();
  assert.deepEqual(c.data.agentReport, {}, '迟到结果不得写进当前会话');
  assert.equal(c.data.agentReportNotice, null);
});

test('轮询只做只读拉取：不发消息、不建任务、不扣点', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const c = setup();
  const seen = [];
  api.request = async (path, method) => { seen.push([String(method || 'GET'), String(path)]); return PDF; };
  let sent = 0;
  c.sendAgentMessage = () => { sent++; };
  c.startReportPoll('sid');
  t.mock.timers.tick(5000); await flush();
  assert.equal(sent, 0, '绝不能自动发消息');
  assert.equal(seen.length, 1);
  seen.forEach(([method, path]) => {
    assert.equal(method, 'GET', '只能是 GET');
    assert.match(path, /\/api\/report\//);
    assert.doesNotMatch(path, /\/chat|\/start|\/confirm/, '不得触发任务类接口');
  });
});

test('反复查询同一个终态报告：轮询已停，不会产生新任务', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const c = setup(); const seen = [];
  api.request = async (path, method) => { seen.push(String(path)); return { status: 'confirmed', files: { pdf: 'api/download/sid/sid_f.pdf' } }; };
  c.startReportPoll('sid');
  t.mock.timers.tick(5000); await flush();
  t.mock.timers.tick(5000); await flush();
  assert.equal(seen.length, 1, '终态后不重复请求');
  assert.ok(seen.every((p) => p.includes('/api/report/')), '只拉报告，不触发任何生成任务');
});
