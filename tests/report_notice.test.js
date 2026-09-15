const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const store = new Map();
global.wx = { getStorageSync: (k) => store.get(k), setStorageSync: (k, v) => store.set(k, structuredClone(v)), removeStorageSync: (k) => store.delete(k), openDocument: () => {} };
global.getApp = () => ({ globalData: { apiBase: 'https://huangquechuanmei.com' } });
global.getCurrentPages = () => [];
let definition; global.Component = (c) => (definition = c);
require('../miniprogram/paper/components/screen/index');
const api = require('../miniprogram/paper/services/api');

const SID = 'sid';
const DRAFT = { status: 'draft_ready', files: { pdf: 'api/download/sid/sid_初稿.pdf' } };
const FINAL = { status: 'final', files: { pdf: 'api/download/sid/sid_定稿.pdf' } };
const WXML_PATH = path.join(__dirname, '../miniprogram/paper/components/screen/index.wxml');

function setup(sid) {
  store.clear();
  api.setSession({ token: 'isolated-test', user: { username: 'test' } });
  return Object.assign({}, definition.methods, {
    alive: true, visible: true, properties: { pageId: 'chat' },
    data: { agentSessionId: sid || SID, agentReport: {}, agentReportNotice: null, agentReportOpening: false, agentIpDrawerOpen: false },
    setData(p) { Object.assign(this.data, p); },
    toast(t) { (this.toasts = this.toasts || []).push(t); },
  });
}
// 让 openAgentReport 走真实的下载 + 打开链路，只替换底层的网络/宿主能力
function armOpen(c, { downloadFails = false, openFails = false } = {}) {
  const calls = { download: 0, open: 0 };
  api.mediaSource = async () => { calls.download++; if (downloadFails) throw new Error('download failed'); return 'local://tmp.pdf'; };
  global.wx.openDocument = (o) => { calls.open++; if (openFails) { o.fail && o.fail({ errMsg: 'openDocument:fail' }); return; } o.success && o.success(); };
  return calls;
}

// ---------- 提示卡本体 ----------

test('抽屉关着时，报告可看即在聊天窗口给提示（不依赖抽屉）', () => {
  const c = setup();
  c.syncReportNotice(SID, DRAFT);
  assert.ok(c.data.agentReportNotice);
  assert.equal(c.data.agentIpDrawerOpen, false);
  assert.match(c.data.agentReportNotice.title, /初稿/);
});

test('提示卡是独立条件，按钮带 loading/disabled，关闭键也受同一状态控制', () => {
  const wxml = fs.readFileSync(WXML_PATH, 'utf8');
  assert.match(wxml, /<view wx:if="\{\{agentReportNotice\}\}" class="hq-view agent-report-notice"/);
  assert.match(wxml, /bindtap="viewAgentReportNotice"[^>]*loading="\{\{agentReportOpening\}\}"/);
  assert.match(wxml, /bindtap="viewAgentReportNotice"[^>]*disabled="\{\{agentReportOpening\}\}"/);
  assert.match(wxml, /bindtap="dismissAgentReportNotice"[^>]*disabled="\{\{agentReportOpening\}\}"/);
});

test('反复拉到同一份报告不重复提示，点过之后不再出现', () => {
  const c = setup();
  c.syncReportNotice(SID, DRAFT);
  const key = c.data.agentReportNotice.key;
  c.dismissAgentReportNotice();
  for (let i = 0; i < 5; i++) c.syncReportNotice(SID, DRAFT);
  assert.equal(c.data.agentReportNotice, null);
  assert.equal(api.read().ip12ReportNotices[SID], key);
});

test('报告版本升级（初稿→定稿）会再次提示', () => {
  const c = setup();
  c.syncReportNotice(SID, DRAFT);
  c.dismissAgentReportNotice();
  c.syncReportNotice(SID, FINAL);
  assert.ok(c.data.agentReportNotice);
  assert.match(c.data.agentReportNotice.title, /定稿/);
});

test('跨会话的迟到响应不误提示', () => {
  const c = setup('new-sid');
  c.syncReportNotice('old-sid', DRAFT);
  assert.equal(c.data.agentReportNotice, null);
});

test('报告不可看（无 PDF / 非可看状态）不提示', () => {
  const c = setup();
  c.syncReportNotice(SID, { status: 'collecting', files: {} });
  assert.equal(c.data.agentReportNotice, null);
  c.syncReportNotice(SID, { status: 'draft_ready', files: {} });
  assert.equal(c.data.agentReportNotice, null);
});

// ---------- 切换会话 / 账号 ----------

test('切换会话会清掉上一个会话的提示', () => {
  const c = setup();
  c.syncReportNotice(SID, DRAFT);
  assert.ok(c.data.agentReportNotice);
  c.setData({ agentSessionId: 'other', agentReport: {}, agentReportNotice: null, agentIpDrawerOpen: false });
  c.syncReportNotice('other', null);
  assert.equal(c.data.agentReportNotice, null);
});

test('新建对话后不再显示上一个对话的报告提示', async () => {
  const c = setup();
  c.syncReportNotice(SID, DRAFT);
  api.request = async () => ({ session_id: 'new-sid', seq: 5 });
  c.pollAgent = () => Promise.resolve();
  await c.startNewAgent();
  assert.equal(c.data.agentSessionId, 'new-sid');
  assert.equal(c.data.agentReportNotice, null);
  c.syncReportNotice(SID, DRAFT);
  assert.equal(c.data.agentReportNotice, null);
});

test('切换到没有历史对话的新账号时，旧账号的报告提示必须清掉（走真实 load()）', async () => {
  store.clear();
  api.setSession({ token: 'old-token', user: { username: 'old-user' } });
  const c = Object.assign({}, definition.methods, {
    alive: true, visible: true, properties: { pageId: 'chat' }, owner: 'old-user',
    data: { agentSessionId: 'old-sid', agentReport: { status: 'final', files: { pdf: 'api/download/old-sid/old-sid_x.pdf' } }, agentReportNotice: { key: 'old-sid@final|x', status: 'final', title: '旧账号提示', desc: '…' }, agentIpDrawerOpen: false, agentReportOpening: false },
    setData(p) { Object.assign(this.data, p); }, toast() {},
  });
  api.setSession({ token: 'new-token', user: { username: 'new-user' } });
  api.request = async (p) => {
    const u = String(p);
    if (u.includes('/api/auth/me')) return { user: { username: 'new-user' } };
    if (u.includes('/sessions')) return { sessions: [] };
    if (u.includes('/restore/')) return { seq: 1, history: [], history_total: 0, delegations: {}, widgets: [], report: {} };
    return {};
  };
  await c.load();
  assert.equal(c.data.agentSessionId, '');
  assert.equal(c.data.agentReportNotice, null, '不得把旧账号提示留给新账号');
});

test('同一账号但没有历史会话时，报告提示也要清掉（走真实 load()）', async () => {
  store.clear();
  api.setSession({ token: 'same-token', user: { username: 'same-user' } });
  const c = Object.assign({}, definition.methods, {
    alive: true, visible: true, properties: { pageId: 'chat' }, owner: 'same-user',
    data: { agentSessionId: 'old-sid', agentReport: { status: 'final', files: { pdf: 'api/download/old-sid/old-sid_x.pdf' } }, agentReportNotice: { key: 'old-sid@final|x', status: 'final', title: '旧提示', desc: '…' }, agentIpDrawerOpen: false, agentReportOpening: false },
    setData(p) { Object.assign(this.data, p); }, toast() {},
  });
  api.request = async (p) => {
    const u = String(p);
    if (u.includes('/api/auth/me')) return { user: { username: 'same-user' } };
    if (u.includes('/sessions')) return { sessions: [] };
    if (u.includes('/restore/')) return { seq: 1, history: [], history_total: 0, delegations: {}, widgets: [], report: {} };
    return {};
  };
  await c.load();
  assert.equal(c.data.agentReportNotice, null, '无会话时不得留着上一条对话的报告提示');
});

test('切换账号后即使拉不到会话（请求异常），也要先清掉旧账号提示', async () => {
  store.clear();
  api.setSession({ token: 'old-token', user: { username: 'old-user' } });
  const c = Object.assign({}, definition.methods, {
    alive: true, visible: true, properties: { pageId: 'chat' }, owner: 'old-user',
    data: { agentSessionId: 'old-sid', agentReport: {}, agentReportNotice: { key: 'old-sid@final|x', status: 'final', title: '旧提示', desc: '…' }, agentIpDrawerOpen: false, agentReportOpening: false },
    setData(p) { Object.assign(this.data, p); }, toast() {},
  });
  api.setSession({ token: 'new-token', user: { username: 'new-user' } });
  api.request = async (p) => {
    const u = String(p);
    if (u.includes('/api/auth/me')) return { user: { username: 'new-user' } };
    if (u.includes('/sessions')) { const e = new Error('网络连接中断'); e.uncertain = true; throw e; }
    return {};
  };
  await c.load();
  assert.equal(c.data.agentReportNotice, null, '账号更替后不得残留任何旧账号提示');
});

// ---------- 打开报告：快照 + 四重核对 ----------

test('打开成功：收起提示，并把「点下去的那一版」记为已提示', async () => {
  const c = setup();
  c.data.agentReport = DRAFT;
  c.syncReportNotice(SID, DRAFT);
  const key = c.data.agentReportNotice.key;
  const calls = armOpen(c);
  const ok = await c.viewAgentReportNotice();
  assert.equal(ok, true);
  assert.equal(calls.download, 1);
  assert.equal(calls.open, 1);
  assert.equal(c.data.agentReportNotice, null);
  assert.equal(c.data.agentReportOpening, false);
  assert.equal(api.read().ip12ReportNotices[SID], key);
});

test('下载失败：不清提示、不记已读、提示可重试', async () => {
  const c = setup();
  c.data.agentReport = DRAFT;
  c.syncReportNotice(SID, DRAFT);
  const calls = armOpen(c, { downloadFails: true });
  const ok = await c.viewAgentReportNotice();
  assert.equal(ok, false);
  assert.equal(calls.download, 1);
  assert.equal(calls.open, 0);
  assert.ok(c.data.agentReportNotice, '提示必须保留');
  assert.equal((api.read().ip12ReportNotices || {})[SID], undefined, '不得写已读');
  assert.equal(c.data.agentReportOpening, false, '不能卡在正在打开');
  assert.ok((c.toasts || []).some((t) => /下载失败/.test(t)));
  // 修好后可以再点
  armOpen(c);
  assert.equal(await c.viewAgentReportNotice(), true);
  assert.equal(c.data.agentReportNotice, null);
});

test('openDocument 失败：不清提示、不记已读、可重试', async () => {
  const c = setup();
  c.data.agentReport = DRAFT;
  c.syncReportNotice(SID, DRAFT);
  const calls = armOpen(c, { openFails: true });
  assert.equal(await c.viewAgentReportNotice(), false);
  assert.equal(calls.open, 1);
  assert.ok(c.data.agentReportNotice);
  assert.equal((api.read().ip12ReportNotices || {})[SID], undefined);
  assert.ok((c.toasts || []).some((t) => /打开失败/.test(t)));
});

test('连续点两次：只下载、只打开一次', async () => {
  const c = setup();
  c.data.agentReport = DRAFT;
  c.syncReportNotice(SID, DRAFT);
  const calls = armOpen(c);
  const first = c.viewAgentReportNotice();
  const second = c.viewAgentReportNotice();   // 打开中，应被拒
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, true);
  assert.equal(b, false, '第二次点击应被拒');
  assert.equal(calls.download, 1);
  assert.equal(calls.open, 1);
});

test('打开期间初稿升级成定稿：定稿提示保留，且不把定稿标成已读', async () => {
  const c = setup();
  c.data.agentReport = DRAFT;
  c.syncReportNotice(SID, DRAFT);
  const draftKey = c.data.agentReportNotice.key;
  let release;
  api.mediaSource = () => new Promise((r) => { release = () => r('local://tmp.pdf'); });
  global.wx.openDocument = (o) => o.success && o.success();
  const pending = c.viewAgentReportNotice();
  // 打开还没回来，定稿顶替了提示
  c.syncReportNotice(SID, FINAL);
  const finalKey = c.data.agentReportNotice.key;
  assert.notEqual(finalKey, draftKey);
  release();
  assert.equal(await pending, true);
  assert.ok(c.data.agentReportNotice, '定稿提示必须还在');
  assert.equal(c.data.agentReportNotice.key, finalKey);
  assert.notEqual((api.read().ip12ReportNotices || {})[SID], finalKey, '不得把定稿记成已读');
});

test('打开期间切换会话：新会话提示不被清理', async () => {
  const c = setup();
  c.data.agentReport = DRAFT;
  c.syncReportNotice(SID, DRAFT);
  let release;
  api.mediaSource = () => new Promise((r) => { release = () => r('local://tmp.pdf'); });
  global.wx.openDocument = (o) => o.success && o.success();
  const pending = c.viewAgentReportNotice();
  // 切到另一个会话，并出现该会话自己的提示
  c.setData({ agentSessionId: 'other-sid', agentReport: FINAL, agentReportNotice: { key: 'other-sid@final|y', status: 'final', title: '另一个会话的提示', desc: '…' } });
  release();
  await pending;
  assert.ok(c.data.agentReportNotice, '新会话提示不能被旧会话的打开结果清掉');
  assert.equal(c.data.agentReportNotice.key, 'other-sid@final|y');
  assert.equal((api.read().ip12ReportNotices || {})[SID], undefined, '不得给旧会话写已读');
});

test('打开期间切换账号：不向新账号写入旧账号已读', async () => {
  const c = setup();
  c.data.agentReport = DRAFT;
  c.syncReportNotice(SID, DRAFT);
  let release;
  api.mediaSource = () => new Promise((r) => { release = () => r('local://tmp.pdf'); });
  global.wx.openDocument = (o) => o.success && o.success();
  const pending = c.viewAgentReportNotice();
  api.setSession({ token: 'another-token', user: { username: 'other-user' } });   // 换账号
  release();
  await pending;
  assert.equal((api.read().ip12ReportNotices || {})[SID], undefined, '不得写到新账号的存储里');
});

test('页面隐藏或组件销毁后，迟到的打开结果不再更新页面', async () => {
  const c = setup();
  c.data.agentReport = DRAFT;
  c.syncReportNotice(SID, DRAFT);
  let release;
  api.mediaSource = () => new Promise((r) => { release = () => r('local://tmp.pdf'); });
  global.wx.openDocument = (o) => o.success && o.success();
  const pending = c.viewAgentReportNotice();
  c.visible = false;                            // 页面隐藏
  const before = JSON.stringify(c.data);
  release();
  await pending;
  assert.equal(JSON.stringify(c.data), before, '隐藏后不得再回写页面状态');
  assert.equal((api.read().ip12ReportNotices || {})[SID], undefined, '隐藏后也不结算已读');
});

test('关闭提示与打开完成同时发生：不会误清新版本', async () => {
  const c = setup();
  c.data.agentReport = DRAFT;
  c.syncReportNotice(SID, DRAFT);
  let release;
  api.mediaSource = () => new Promise((r) => { release = () => r('local://tmp.pdf'); });
  global.wx.openDocument = (o) => o.success && o.success();
  const pending = c.viewAgentReportNotice();
  c.dismissAgentReportNotice();                 // 用户手动关掉
  c.syncReportNotice(SID, FINAL);               // 定稿随后出现
  const finalKey = c.data.agentReportNotice.key;
  release();
  await pending;
  assert.ok(c.data.agentReportNotice, '新版本提示不能被误清');
  assert.equal(c.data.agentReportNotice.key, finalKey);
});
