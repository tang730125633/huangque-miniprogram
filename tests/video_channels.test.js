const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const videoJs = fs.readFileSync(path.join(root, 'miniprogram/pages/video/video.js'), 'utf8');
const videoWxml = fs.readFileSync(path.join(root, 'miniprogram/pages/video/video.wxml'), 'utf8');

assert.match(videoJs, /key: 'micro', name: '黄豆视频'/);
assert.match(videoJs, /key: 'omni', name: '欧米视频'/);
assert.match(videoJs, /defaultRatio: '16:9', maxRef: 6/);
assert.match(videoJs, /key: 'sora', name: 'Sora 2'/);
assert.match(videoWxml, /黄豆视频官方标准模型/);
assert.match(videoWxml, /欧米视频官方通道/);
assert.match(videoJs, /health\.seedance_video_enabled === true/);
assert.match(videoJs, /health\.omni_video_enabled === true/);
assert.match(videoJs, /health\.sora_video_enabled === true/);
assert.match(videoJs, /body\.model = cfg\.model/);
assert.match(videoJs, /body\.generate_audio = true/);
assert.match(videoJs, /idempotencyKey: official \? officialVideoRequestKey\(\) : ''/);
assert.match(videoWxml, /bindtap="selectOfficialDuration"/);
assert.match(videoWxml, /bindtap="selectOfficialResolution"/);
assert.match(videoWxml, /bindtap="selectSoraModel"/);
assert.match(videoWxml, /仅支持 4、8、12 秒/);
assert.match(videoWxml, /1 张非真人参考图作为首帧/);
assert.match(videoWxml, /bindtap="selectPromptMention"/);
assert.match(videoWxml, /catchtap="insertGenerateRefMention"/);
assert.match(videoWxml, /catchtap="insertCineRefMention"/);

let requestOptions;
let videoPage;
global.getApp = () => ({ globalData: { apiBase: 'https://example.test' } });
global.getCurrentPages = () => [];
global.wx = {
  getStorageSync: () => 'token',
  request: (options) => { requestOptions = options; options.success({ statusCode: 200, data: { job_id: 91, cost: 1200, points_left: 0 } }); }
};
global.Page = (definition) => { videoPage = definition; };
const api = require('../miniprogram/utils/api.js');
require('../miniprogram/pages/video/video.js');

function pageFor(engine) {
  const page = Object.assign({}, videoPage, {
    data: JSON.parse(JSON.stringify(videoPage.data)),
    _b64: { refImgs: [] },
    setData(patch) { Object.assign(this.data, patch); },
    setNote() {}
  });
  page.setData(page._engineState(engine));
  return page;
}

(async function () {
  const micro = pageFor('micro');
  let submitted;
  micro.data.prompt = '人物在海边缓慢向镜头走来';
  micro.submitJob = (endpoint, body, cost) => { submitted = { endpoint, body, cost }; };
  micro.submitGenerate();
  assert.strictEqual(submitted.endpoint, '/api/gen/xiaole_video');
  assert.deepStrictEqual(submitted.body, {
    channel: 'micro', prompt: '人物在海边缓慢向镜头走来', ratio: '9:16',
    model: 'doubao-seedance-2-0-260128', duration: 5, resolution: '720p', generate_audio: true
  });
  assert.strictEqual(submitted.cost, 150);

  const omni = pageFor('omni');
  assert.strictEqual(omni.data.engineRefMax, 6);

  const grok15 = pageFor('grok');
  grok15._applyGrokModel('grok-imagine-video-1.5');
  assert.strictEqual(grok15.data.engineRefMax, 7);
  assert.deepStrictEqual(grok15.data.grokResList, ['720p']);
  grok15.data.prompt = '让三张参考图中的人物在同一场景互动';
  grok15.data.refPreviews = ['p1', 'p2', 'p3'];
  grok15._b64.refImgs = ['r1', 'r2', 'r3'];
  grok15.submitJob = (endpoint, body, cost) => { submitted = { endpoint, body, cost }; };
  grok15.submitGenerate();
  assert.deepStrictEqual(submitted.body.reference_images, ['r1', 'r2', 'r3']);
  assert.strictEqual(submitted.body.resolution, '720p');

  const sora = pageFor('sora');
  sora.data.prompt = '一艘发光的飞船掠过没有人物的未来城市';
  sora.data.soraModel = 'sora-2-pro';
  sora.data.soraResolution = '1024p';
  sora.data.soraDuration = 8;
  sora.submitJob = (endpoint, body, cost) => { submitted = { endpoint, body, cost }; };
  sora.submitGenerate();
  assert.strictEqual(submitted.endpoint, '/api/gen/sora_video');
  assert.deepStrictEqual(submitted.body, {
    model: 'sora-2-pro', prompt: '一艘发光的飞船掠过没有人物的未来城市',
    seconds: 8, ratio: '9:16', resolution: '1024p', reference_images: []
  });
  assert.strictEqual(submitted.cost, 1200);

  sora.data.refPreviews = ['sora-preview'];
  sora._b64.refImgs = ['data:image/png;base64,c29yYQ=='];
  sora.submitGenerate();
  assert.deepStrictEqual(submitted.body.reference_images, sora._b64.refImgs);

  sora.submitJob = videoPage.submitJob;
  sora._pollToken = 0;
  sora.startPolling = () => {};
  sora.submitJob('/api/gen/sora_video', submitted.body, submitted.cost);
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(requestOptions.header['Idempotency-Key'], /^mp-video-/);

  await api.request('/api/gen/sora_video', {
    method: 'POST', data: {}, idempotencyKey: 'mp-video-sora-test-1234'
  });
  assert.strictEqual(requestOptions.header['Idempotency-Key'], 'mp-video-sora-test-1234');
  console.log('video channel tests passed');
})().catch((error) => { console.error(error); process.exit(1); });
