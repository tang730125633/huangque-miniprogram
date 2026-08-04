const assert = require('assert');
const test = require('node:test');

global.wx = { pageScrollTo() {} };
let inspirationPage;
global.Page = function (definition) { inspirationPage = definition; };

const inspiration = require('../miniprogram/pages/inspiration/inspiration.js');
global.Page = function () {};
const video = require('../miniprogram/pages/video/video.js');
const api = require('../miniprogram/utils/api.js');

test('managed video cases keep their cover, channel and follow-create destination', () => {
  const item = inspiration.normalizeCase({
    id: 1000001,
    type: 'video',
    image: 'https://cdn.example.com/cover.webp',
    video: 'https://cdn.example.com/demo.mp4',
    target: 'micro',
    title: '门店宣传片',
    category: '视频案例',
    prompt: '镜头缓慢推进门店并展示服务细节'
  }, true);

  assert.strictEqual(item.type, 'video');
  assert.strictEqual(item.engineKey, 'micro');
  assert.strictEqual(item.engineLabel, '黄豆视频');
  assert.strictEqual(item.video, 'https://cdn.example.com/demo.mp4');
  assert.deepStrictEqual(inspiration.followTarget(item), {
    storageKey: 'hq_followcreate_video',
    storageValue: {
      prompt: '镜头缓慢推进门店并展示服务细节',
      engine: 'micro',
      inspirationId: 1000001
    },
    url: '/pages/video/video?mode=generate'
  });
});

test('managed cases are shown before bundled fallback cases', () => {
  const items = inspiration.mergeCases(
    [{ id: 1, image: '../assets/local.webp', model: 'pro', title: '本地案例' }],
    [{ id: 1000002, image: 'https://cdn.example.com/live.webp', model: 'gpt', title: '后台案例' }]
  );
  assert.deepStrictEqual(items.map((item) => item.id), [1000002, 1]);
  assert.strictEqual(items[0].managed, true);
  assert.strictEqual(items[1].managed, false);
});

test('case page refreshes managed cases from the public backend endpoint', async () => {
  const originalRequest = api.request;
  let request;
  api.request = (path, options) => {
    request = { path, options };
    return Promise.resolve({
      statusCode: 200,
      data: { items: [{ id: 1000003, image: 'https://cdn.example.com/case.webp', model: 'gpt', title: '实时案例' }] }
    });
  };
  const context = Object.assign({}, inspirationPage, {
    data: Object.assign({}, inspirationPage.data, { category: '全部' }),
    setData(patch, callback) {
      Object.assign(this.data, patch);
      if (callback) callback();
    }
  });
  try {
    await inspirationPage._loadManagedCases.call(context);
    assert.deepStrictEqual(request, {
      path: '/api/admin/public/inspirations',
      options: { method: 'GET', auth: false }
    });
    assert.strictEqual(context._all[0].id, 1000003);
    assert.strictEqual(context.data.leftList.concat(context.data.rightList).some((item) => item.id === 1000003), true);
  } finally {
    api.request = originalRequest;
  }
});

test('video page accepts the managed channel and source case id', () => {
  assert.deepStrictEqual(video.normalizeFollowCreateVideo({
    prompt: '镜头缓慢推进', engine: 'omni', inspirationId: 1000009
  }), {
    prompt: '镜头缓慢推进', engine: 'omni', inspirationId: 1000009
  });
  assert.deepStrictEqual(video.normalizeFollowCreateVideo({
    prompt: '默认渠道', engine: 'unknown', inspirationId: 9
  }), {
    prompt: '默认渠道', engine: 'grok', inspirationId: 0
  });
});

test('tapping a video cover opens the native video preview', () => {
  let preview;
  global.wx.previewMedia = (options) => { preview = options; };
  const item = inspiration.normalizeCase({
    id: 1000010,
    type: 'video',
    image: 'https://cdn.example.com/poster.webp',
    video: 'https://cdn.example.com/video.mp4',
    target: 'grok'
  }, true);
  inspirationPage.previewMedia.call({
    _all: [item],
    data: { leftList: [], rightList: [] },
    _track() {}
  }, { currentTarget: { dataset: { id: 1000010 } } });
  assert.deepStrictEqual(preview, {
    sources: [{
      url: 'https://cdn.example.com/video.mp4',
      type: 'video',
      poster: 'https://cdn.example.com/poster.webp'
    }],
    current: 0
  });
});
