const assert = require('assert');

let definition;
global.Component = (value) => { definition = value; };
let route = 'pages/home/home';
global.getCurrentPages = () => [{ route }];
const switches = [];
const pages = [];
let token = '';
global.wx = {
  getStorageSync: () => token,
  navigateTo: ({ url, complete }) => { pages.push(url); if (complete) complete(); },
  switchTab: ({ url, complete }) => { switches.push(url); if (complete) complete(); }
};

delete require.cache[require.resolve('../miniprogram/custom-tab-bar/index.js')];
const navigation = require('../miniprogram/custom-tab-bar/index.js');

const context = {
  data: Object.assign({}, definition.data),
  setData(patch) { Object.assign(this.data, patch); }
};
Object.assign(context, definition.methods);

context.syncNavigation();
assert.deepStrictEqual(context.data.items.map((item) => item.text), ['首页', '一键跟创', '历史作品', '我的']);
assert.ok(context.data.items.every((item) => item.symbol));
context.switchTab({ currentTarget: { dataset: { path: '/pages/home/home' } } });
assert.deepStrictEqual(switches, []);

context.switchTab({ currentTarget: { dataset: { path: '/pages/assets/assets' } } });
assert.deepStrictEqual(pages, ['/pages/login/login']);
assert.deepStrictEqual(switches, []);

token = 'token';
context.switchTab({ currentTarget: { dataset: { path: '/pages/profile/profile' } } });
assert.deepStrictEqual(switches, ['/pages/profile/profile']);

route = 'pages/my-card/my-card';
context.syncNavigation();
assert.deepStrictEqual(context.data.items.map((item) => item.text), ['首页', '一键跟创', '历史作品', '我的']);
assert.ok(context.data.items.every((item) => item.symbol));
assert.deepStrictEqual(navigation.navigationForRoute('pages/my-card/my-card'), navigation.WORKBENCH_ITEMS);

console.log('nested custom tab bar checks passed');
