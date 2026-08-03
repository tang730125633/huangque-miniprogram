const assert = require('assert');
const fs = require('fs');
const path = require('path');

let pageDefinition;
global.Page = (definition) => { pageDefinition = definition; };
global.wx = {};

const api = require('../miniprogram/utils/api.js');
api.getToken = () => 'token';
api.loginUrl = (url) => '/pages/login/login?redirect=' + encodeURIComponent(url);

require('../miniprogram/pages/home/home.js');

const view = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/home/home.wxml'), 'utf8');
assert.match(view, /wx:if="\{\{videoIp12PromptVisible\}\}"/);
assert.match(view, /bindtap="skipVideoIp12Prompt"[^>]*>跳过</);
assert.match(view, /bindtap="createIp12BeforeVideo"[^>]*>去创建档案</);
assert.match(view, /bindtap="continueToVideo"[^>]*>继续创作</);

function pageWith(response) {
  const navigations = [];
  const tabNavigations = [];
  const requests = [];
  global.wx.navigateTo = ({ url }) => navigations.push(url);
  global.wx.switchTab = ({ url }) => tabNavigations.push(url);
  global.wx.showToast = () => {};
  api.request = (requestPath, options) => {
    requests.push({ path: requestPath, method: options && options.method });
    return Promise.resolve(response);
  };
  const page = Object.assign({}, pageDefinition, {
    data: Object.assign({}, pageDefinition.data, { membershipReady: true, cardReady: true }),
    setData(patch) { Object.assign(this.data, patch); }
  });
  return { page, navigations, tabNavigations, requests };
}

function completeProject() { return { id: 'done', coach_state: { completed_modules: [1, 2, 3, 4, 5, 6] } }; }

(async () => {
  let test = pageWith({ statusCode: 200, data: [] });
  await test.page.onTapPrimaryCreation.call(test.page);
  assert.strictEqual(test.page.data.videoIp12PromptVisible, true);
  assert.deepStrictEqual(test.navigations, []);
  assert.deepStrictEqual(test.requests, [{ path: '/workbench/ip12/api/conversations', method: 'GET' }]);

  test = pageWith({ statusCode: 200, data: [] });
  test.page.data.cardReady = false;
  await test.page.onTapPrimaryCreation.call(test.page);
  assert.deepStrictEqual(test.navigations, ['/pages/my-card/my-card']);
  assert.deepStrictEqual(test.requests, []);

  test.page.skipVideoIp12Prompt.call(test.page);
  assert.strictEqual(test.page.data.videoIp12PromptVisible, false);
  test.page.createIp12BeforeVideo.call(test.page);
  assert.deepStrictEqual(test.navigations, ['/pages/my-card/my-card', '/pages/ip12/ip12']);

  test = pageWith({ statusCode: 200, data: [{ id: 'draft', coach_state: { completed_modules: [] } }] });
  await test.page.onTapPrimaryCreation.call(test.page);
  assert.strictEqual(test.page.data.videoIp12PromptVisible, true);
  test.page.continueToVideo.call(test.page);
  assert.deepStrictEqual(test.navigations, ['/pages/video/video?mode=generate']);

  test = pageWith({ statusCode: 200, data: [completeProject()] });
  await test.page.onTapPrimaryCreation.call(test.page);
  assert.strictEqual(test.page.data.videoIp12PromptVisible, false);
  assert.deepStrictEqual(test.navigations, ['/pages/video/video?mode=generate']);

  test = pageWith({ statusCode: 503, data: {} });
  await test.page.onTapPrimaryCreation.call(test.page);
  assert.deepStrictEqual(test.navigations, ['/pages/video/video?mode=generate']);

  test = pageWith({ statusCode: 401, data: {} });
  await test.page.onTapPrimaryCreation.call(test.page);
  assert.deepStrictEqual(test.navigations, []);
  assert.strictEqual(test.page.data.videoIp12PromptVisible, false);

  let finishRequest;
  test = pageWith({ statusCode: 200, data: [completeProject()] });
  api.request = () => new Promise((resolve) => { finishRequest = resolve; });
  const pending = test.page.onTapPrimaryCreation.call(test.page);
  test.page.onHide.call(test.page);
  finishRequest({ statusCode: 200, data: [completeProject()] });
  await pending;
  assert.deepStrictEqual(test.navigations, []);
  assert.strictEqual(test.page.data.videoIp12PromptVisible, false);
  console.log('home IP12 video prompt tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
