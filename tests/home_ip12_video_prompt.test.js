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
  const requests = [];
  global.wx.navigateTo = ({ url }) => navigations.push(url);
  api.request = (requestPath, options) => {
    requests.push({ path: requestPath, method: options && options.method });
    return Promise.resolve(response);
  };
  const page = Object.assign({}, pageDefinition, {
    data: Object.assign({}, pageDefinition.data, { membershipReady: true }),
    setData(patch) { Object.assign(this.data, patch); }
  });
  return { page, navigations, requests };
}

function completeProject() {
  const answers = {};
  const ip12 = require('../miniprogram/utils/ip12.js');
  ip12.ACTIVE_MODULES.forEach((module, moduleIndex) => module.steps.forEach((step, stepIndex) => {
    answers[moduleIndex + '-' + stepIndex] = { skipped: true };
  }));
  return { id: 'done', state: { questionnaire_state: { interviewVersion: 2, answers } } };
}

(async () => {
  let test = pageWith({ statusCode: 200, data: { projects: [] } });
  await test.page.onTapPrimaryCreation.call(test.page);
  assert.strictEqual(test.page.data.videoIp12PromptVisible, true);
  assert.deepStrictEqual(test.navigations, []);
  assert.deepStrictEqual(test.requests, [{ path: '/api/gen/digital-ip/projects', method: 'GET' }]);

  test.page.skipVideoIp12Prompt.call(test.page);
  assert.strictEqual(test.page.data.videoIp12PromptVisible, false);
  test.page.createIp12BeforeVideo.call(test.page);
  assert.deepStrictEqual(test.navigations, ['/pages/ip12/ip12']);

  test = pageWith({ statusCode: 200, data: { projects: [{ id: 'draft', state: { questionnaire_state: {} } }] } });
  await test.page.onTapPrimaryCreation.call(test.page);
  assert.strictEqual(test.page.data.videoIp12PromptVisible, true);
  test.page.continueToVideo.call(test.page);
  assert.deepStrictEqual(test.navigations, ['/pages/video/video?mode=generate']);

  test = pageWith({ statusCode: 200, data: { projects: [completeProject()] } });
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
  test = pageWith({ statusCode: 200, data: { projects: [completeProject()] } });
  api.request = () => new Promise((resolve) => { finishRequest = resolve; });
  const pending = test.page.onTapPrimaryCreation.call(test.page);
  test.page.onHide.call(test.page);
  finishRequest({ statusCode: 200, data: { projects: [completeProject()] } });
  await pending;
  assert.deepStrictEqual(test.navigations, []);
  assert.strictEqual(test.page.data.videoIp12PromptVisible, false);
  console.log('home IP12 video prompt tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
