const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const store = new Map();
global.wx = { getStorageSync: (k) => store.get(k), setStorageSync: (k, v) => store.set(k, structuredClone(v)), removeStorageSync: (k) => store.delete(k), openDocument: () => {} };
global.getApp = () => ({ globalData: { apiBase: 'https://huangquechuanmei.com' } });
global.getCurrentPages = () => [];
let definition; global.Component = (c) => (definition = c);
require('../miniprogram/paper/components/screen/index');
const api = require('../miniprogram/paper/services/api');

const SRC_PATH = path.join(__dirname, '../miniprogram/paper/components/screen/index.js');
const WXML_PATH = path.join(__dirname, '../miniprogram/paper/components/screen/index.wxml');
const WXSS_PATH = path.join(__dirname, '../miniprogram/paper/components/screen/index.wxss');

// 把 mediaFromContent / fileNameFromPath 单独抽出来执行（它们只依赖字符串与正则）
function loadMediaHelpers() {
  const src = fs.readFileSync(SRC_PATH, 'utf8');
  const start = src.indexOf('function fileNameFromPath');
  const end = src.indexOf('function agentInlineNodes');
  assert.ok(start >= 0 && end > start, '应能定位到媒体解析函数');
  const code = src.slice(start, end) + '\nmodule.exports={mediaFromContent,fileNameFromPath};';
  const m = { exports: {} };
  new Function('module', 'exports', 'require', code)(m, m.exports, () => ({}));
  return m.exports;
}

test('正文里的 api/download 路径被抽成文件卡，并从正文里移除', () => {
  const { mediaFromContent } = loadMediaHelpers();
  const sid = 'a0dd8da94f1a422babd5d21b6f0cc352';
  const out = mediaFromContent('报告好了，链接在这：api/download/' + sid + '/' + sid + '_老王_IP人设定位_初稿.pdf 点开看看。');
  assert.equal(out.files.length, 1, '应识别出 1 个文件');
  assert.equal(out.files[0].url, 'api/download/' + sid + '/' + sid + '_老王_IP人设定位_初稿.pdf');
  assert.equal(out.files[0].name, '老王_IP人设定位_初稿.pdf', '文件名应去掉会话 id 前缀');
  assert.doesNotMatch(out.content, /api\/download/, '正文里不该再残留裸路径');
  assert.match(out.content, /点开看看/);
});

test('workbench 前缀与中文乱码文件名同样识别', () => {
  const { mediaFromContent } = loadMediaHelpers();
  const sid = 'a0dd8da94f1a422babd5d21b6f0cc352';
  const out = mediaFromContent('见 /workbench/ip12/api/download/' + sid + '/' + sid + '_%E8%80%81%E7%8E%8B_%E5%88%9D%E7%A8%BF.pdf');
  assert.equal(out.files.length, 1);
  assert.equal(out.files[0].name, '老王_初稿.pdf', 'URL 编码的中文与会话 id 前缀都要处理');
});

test('图片/视频/音频不受影响，且不会被当成文件', () => {
  const { mediaFromContent } = loadMediaHelpers();
  const out = mediaFromContent('图 https://x.com/a.png 视频 https://x.com/b.mp4 音频 https://x.com/c.mp3 文件 api/download/sid/sid_d.pdf');
  assert.equal(out.images.length, 1);
  assert.equal(out.videos.length, 1);
  assert.equal(out.audios.length, 1);
  assert.equal(out.files.length, 1);
});

test('同一路径重复出现只出一张卡', () => {
  const { mediaFromContent } = loadMediaHelpers();
  const sid = 'a0dd8da94f1a422babd5d21b6f0cc352';
  const u = 'api/download/' + sid + '/' + sid + '_d.pdf';
  const out = mediaFromContent(u + ' 和 ' + u);
  assert.equal(out.files.length, 1);
});

test('文件卡在 WXML 里绑定 openAgentFile，并有样式', () => {
  const wxml = fs.readFileSync(WXML_PATH, 'utf8'), wxss = fs.readFileSync(WXSS_PATH, 'utf8');
  assert.match(wxml, /wx:if="\{\{item\.files\.length\}\}" class="hq-view agent-files"/);
  assert.match(wxml, /bindtap="openAgentFile"/);
  assert.match(wxss, /\.agent-file-card/);
});

test('openAgentFile 按会话/文件名解析地址并调 openDocument', async () => {
  store.clear();
  api.setSession({ token: 'isolated-test', user: { username: 'test' } });
  const opened = [];
  let asked = '';
  api.mediaSource = async (url) => { asked = url; return 'local://tmp.pdf'; };
  global.wx.openDocument = (o) => { opened.push(o); o.success && o.success(); };
  const c = Object.assign({}, definition.methods, {
    alive: true, data: { agentMessages: [{ files: [{ url: 'api/download/0123456789abcdef0123456789abcdef/0123456789abcdef0123456789abcdef_老王_定稿.pdf', name: '老王_定稿.pdf' }] }] },
    setData(p) { Object.assign(this.data, p); },
    toast() {},
  });
  await c.openAgentFile({ currentTarget: { dataset: { message: 0, file: 0 } } });
  assert.match(asked, /\/workbench\/ip12\/api\/download\/0123456789abcdef0123456789abcdef\/0123456789abcdef0123456789abcdef_老王_定稿\.pdf$/, '相对路径应补成站内绝对地址');
  assert.equal(opened.length, 1, '应调用一次 openDocument');
  assert.equal(opened[0].fileType, 'pdf');
  assert.equal(opened[0].showMenu, true, '要能转发/用其他应用打开');
});

test('没有文件时给出提示而不是静默失败', async () => {
  const toasts = [];
  const c = Object.assign({}, definition.methods, {
    alive: true, data: { agentMessages: [] }, setData(p) { Object.assign(this.data, p); },
    toast(t) { toasts.push(t); },
  });
  await c.openAgentFile({ currentTarget: { dataset: { message: 0, file: 0 } } });
  assert.equal(toasts.length, 1);
});
