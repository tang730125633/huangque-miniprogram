const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const storage = {};
const navigations = [];

global.getApp = () => ({ globalData: { apiBase: 'https://huangquechuanmei.com' } });
global.wx = {
  getStorageSync(key) { return storage[key]; },
  navigateTo({ url }) { navigations.push(url); },
  showToast() {}
};

let pageDefinition;
global.Page = (definition) => { pageDefinition = definition; };
require('../miniprogram/pages/home/home.js');

function pageContext() {
  return Object.assign({}, pageDefinition, {
    data: Object.assign({}, pageDefinition.data, {
      membershipReady: true,
      membershipEnforced: false,
      accountStateError: false
    }),
    setData(patch) { Object.assign(this.data, patch); }
  });
}

test('home carousel includes the My Card slide as a paper card without changing its navigation', () => {
  const banner = pageDefinition.data.banners[2];
  assert.deepStrictEqual(banner, {
    id: 'business-card',
    title: '我的名片',
    sub: '创建、展示并分享你的个人名片',
    symbol: '名',
    path: '/pages/my-card/my-card'
  });

  const wxml = fs.readFileSync(path.join(root, 'miniprogram/pages/home/home.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(root, 'miniprogram/pages/home/home.wxss'), 'utf8');
  assert.match(wxml, /<swiper[\s\S]*wx:for="\{\{banners\}\}"/);
  assert.match(wxml, /class="banner-art"/);
  assert.match(wxss, /\.rt-swiper-wrap\s*\{[^}]*height:\s*220rpx;/);
  assert.match(wxss, /\.rt-swiper\s*\{[^}]*height:\s*220rpx;/);
  assert.doesNotMatch(wxml, /business-card-banner\.jpg/);
});

test('My Card banner opens the card page for a logged-in account', () => {
  storage.hq_token = 'account-token';
  navigations.length = 0;
  const page = pageContext();

  page.onTapRoleTransfer.call(page, {
    currentTarget: { dataset: { path: '/pages/my-card/my-card' } }
  });

  assert.deepStrictEqual(navigations, ['/pages/my-card/my-card']);
});

test('My Card banner does not require an active membership', () => {
  storage.hq_token = 'account-token';
  navigations.length = 0;
  const page = pageContext();
  page.data.membershipEnforced = true;
  page.data.membershipActive = false;

  page.onTapRoleTransfer.call(page, {
    currentTarget: { dataset: { path: '/pages/my-card/my-card' } }
  });

  assert.deepStrictEqual(navigations, ['/pages/my-card/my-card']);
});

test('My Card banner sends a logged-out account through login and returns to the card page', () => {
  delete storage.hq_token;
  navigations.length = 0;
  const page = pageContext();

  page.onTapRoleTransfer.call(page, {
    currentTarget: { dataset: { path: '/pages/my-card/my-card' } }
  });

  assert.deepStrictEqual(navigations, ['/pages/login/login?redirect=my-card']);
});
