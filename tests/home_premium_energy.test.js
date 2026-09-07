const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../miniprogram');
const wxml = fs.readFileSync(path.join(root, 'pages/home/home.wxml'), 'utf8');
const wxss = fs.readFileSync(path.join(root, 'app.wxss'), 'utf8');
assert.match(wxml, /把一个想法，/);
assert.match(wxss, /--bg: #f6f4ef/);
assert.match(wxss, /background-image: radial-gradient/);
assert.doesNotMatch(wxss, /data:image\/svg\+xml;base64/);
assert.doesNotMatch(wxml, /assets\/home\/|cosmic-rift|NEW · 暖纸创作/);
for (const handler of ['openPaper', 'onTapPrimaryCreation', 'onTapImageCreation', 'onTapVideoAnalysis', 'onTapDigitalHuman', 'onTapRoleTransfer', 'onTapTutorial']) {
  assert.ok(wxml.includes('bindtap="' + handler + '"'), handler + ' must remain reachable');
}
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json')));
assert.equal(app.pages.length, 19);
assert.equal(app.window.navigationBarTextStyle, 'black');
assert.equal(app.tabBar.backgroundColor, '#fbfaf7');
const oldTheme = /#(?:0b0912|050509|e24ba0|8b45e0|e94ea8|f229a6|d83bcc|7b46ff|5f46b8)\b|rgba\(226,\s*75,\s*160/i;
for (const route of app.pages) {
  const style = fs.readFileSync(path.join(root, route + '.wxss'), 'utf8');
  assert.doesNotMatch(style, oldTheme, route + ' still contains legacy colors');
  const config = JSON.parse(fs.readFileSync(path.join(root, route + '.json')));
  assert.notEqual(config.navigationBarTextStyle, 'white', route + ' navigation ink must be readable');
}
console.log('all 19 main routes share the warm-paper theme and retain creation entries');
