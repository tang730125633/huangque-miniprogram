const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const videoJs = fs.readFileSync(path.join(root, 'miniprogram/pages/video/video.js'), 'utf8');
const videoWxml = fs.readFileSync(path.join(root, 'miniprogram/pages/video/video.wxml'), 'utf8');

assert.match(videoJs, /const GROK_DURATIONS_STANDARD = \[5, 8, 10\]/);
assert.match(videoJs, /const GROK_DURATIONS_15 = \[5, 8, 10, 12, 15\]/);
assert.match(videoJs, /!is15 && this\.data\.grokDur > 10/);
assert.match(videoJs, /is15 && this\.data\.refPreviews\.length !== 1/);
assert.match(videoJs, /if \(!is15\) body\.ratio = this\.data\.ratio/);
assert.match(videoJs, /maxRef = this\.data\.grokModel === 'grok-imagine-video-1\.5' \? 1 : GEN_MAX_REF/);
assert.match(videoWxml, /标准 1\.0 最长 10 秒，高清 1\.5 最长 15 秒/);
assert.match(videoWxml, /必选 · 仅 1 张首帧图/);
assert.match(videoWxml, /grokModel==='grok-imagine-video-1\.5' \? 1 : 7/);
assert.match(videoWxml, /grokModel==='grok-imagine-video-1\.5'\)\}\}" class="card"/);

console.log('Grok video parameter tests passed');
