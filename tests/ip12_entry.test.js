const assert = require('assert');
const fs = require('fs');

const app = JSON.parse(fs.readFileSync('miniprogram/app.json', 'utf8'));
const home = fs.readFileSync('miniprogram/pages/home/home.js', 'utf8');
const homeView = fs.readFileSync('miniprogram/pages/home/home.wxml', 'utf8');
const video = fs.readFileSync('miniprogram/pages/video/video.js', 'utf8');
const ip12Page = fs.readFileSync('miniprogram/pages/ip12/ip12.js', 'utf8');

assert.ok(app.pages.includes('pages/ip12/ip12'));
assert.match(home, /path: '\/pages\/ip12\/ip12'/);
assert.match(home, /onTapDigitalHuman\(\) \{ this\._guardNav\('\/pages\/ip12\/ip12'\); \}/);
assert.match(home, /item\.path === '\/pages\/ip12\/ip12'.*this\._guardNav\(item\.path\)/);
assert.match(home, /wx\.navigateTo\(\{ url: api\.loginUrl\(path\) \}\)/);
assert.match(home, /membershipReady/);
assert.match(homeView, /版本 v0\.047/);
assert.match(video, /name: '数字人口播'/);
assert.match(ip12Page, /type: 'all'/);
assert.match(ip12Page, /timeout: 150000/);
assert.match(ip12Page, /patchQuestionnaire\(questionnaire\)/);
assert.match(ip12Page, /api\.request\('\/api\/auth\/me'/);
assert.match(ip12Page, /api\.showMembershipRequired/);
assert.match(ip12Page, /wx\.reLaunch\(\{ url: api\.loginUrl\('\/pages\/ip12\/ip12'\) \}\)/);
console.log('ip12 entry checks passed');
