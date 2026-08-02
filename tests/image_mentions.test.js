const assert = require('assert');
const mentions = require('../miniprogram/utils/image_mentions.js');

assert.deepStrictEqual(mentions.indexes('让@图片1站左边，@图2站右边'), [1, 2]);
assert.strictEqual(mentions.validate('参考 @图片2', 2), '');
assert.match(mentions.validate('参考 @图片3', 2), /当前只有 2 张/);
assert.match(mentions.validate('参考 @图0', 2), /编号从 1 开始/);
assert.strictEqual(mentions.usesShiftedIndex('保留 @图片1，调整 @图3', 2), true);
assert.strictEqual(mentions.usesShiftedIndex('只用 @图片1', 2), false);
assert.strictEqual(mentions.append('主体在左边', 2), '主体在左边 @图片2');

console.log('image mention tests passed');
