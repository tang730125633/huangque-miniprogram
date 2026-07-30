const assert = require('assert');
const fs = require('fs');
const path = require('path');

let pageDefinition = null;
let responseItems = [];
let previewedImages = null;
let previewedMedia = null;
let copiedText = '';
const toastTitles = [];

global.getApp = () => ({ globalData: { apiBase: 'https://example.test' } });
global.getCurrentPages = () => [];
global.Page = (definition) => { pageDefinition = definition; };
global.wx = {
  previewImage: (options) => { previewedImages = options; },
  previewMedia: (options) => { previewedMedia = options; },
  setClipboardData: (options) => {
    copiedText = options.data;
    if (options.success) options.success();
  },
  showToast: (options) => { toastTitles.push(options.title); },
  showLoading() {},
  hideLoading() {}
};

const api = require('../miniprogram/utils/api.js');
api.request = () => Promise.resolve({ statusCode: 200, data: { items: responseItems } });
api.absUrl = (url) => url && url.charAt(0) === '/' ? 'https://example.test' + url : url;
api.downloadProtected = (url) => Promise.resolve('local:' + url);

require('../miniprogram/pages/assets/assets.js');

function page(tab) {
  return Object.assign({}, pageDefinition, {
    data: Object.assign({}, JSON.parse(JSON.stringify(pageDefinition.data)), { tab: tab || 'image' }),
    setData(patch, callback) {
      Object.assign(this.data, patch);
      if (callback) callback();
    }
  });
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

const view = fs.readFileSync(
  path.join(__dirname, '../miniprogram/pages/assets/assets.wxml'),
  'utf8'
);
assert.match(view, /无提示词记录/);
assert.match(view, /查看提示词/);
assert.match(view, /scroll-y/);
assert.match(view, /catchtap="copyPrompt"/);

(async function () {
  responseItems = [
    {
      job_id: 11,
      url: '/api/gen/file/first.png',
      prompt: '  图片完整提示词\n第二行  ',
      provider: 'internal-provider',
      payload: '{"prompt":"不能从原始负载读取"}'
    },
    { job_id: 12, url: 'https://cdn.test/second.png', text: '旧记录提示词' },
    {
      job_id: 13,
      url: 'https://cdn.test/third.png',
      provider_key_id: 'private-key-id',
      payload: '{"prompt":"不可展示"}'
    }
  ];
  const imagePage = page('image');
  imagePage.load();
  await flush();
  await flush();

  assert.strictEqual(imagePage.data.images.length, 3);
  assert.strictEqual(imagePage.data.images[0].url, 'local:https://example.test/api/gen/file/first.png');
  assert.strictEqual(imagePage.data.images[0].prompt, '图片完整提示词\n第二行');
  assert.strictEqual(imagePage.data.images[0].hasPrompt, true);
  assert.strictEqual(imagePage.data.images[1].prompt, '旧记录提示词');
  assert.strictEqual(imagePage.data.images[2].prompt, '');
  assert.strictEqual(imagePage.data.images[2].hasPrompt, false);
  const normalizedImages = JSON.stringify(imagePage.data.images);
  assert.strictEqual(normalizedImages.includes('internal-provider'), false);
  assert.strictEqual(normalizedImages.includes('payload'), false);
  assert.strictEqual(normalizedImages.includes('private-key-id'), false);

  imagePage.previewImage({ currentTarget: { dataset: { u: imagePage.data.images[1].url } } });
  assert.deepStrictEqual(previewedImages, {
    current: 'https://cdn.test/second.png',
    urls: [
      'local:https://example.test/api/gen/file/first.png',
      'https://cdn.test/second.png',
      'https://cdn.test/third.png'
    ]
  });

  imagePage.showPrompt({ currentTarget: { dataset: { kind: 'image', i: 0 } } });
  assert.strictEqual(imagePage.data.promptOpen, true);
  assert.strictEqual(imagePage.data.activePrompt, '图片完整提示词\n第二行');
  imagePage.copyPrompt();
  assert.strictEqual(copiedText, '图片完整提示词\n第二行');
  imagePage.closePrompt();
  assert.strictEqual(imagePage.data.promptOpen, false);
  assert.strictEqual(imagePage.data.activePrompt, '');

  imagePage.showPrompt({ currentTarget: { dataset: { kind: 'image', i: 2 } } });
  assert.strictEqual(imagePage.data.promptOpen, false);
  assert.ok(toastTitles.includes('该作品没有提示词记录'));

  responseItems = [
    {
      video_url: 'https://cdn.test/first.mp4',
      image_url: 'https://cdn.test/first.jpg',
      text: '视频创作提示词',
      provider: 'internal-video-provider',
      payload: '{"api_key":"不可展示"}'
    },
    { video_url: 'https://cdn.test/second.mp4' }
  ];
  const videoPage = page('video');
  videoPage.load();
  await flush();

  assert.strictEqual(videoPage.data.videos[0].prompt, '视频创作提示词');
  assert.strictEqual(videoPage.data.videos[0].hasPrompt, true);
  assert.strictEqual(videoPage.data.videos[1].prompt, '');
  assert.strictEqual(videoPage.data.videos[1].hasPrompt, false);
  const normalizedVideos = JSON.stringify(videoPage.data.videos);
  assert.strictEqual(normalizedVideos.includes('internal-video-provider'), false);
  assert.strictEqual(normalizedVideos.includes('payload'), false);
  assert.strictEqual(normalizedVideos.includes('api_key'), false);

  videoPage.showPrompt({ currentTarget: { dataset: { kind: 'video', i: 0 } } });
  assert.strictEqual(videoPage.data.activePromptTitle, '视频提示词');
  assert.strictEqual(videoPage.data.activePrompt, '视频创作提示词');
  videoPage.playVideo({ currentTarget: { dataset: { u: videoPage.data.videos[0].url } } });
  assert.deepStrictEqual(previewedMedia, {
    sources: [{ url: 'https://cdn.test/first.mp4', type: 'video' }]
  });

  console.log('History prompt normalization and interaction tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
