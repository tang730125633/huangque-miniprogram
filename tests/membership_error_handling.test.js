const assert = require('assert');

global.getApp = function () {
  return { globalData: { apiBase: 'https://example.test' } };
};
global.wx = {
  getStorageSync() { return 'token'; },
  removeStorageSync() {}
};

const api = require('../miniprogram/utils/api.js');
const originalRequest = api.request;
let pageDefinition = null;
global.Page = function (definition) { pageDefinition = definition; };
require('../miniprogram/pages/invite/invite.js');
const invitePageDefinition = pageDefinition;

pageDefinition = null;
require('../miniprogram/pages/video/video.js');
const videoPageDefinition = pageDefinition;

function newVideoPage() {
  return Object.assign({}, videoPageDefinition, {
    data: { busy: false, points: null, cost: 30, note: '' },
    _pollToken: 0,
    setData(patch) { Object.assign(this.data, patch); },
    startPolling() { throw new Error('403 responses must not start polling'); }
  });
}

async function submitVideoWith(response) {
  api.request = function () { return Promise.resolve(response); };
  const page = newVideoPage();
  page.submitJob.call(page, '/api/gen/video', {}, 30);
  await new Promise((resolve) => setImmediate(resolve));
  return page;
}

async function videoMembershipErrorDoesNotShowPasswordMessage() {
  const memberPage = await submitVideoWith({
    statusCode: 403,
    data: { code: 'membership_required', detail: 'membership required' }
  });
  assert.strictEqual(memberPage.data.busy, false);
  assert.strictEqual(memberPage.data.note, '');

  const forbiddenPage = await submitVideoWith({
    statusCode: 403,
    data: { code: 'must_change_password' }
  });
  assert.match(forbiddenPage.data.note, /初始密码/);
}

async function invitePartialFailureDoesNotRenderZeroData() {
  api.request = function (requestPath) {
    if (requestPath.indexOf('/reward-points') >= 0) {
      return Promise.resolve({ statusCode: 500, data: { detail: 'reward ledger unavailable' } });
    }
    if (requestPath.indexOf('/code') >= 0) {
      return Promise.resolve({ statusCode: 200, data: { code: 'ABC123' } });
    }
    return Promise.resolve({ statusCode: 200, data: {} });
  };

  const updates = [];
  const page = Object.assign({}, invitePageDefinition, {
    data: JSON.parse(JSON.stringify(invitePageDefinition.data)),
    setData(patch) {
      updates.push(patch);
      Object.assign(this.data, patch);
    }
  });

  await page.load.call(page);

  assert.strictEqual(page.data.error, 'reward ledger unavailable');
  assert.strictEqual(
    updates.some((patch) => Object.prototype.hasOwnProperty.call(patch, 'rewardTotal')),
    false,
    'failed invite responses must not commit default reward data'
  );
}

invitePartialFailureDoesNotRenderZeroData()
  .then(videoMembershipErrorDoesNotShowPasswordMessage)
  .then(function () {
    api.request = originalRequest;
    console.log('membership error handling tests passed');
  })
  .catch(function (error) {
    api.request = originalRequest;
    console.error(error);
    process.exit(1);
  });
