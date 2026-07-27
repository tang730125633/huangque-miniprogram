const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const videoJs = fs.readFileSync(path.join(root, 'miniprogram/pages/video/video.js'), 'utf8');
const videoWxml = fs.readFileSync(path.join(root, 'miniprogram/pages/video/video.wxml'), 'utf8');
const homeWxml = fs.readFileSync(path.join(root, 'miniprogram/pages/home/home.wxml'), 'utf8');

assert.match(videoJs, /_genPricingHint\(\)/);
assert.match(videoJs, /perSec \+ ' 点\/秒 × ' \+ d\.grokDur \+ ' 秒 = ' \+ total \+ ' 点/);
assert.match(videoJs, /selectGrokModel[\s\S]*?_syncGenPricing\(\)/);
assert.match(videoJs, /selectGrokRes[\s\S]*?_syncGenPricing\(\)/);
assert.match(videoJs, /selectGrokDur[\s\S]*?_syncGenPricing\(\)/);
assert.match(videoJs, /const GROK_DURATIONS = \[5, 8, 10\]/);
assert.match(videoJs, /grokDur > 10[\s\S]*?果肉视频最长支持 10 秒/);
assert.match(videoJs, /grok-imagine-video-1\.5' && this\.data\.refPreviews\.length !== 1/);
assert.match(videoJs, /this\.data\.grokModel === 'grok-imagine-video-1\.5' \? 1 : GEN_MAX_REF/);
assert.match(videoJs, /必选 · 仅 1 张首帧图/);
assert.match(videoJs, /talking: '数字人口播 30 点\/30 秒 .*失败自动退点'/);
assert.doesNotMatch(videoWxml, /mode-price/);
assert.doesNotMatch(videoWxml, />出片方式</);
assert.doesNotMatch(videoWxml, /bindtap="toggleTalkBatch"/);
assert.doesNotMatch(videoWxml, /新建 2 点/);
assert.match(videoJs, /talkBatch: false/);
assert.strictEqual((videoWxml.match(/note \|\| defaultHint/g) || []).length, 4);
assert.match(homeWxml, /10 点\/秒起/);
assert.doesNotMatch(homeWxml, /30 点\/30 秒/);

console.log('pricing display tests passed');
