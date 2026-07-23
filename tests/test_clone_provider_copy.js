const assert = require('assert');
const fs = require('fs');
const path = require('path');

const page = fs.readFileSync(
  path.join(__dirname, '..', 'miniprogram', 'pages', 'clone', 'clone.wxml'),
  'utf8'
);

assert(page.includes('AI 音色复刻中'));
assert(!page.includes('MegaTTS'));
assert(!page.includes('豆包'));

console.log('clone provider copy OK');
