const assert = require('assert');
const fs = require('fs');
const path = require('path');

let appDefinition;
global.App = (definition) => { appDefinition = definition; };
require('../miniprogram/app.js');

const app = Object.assign({}, appDefinition, {
  globalData: Object.assign({}, appDefinition.globalData)
});
global.getApp = () => app;

const launches = [];
global.wx = {
  getStorageSync() { return ''; },
  reLaunch(options) { launches.push(options.url); }
};

let homeDefinition;
global.Page = (definition) => { homeDefinition = definition; };
require('../miniprogram/pages/home/home.js');

app.onLaunch.call(app, { path: 'pages/home/home', query: {} });
if (homeDefinition.onLoad) homeDefinition.onLoad.call({});
assert.deepStrictEqual(launches, ['/paper/pages/home/index']);
assert.strictEqual(Object.prototype.hasOwnProperty.call(app.globalData, 'redirectLegacyHomeLaunch'), false);

app.onLaunch.call(app, { path: 'pages/my-card/my-card', query: {} });

const appJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../miniprogram/app.json'), 'utf8'));
const homeWxml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/home/home.wxml'), 'utf8');
assert.match(homeWxml, /v0\.079\.paper5/);
assert.strictEqual(appJson.pages[0], 'pages/home/home');
assert.deepStrictEqual(appJson.tabBar.list.map((item) => item.pagePath), [
  'pages/home/home',
  'pages/assets/assets',
  'pages/profile/profile'
]);

console.log('card home launch checks passed');
