const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'miniprogram/pages/video/video.js'), 'utf8');
const home = fs.readFileSync(path.join(root, 'miniprogram/pages/home/home.wxml'), 'utf8');

assert.match(source, /\/api\/auth\/subscription\/status/);
assert.match(source, /event_type === SUBSCRIPTION_EVENT/);
assert.match(source, /\/api\/auth\/subscription\/choices/);
assert.match(source, /wx_code: code/);
assert.match(source, /tmplIds: \[templateId\]/);
for (const choice of ['accept', 'reject', 'ban', 'filter']) {
  assert.match(source, new RegExp("['\\\"]" + choice + "['\\\"]"));
}
assert.match(source, /_requestWorkCompleteSubscription\(\)/);
assert.match(source, /_subscriptionPending/);
assert.match(source, /setTimeout\(finish, 3500\)/);
const submitJob = source.slice(source.indexOf('submitJob(endpoint'), source.indexOf('_submitJobRequest'));
assert.ok(submitJob.indexOf('this.data.points < need') < submitJob.indexOf('this._requestWorkCompleteSubscription()'));
const batch = source.slice(source.indexOf('submitTalkingBatch()'), source.indexOf('startBatchPolling'));
assert.match(batch, /this\._requestWorkCompleteSubscription\(\)/);
assert.doesNotMatch(source, /tmplIds:\s*\[['\"][^'\"]+['\"]\]/);
assert.match(home, /版本 v0\.070/);
console.log('video subscription static checks passed');
