const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const videoJs = fs.readFileSync(
  path.join(root, 'miniprogram/pages/video/video.js'),
  'utf8'
);

function assertVideoMembershipErrorPrecedesGenericForbidden() {
  assert.match(
    videoJs,
    /if \(res\.statusCode === 401\)[\s\S]{0,180}if \(api\.isMembershipRequired\(res\)\)[\s\S]{0,600}if \(res\.statusCode === 403\)/,
    'video submission must stop on membership_required before generic 403 handling'
  );
}

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
  const page = Object.assign({}, pageDefinition, {
    data: JSON.parse(JSON.stringify(pageDefinition.data)),
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
  .then(function () {
    assertVideoMembershipErrorPrecedesGenericForbidden();
    api.request = originalRequest;
    console.log('membership error handling tests passed');
  })
  .catch(function (error) {
    api.request = originalRequest;
    console.error(error);
    process.exit(1);
  });
