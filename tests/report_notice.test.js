const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const store = new Map();
global.wx = { getStorageSync: (k) => store.get(k), setStorageSync: (k, v) => store.set(k, structuredClone(v)), removeStorageSync: (k) => store.delete(k) };
global.getApp = () => ({ globalData: { apiBase: 'https://huangquechuanmei.com' } });
global.getCurrentPages = () => [];
let definition; global.Component = (c) => (definition = c);
require('../miniprogram/paper/components/screen/index');
const api = require('../miniprogram/paper/services/api');

const DRAFT = { status: 'draft_ready', files: { pdf: 'api/download/sid/sid_老王_IP人设定位_初稿.pdf' } };
const FINAL = { status: 'final', files: { pdf: 'api/download/sid/sid_老王_IP人设定位_定稿.pdf' } };

function setup(sid) {
  store.clear();
  api.setSession({ token: 'isolated-test', user: { username: 'test' } });
  // 关键前提：抽屉是关着的（原实现下报告状态只被隐藏抽屉使用）
  return Object.assign({}, definition.methods, {
    alive: true, visible: true, properties: { pageId: 'chat' },
    data: { agentSessionId: sid || 'sid', agentReport: {}, agentReportNotice: null, agentIpDrawerOpen: false },
    setData(p) { Object.assign(this.data, p); },
  });
}

test('抽屉关着时，报告可看即在聊天窗口给提示（不依赖抽屉）', () => {
  const c = setup();
  c.syncReportNotice('sid', DRAFT);
  assert.ok(c.data.agentReportNotice, '应出现完成提示');
  assert.equal(c.data.agentIpDrawerOpen, false, '抽屉仍关闭');
  assert.match(c.data.agentReportNotice.title, /初稿/);
  assert.equal(c.data.agentReportNotice.status, 'draft_ready');
});

test('提示卡在 WXML 里是独立条件，不由抽屉控制', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/paper/components/screen/index.wxml'), 'utf8');
  assert.match(wxml, /<view wx:if="\{\{agentReportNotice\}\}" class="hq-view agent-report-notice"/, '提示卡必须独立渲染');
  assert.match(wxml, /bindtap="viewAgentReportNotice"/);
  assert.match(wxml, /bindtap="dismissAgentReportNotice"/);
});

test('反复拉到同一份报告不重复提示，点过之后不再出现', () => {
  const c = setup();
  c.syncReportNotice('sid', DRAFT);
  const key = c.data.agentReportNotice.key;
  c.dismissAgentReportNotice();
  assert.equal(c.data.agentReportNotice, null, '忽略后消失');
  for (let i = 0; i < 5; i++) c.syncReportNotice('sid', DRAFT);
  assert.equal(c.data.agentReportNotice, null, '同一版本不得再次提示');
  assert.equal(api.read().ip12ReportNotices.sid, key, '已按会话记住版本');
});

test('报告版本升级（初稿→定稿）会再次提示', () => {
  const c = setup();
  c.syncReportNotice('sid', DRAFT);
  c.dismissAgentReportNotice();
  c.syncReportNotice('sid', FINAL);
  assert.ok(c.data.agentReportNotice, '定稿是新版本，应再次提示');
  assert.match(c.data.agentReportNotice.title, /定稿/);
});

test('点“查看报告”打开的是当前报告的 PDF 并记为已提示', async () => {
  const c = setup();
  c.data.agentReport = DRAFT;
  let opened = 0;
  c.openAgentReport = () => { opened++; return Promise.resolve(true); };
  c.syncReportNotice('sid', DRAFT);
  await c.viewAgentReportNotice();
  assert.equal(opened, 1, '应调用打开报告');
  assert.equal(c.data.agentReportNotice, null, '成功打开后才收起提示');
  c.syncReportNotice('sid', DRAFT);
  assert.equal(c.data.agentReportNotice, null, '不重复提示');
});

test('新建对话后不再显示上一个对话的报告提示', async () => {
  const c = setup();
  c.syncReportNotice('sid', DRAFT);
  assert.ok(c.data.agentReportNotice, '前置：旧对话已有提示');
  api.request = async () => ({ session_id: 'new-sid', seq: 5 });
  c.pollAgent = () => Promise.resolve();
  await c.startNewAgent();
  assert.equal(c.data.agentSessionId, 'new-sid');
  assert.equal(c.data.agentReportNotice, null, '新对话不得带着旧对话的报告提示');
  // 旧会话的报告随后回来，也不能在新对话里弹
  c.syncReportNotice('sid', DRAFT);
  assert.equal(c.data.agentReportNotice, null);
});

test('“查看报告”没打开成功时，不清提示、不记为已读', async () => {
  const c = setup();
  c.syncReportNotice('sid', DRAFT);
  const key = c.data.agentReportNotice.key;
  // 打不开（下载失败 / openDocument 失败）
  c.openAgentReport = () => Promise.resolve(false);
  await c.viewAgentReportNotice();
  assert.ok(c.data.agentReportNotice, '没打开就不该清提示');
  assert.equal((api.read().ip12ReportNotices || {}).sid, undefined, '没打开就不该记为已读');
  // 真的打开了才清、才记已读
  c.openAgentReport = () => Promise.resolve(true);
  await c.viewAgentReportNotice();
  assert.equal(c.data.agentReportNotice, null);
  assert.equal(api.read().ip12ReportNotices.sid, key, '成功打开后才按版本记为已提示');
});

test('切换到没有历史对话的新账号时，旧账号的报告提示必须清掉（走真实 load()）', async () => {
  store.clear();
  api.setSession({ token: 'old-token', user: { username: 'old-user' } });
  const c = Object.assign({}, definition.methods, {
    alive: true, visible: true, properties: { pageId: 'chat' },
    owner: 'old-user',
    data: {
      agentSessionId: 'old-sid',
      agentReport: { status: 'final', files: { pdf: 'api/download/old-sid/old-sid_x.pdf' } },
      agentReportNotice: { key: 'old-sid@final|x', status: 'final', title: 'IP 定位报告 · 定稿已生成', desc: '点开查看 PDF。' },
      agentIpDrawerOpen: false,
    },
    setData(p) { Object.assign(this.data, p); },
    toast() {},
  });
  // 切到新账号，且新账号没有任何历史会话
  api.setSession({ token: 'new-token', user: { username: 'new-user' } });
  api.request = async (path) => {
    const url = String(path);
    if (url.includes('/api/auth/me')) return { user: { username: 'new-user' } };
    if (url.includes('/sessions')) return { sessions: [] };
    if (url.includes('/restore/')) return { seq: 1, history: [], history_total: 0, delegations: {}, widgets: [], report: {} };
    return {};
  };
  await c.load();
  assert.equal(c.data.agentSessionId, '', '新账号没有历史会话');
  assert.equal(c.data.agentReport && Object.keys(c.data.agentReport).length, 0, '报告状态应清空');
  assert.equal(c.data.agentReportNotice, null, '不得把旧账号的报告提示留给新账号');
});

test('同一账号但没有历史会话时，报告提示也要清掉（走真实 load()）', async () => {
  store.clear();
  api.setSession({ token: 'same-token', user: { username: 'same-user' } });
  const c = Object.assign({}, definition.methods, {
    alive: true, visible: true, properties: { pageId: 'chat' },
    owner: 'same-user', // owner 一致，不走账号重置分支，只看“无当前会话”分支
    data: {
      agentSessionId: 'old-sid',
      agentReport: { status: 'final', files: { pdf: 'api/download/old-sid/old-sid_x.pdf' } },
      agentReportNotice: { key: 'old-sid@final|x', status: 'final', title: 'IP 定位报告 · 定稿已生成', desc: '点开查看 PDF。' },
      agentIpDrawerOpen: false,
    },
    setData(p) { Object.assign(this.data, p); },
    toast() {},
  });
  api.request = async (path) => {
    const url = String(path);
    if (url.includes('/api/auth/me')) return { user: { username: 'same-user' } };
    if (url.includes('/sessions')) return { sessions: [] };
    if (url.includes('/restore/')) return { seq: 1, history: [], history_total: 0, delegations: {}, widgets: [], report: {} };
    return {};
  };
  await c.load();
  assert.equal(c.data.agentSessionId, '', '没有历史会话');
  assert.equal(c.data.agentReportNotice, null, '无会话时不得留着上一条对话的报告提示');
});

test('切换账号后即使拉不到会话（请求异常），也要先清掉旧账号提示', async () => {
  store.clear();
  api.setSession({ token: 'old-token', user: { username: 'old-user' } });
  const c = Object.assign({}, definition.methods, {
    alive: true, visible: true, properties: { pageId: 'chat' },
    owner: 'old-user',
    data: {
      agentSessionId: 'old-sid',
      agentReport: { status: 'final', files: { pdf: 'api/download/old-sid/old-sid_x.pdf' } },
      agentReportNotice: { key: 'old-sid@final|x', status: 'final', title: 'IP 定位报告 · 定稿已生成', desc: '点开查看 PDF。' },
      agentIpDrawerOpen: false,
    },
    setData(p) { Object.assign(this.data, p); },
    toast() {},
  });
  api.setSession({ token: 'new-token', user: { username: 'new-user' } });
  api.request = async (path) => {
    const url = String(path);
    if (url.includes('/api/auth/me')) return { user: { username: 'new-user' } };
    if (url.includes('/sessions')) { const e = new Error('网络连接中断'); e.uncertain = true; throw e; }
    return {};
  };
  await c.load();
  // 拉不到会话时 loadAgent 会抛错，但账号已经换了，提示不能留着
  assert.equal(c.data.agentReportNotice, null, '账号更替后不得残留任何旧账号提示');
});

test('跨会话的迟到响应不误提示', () => {
  const c = setup('new-sid');
  c.syncReportNotice('old-sid', DRAFT);
  assert.equal(c.data.agentReportNotice, null, '别的会话不得在当前会话弹提示');
});

test('报告不可看（无 PDF / 非 draft_ready|final）不提示', () => {
  const c = setup();
  c.syncReportNotice('sid', { status: 'collecting', files: {} });
  assert.equal(c.data.agentReportNotice, null);
  c.syncReportNotice('sid', { status: 'draft_ready', files: {} });
  assert.equal(c.data.agentReportNotice, null, '没有 PDF 不算可看');
});

test('切换会话会清掉上一个会话的提示', () => {
  const c = setup();
  c.syncReportNotice('sid', DRAFT);
  assert.ok(c.data.agentReportNotice);
  // restoreAgent 切会话时走同一条 setData 分支
  c.setData({ agentSessionId: 'other', agentReport: {}, agentReportNotice: null, agentIpDrawerOpen: false, agentAttachments: [], agentAssets: [], agentAssetsOpen: false });
  c.syncReportNotice('other', null);
  assert.equal(c.data.agentReportNotice, null);
});
