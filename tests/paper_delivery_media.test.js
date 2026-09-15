// 成片交付消息渲染（2026-09-16 老板实录：任务 9262 交付塞了两张封面大图、
// 配音 mp3、重复视频卡）：封面图只留一张小卡；视频消息里的 mp3 副产品不渲染音频卡；
// 收尾消息里重复贴的视频链接由后端系统事件轮剥离（前端保留渲染能力，用户要重发时不吞）。
const test = require('node:test');
const assert = require('node:assert/strict');

let component;
global.wx = {
  getStorageSync() { return null; },
  setStorageSync() {},
  showToast() {},
  previewImage() {},
  showShareImageMenu() {},
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

function ctx() {
  const c = Object.create(component.methods);
  c.alive = true;
  c.data = {
    agentMessages: [], agentSessionId: '', agentDelegations: [], agentWidgets: [],
    agentReport: null, agentHiddenCount: 0, agentImageHiddenCount: 0,
    agentAttachments: [], agentAssets: [], agentAssetsOpen: false,
    agentReportNotice: null, agentQueueTasks: [], agentQueueReconnecting: false,
  };
  c.setData = setData;
  c.scrollAgent = () => {};
  c.settleAgentPicks = () => {};
  c.stopAgentPoll = () => {};
  c.stopTaskQueue = () => {};
  c.closeAgentVoiceFlow = () => {};
  c.syncReportNotice = () => {};
  c.startReportPoll = () => {};
  c.startAgentWatch = () => {};
  c.refreshTaskQueue = () => {};
  c.toast = () => {};
  c.agentAudio = null;
  c.agentAssetAudio = null;
  c.agentAudioMeta = null;
  return c;
}

async function restore(history) {
  const originalRequest = api.request;
  api.request = async () => ({
    history,
    widgets: [], film: false, selected_choices: {}, delegations: {},
    report: null, history_total: history.length,
  });
  try {
    const c = ctx();
    await c.restoreAgent('sid-x');
    return c.data.agentMessages;
  } finally {
    api.request = originalRequest;
  }
}

test('成片交付：两张封面只留官方一张小卡，mp4 视频卡一张，配音 mp3 不渲染', async () => {
  const messages = await restore([
    { role: 'user', content: '出个视频' },
    { role: 'assistant', content: '任务 9262 ✅ 已完成。\n视频生成完成\n'
      + 'https://video.huangquechuanmei.com/huangque/video-covers/9262.jpg\n'
      + 'https://cdn.example.com/video/subtitled.mp4?sig=1\n'
      + 'https://cdn.example.com/audio/aud.mp3?sig=2\n'
      + 'https://cdn.example.com/heygen_x_cover.jpg?sig=3' },
  ]);
  const delivery = messages[1];
  assert.deepEqual(delivery.covers, ['https://video.huangquechuanmei.com/huangque/video-covers/9262.jpg']);
  assert.equal(delivery.images.length, 0, '封面图不再作为大图卡渲染');
  assert.deepEqual(delivery.videos.map(v => v.url), ['https://cdn.example.com/video/subtitled.mp4?sig=1']);
  assert.equal(delivery.audios.length, 0, '成片消息里的配音 mp3 不渲染音频卡');
});

test('封面延迟补推消息：封面按小卡渲染、不占大图位', async () => {
  const messages = await restore([
    { role: 'assistant', content: '视频封面已生成：\n'
      + 'https://video.huangquechuanmei.com/huangque/video-covers/9262.jpg' },
  ]);
  const late = messages[0];
  assert.deepEqual(late.covers, ['https://video.huangquechuanmei.com/huangque/video-covers/9262.jpg']);
  assert.equal(late.images.length, 0);
  assert.equal(late.videos.length, 0);
});

test('封面与普通图片同消息：封面进小卡、普通图片照常大图渲染', async () => {
  const messages = await restore([
    { role: 'assistant', content: '海报好了 👇\n'
      + 'https://video.huangquechuanmei.com/huangque/video-covers/9262.jpg\n'
      + 'https://cdn.example.com/poster/123.jpg\n'
      + 'https://cdn.example.com/video/subtitled.mp4?sig=1' },
  ]);
  const m = messages[0];
  assert.deepEqual(m.covers, ['https://video.huangquechuanmei.com/huangque/video-covers/9262.jpg']);
  assert.deepEqual(m.images, ['https://cdn.example.com/poster/123.jpg']);
});

test('纯音频产品消息（无视频）：音频卡照常渲染', async () => {
  const messages = await restore([
    { role: 'assistant', content: '任务 9001 ✅ 已完成。\n配乐完成\n'
      + 'https://cdn.example.com/audio/bgm.mp3?sig=1' },
  ]);
  const m = messages[0];
  assert.equal(m.videos.length, 0);
  assert.deepEqual(m.audios.map(a => a.url), ['https://cdn.example.com/audio/bgm.mp3?sig=1']);
});

test('收尾消息重复贴的视频链接：前端保留渲染能力（后端系统事件轮负责剥离）', async () => {
  const messages = await restore([
    { role: 'assistant', content: '任务 9262 ✅ 已完成。\n'
      + 'https://cdn.example.com/video/subtitled.mp4?sig=1' },
    { role: 'assistant', content: '成片出来了 ✅ 👇\n\n'
      + 'https://cdn.example.com/video/subtitled.mp4?sig=broken\n\n已经存进你的素材库了。' },
  ]);
  const closing = messages[1];
  assert.deepEqual(closing.videos.map(v => v.url), ['https://cdn.example.com/video/subtitled.mp4?sig=broken']);
  assert.ok(closing.content.includes('已经存进你的素材库了'));
});
