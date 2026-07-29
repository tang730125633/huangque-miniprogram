const assert = require('assert');
const fs = require('fs');

const app = JSON.parse(fs.readFileSync('miniprogram/app.json', 'utf8'));
const home = fs.readFileSync('miniprogram/pages/home/home.js', 'utf8');
const page = fs.readFileSync('miniprogram/pages/ip12/ip12.js', 'utf8');
const view = fs.readFileSync('miniprogram/pages/ip12/ip12.wxml', 'utf8');

assert.ok(app.pages.includes('pages/ip12/ip12'));
assert.match(home, /path: '\/pages\/ip12\/ip12'/);
assert.match(home, /\/workbench\/ip12\/api\/conversations/);
assert.match(page, /const API = '\/workbench\/ip12\/api'/);
assert.match(page, /api\.loginUrl\('\/pages\/ip12\/ip12'\)/);
assert.match(page, /chat-complete/);
assert.match(page, /foundation-report\/confirm/);
assert.match(page, /downloadProtected\(API \+ '\/foundation-report\//);
assert.match(view, /仅显示当前账号的记录/);
assert.match(view, /确认初稿/);
console.log('IP12 Hermes entry checks passed');
