const assert = require('assert');

let definition;
global.Component = (value) => { definition = value; };
let route = 'pages/my-card/my-card';
global.getCurrentPages = () => [{ route }];
const switches = [];
const pages = [];
let token = '';
global.wx = {
  getStorageSync: () => token,
  navigateTo: ({ url }) => pages.push(url),
  switchTab: ({ url }) => switches.push(url)
};

delete require.cache[require.resolve('../miniprogram/custom-tab-bar/index.js')];
require('../miniprogram/custom-tab-bar/index.js');

const context = {
  data: Object.assign({}, definition.data),
  setData(patch) { Object.assign(this.data, patch); }
};
Object.assign(context, definition.methods);

context.syncNavigation();
assert.deepStrictEqual(context.data.items.map((item) => item.text), ['我的名片', '黄雀AI工作台']);
context.switchTab({ currentTarget: { dataset: { path: '/pages/home/home' } } });
assert.deepStrictEqual(switches, ['/pages/home/home']);

context.switchTab({ currentTarget: { dataset: { path: '/pages/assets/assets' } } });
assert.deepStrictEqual(pages, ['/pages/login/login']);
assert.deepStrictEqual(switches, ['/pages/home/home']);

token = 'token';
context.switchTab({ currentTarget: { dataset: { path: '/pages/profile/profile' } } });
assert.deepStrictEqual(switches, ['/pages/home/home', '/pages/profile/profile']);

route = 'pages/home/home';
context.syncNavigation();
assert.deepStrictEqual(context.data.items.map((item) => item.text), ['首页', '一键跟创', '历史作品', '我的']);
context.switchTab({ currentTarget: { dataset: { path: '/pages/home/home' } } });
assert.deepStrictEqual(switches, ['/pages/home/home', '/pages/profile/profile']);

console.log('nested custom tab bar checks passed');
