const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const service = fs.readFileSync(path.join(root, 'miniprogram/paper/services/work-subscription.js'), 'utf8');
const screen = fs.readFileSync(path.join(root, 'miniprogram/paper/components/screen/index.js'), 'utf8');
const view = fs.readFileSync(path.join(root, 'miniprogram/paper/components/screen/index.wxml'), 'utf8');

assert.match(service, /\/api\/auth\/subscription\/status/);
assert.match(service, /wx\.requestSubscribeMessage/);
assert.match(service, /\/api\/auth\/subscription\/choices/);
assert.doesNotMatch(service, /tmplIds:\s*\[['"][^'"]+['"]\]/);
assert.match(screen, /draft\.kind==='video'.*requestWorkSubscription\(false\)/);
assert.match(view, /完成后微信提醒我/);
assert.match(view, /一次授权对应一条完成消息/);
console.log('paper work subscription checks passed');
