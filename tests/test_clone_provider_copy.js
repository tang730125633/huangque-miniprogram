const assert = require('assert');
const fs = require('fs');
const path = require('path');

const page = fs.readFileSync(
  path.join(__dirname, '..', 'miniprogram', 'pages', 'clone', 'clone.wxml'),
  'utf8'
);

assert(page.includes('AI 正在学习音色特征'));
assert(!page.includes('MegaTTS'));
assert(!page.includes('豆包'));
assert(page.includes('录制样音'));
assert(page.includes('AI 复刻'));
assert(page.includes('开始使用'));
assert(page.includes('建议朗读'));
assert(page.includes('我的音色'));
assert(page.includes('已拥有 {{slotCount}} 个'));
assert(page.includes('购买槽位'));
assert(page.includes('{{slotCost}} 点/个'));

console.log('clone provider copy OK');
