const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const assetsJs = fs.readFileSync(path.join(root, 'miniprogram/pages/assets/assets.js'), 'utf8');
const assetsWxml = fs.readFileSync(path.join(root, 'miniprogram/pages/assets/assets.wxml'), 'utf8');

assert.match(assetsWxml, /catchtap="saveImage"/);
assert.match(assetsWxml, /catchtap="saveVideo"/);
assert.match(assetsWxml, /assets\/icons\/download\.svg/);
assert.match(assetsJs, /saveImageToPhotosAlbum/);
assert.match(assetsJs, /saveVideoToPhotosAlbum/);
assert.match(assetsJs, /api\.downloadProtected\(url\)/);
assert.match(assetsJs, /wx\.openSetting\(\)/);

console.log('History asset download tests passed');
