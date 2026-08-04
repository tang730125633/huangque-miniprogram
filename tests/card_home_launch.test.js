const assert = require('assert');

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
homeDefinition.onLoad.call({});
assert.deepStrictEqual(launches, ['/pages/my-card/my-card']);
assert.strictEqual(app.globalData.redirectLegacyHomeLaunch, false);

homeDefinition.onLoad.call({});
assert.deepStrictEqual(launches, ['/pages/my-card/my-card']);

app.onLaunch.call(app, { path: 'pages/my-card/my-card', query: {} });
homeDefinition.onLoad.call({});
assert.deepStrictEqual(launches, ['/pages/my-card/my-card']);

console.log('card home launch checks passed');
