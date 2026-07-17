const assert = require('assert');
const templates = require('../miniprogram/utils/prompt_templates.js');

const image = templates.buildImagePrompt('poster', {
  brand: '黄雀 AI', color: '紫粉霓虹', selling: '三秒生成视觉内容', price: '免费体验'
});
assert.strictEqual(image.ratio, '9:16');
assert.ok(image.prompt.includes('黄雀 AI'));
assert.ok(image.prompt.includes('免费体验'));
assert.ok(!image.prompt.includes('{brand}'));

const video = templates.buildVideoPrompt('brand', {
  subject: '一只金色黄雀', scene: '紫粉星云', action: '展开光翼飞行', style: '未来感'
});
assert.strictEqual(video.ratio, '16:9');
assert.ok(video.prompt.includes('一只金色黄雀'));
assert.ok(video.prompt.includes('电影级品牌广告'));
assert.ok(!video.prompt.includes('{subject}'));

const fallback = templates.buildImagePrompt('missing', {});
assert.strictEqual(fallback.ratio, '9:16');
assert.ok(fallback.prompt.includes('未指定'));

console.log('prompt template tests passed');
