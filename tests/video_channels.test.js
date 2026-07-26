const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const videoJs = fs.readFileSync(path.join(root, 'miniprogram/pages/video/video.js'), 'utf8');
const videoWxml = fs.readFileSync(path.join(root, 'miniprogram/pages/video/video.wxml'), 'utf8');

assert.match(videoJs, /key: 'micro', name: '黄豆视频'/);
assert.match(videoJs, /key: 'omni', name: '欧米视频'/);
assert.match(videoWxml, /黄豆视频官方标准模型/);
assert.match(videoWxml, /欧米视频官方通道/);
assert.match(videoJs, /health\.seedance_video_enabled === true/);
assert.match(videoJs, /health\.omni_video_enabled === true/);
assert.match(videoJs, /body\.model = cfg\.model/);
assert.match(videoJs, /body\.generate_audio = true/);
assert.match(videoJs, /idempotencyKey: official \? officialVideoRequestKey\(\) : ''/);
assert.match(videoWxml, /bindtap="selectOfficialDuration"/);
assert.match(videoWxml, /bindtap="selectOfficialResolution"/);

let requestOptions;
let videoPage;
global.getApp = () => ({ globalData: { apiBase: 'https://example.test' } });
global.getCurrentPages = () => [];
global.wx = {
  getStorageSync: () => 'token',
  request: (options) => { requestOptions = options; options.success({ statusCode: 200, data: {} }); }
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

  await api.request('/api/gen/xiaole_video', {
    method: 'POST', data: {}, idempotencyKey: 'mp-video-test-1234'
  });
  assert.strictEqual(requestOptions.header['Idempotency-Key'], 'mp-video-test-1234');
  console.log('video channel tests passed');
})().catch((error) => { console.error(error); process.exit(1); });
