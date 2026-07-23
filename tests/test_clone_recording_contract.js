const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'miniprogram', 'pages', 'clone', 'clone.js'),
  'utf8'
);

assert(source.includes('this.data.recSec < 10'));
assert(source.includes('请录制至少 10 秒'));
assert(source.includes('recProgress: Math.min(100'));
assert(source.includes('this.data.recording || !this.data.hasSample'));
assert(source.includes("slot.status === 'ready' || slot.preview_url"));
assert(source.includes("d.status === 'ready' || previewUrl"));
assert(source.includes("api.request('/api/gen/audio/buy-slot'"));
assert(source.includes('slotCount < slotMax'));
assert(source.includes('selectSlotByIndex'));
assert(source.includes('wx.showModal'));

console.log('clone recording contract OK');
