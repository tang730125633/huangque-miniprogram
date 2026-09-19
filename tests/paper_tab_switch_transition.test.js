const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 1. Static checks on WXML and WXSS
const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/paper/components/screen/index.wxml'), 'utf8');
const wxss = fs.readFileSync(path.join(__dirname, '../miniprogram/paper/components/screen/index.wxss'), 'utf8');

// Ensure all 3 tabs are wrapped in .tab-pane
assert.match(wxml, /<block wx:if="{{pageId==='home'}}">\s*<view class="hq-view tab-pane">/, 'Home tab must be wrapped in tab-pane');
assert.match(wxml, /<block wx:elif="{{pageId==='works'\|\|pageId==='card-works'}}">\s*<view class="hq-view tab-pane">/, 'Works tab must be wrapped in tab-pane');
assert.match(wxml, /<block wx:elif="{{pageId==='profile'}}">\s*<view class="hq-view tab-pane">/, 'Profile tab must be wrapped in tab-pane');

// Ensure CSS has Apple-grade fluid animation and hardware acceleration
assert.match(wxss, /\.tab-pane\s*\{[^}]*animation:\s*appleTabFadeIn\s+0\.2s\s+cubic-bezier/, 'tab-pane must use Apple fluid cubic-bezier animation');
assert.match(wxss, /\.tab-pane\s*\{[^}]*will-change:\s*opacity,\s*transform/, 'tab-pane must use GPU hardware acceleration');
assert.match(wxss, /@keyframes appleTabFadeIn/, 'appleTabFadeIn keyframes must be defined');

// 2. Behavioral checks on Component switchTab
let componentDefinition;
global.Component = def => { componentDefinition = def; };
global.getCurrentPages = () => [];
global.getApp = () => ({ globalData: { apiBase: 'https://huangquechuanmei.com' } });

const scrollCalls = [];
global.wx = {
  pageScrollTo: options => {
    scrollCalls.push(options);
  },
  getStorageSync: () => '',
  setStorageSync: () => {},
  removeStorageSync: () => {},
  request: () => {},
  navigateTo: () => {},
  redirectTo: () => {}
};

delete require.cache[require.resolve('../miniprogram/paper/components/screen/index.js')];
require('../miniprogram/paper/components/screen/index.js');

(async () => {
  const setDataHistory = [];
  const instance = {
    alive: true,
    data: {
      pageId: 'home',
      search: '',
      filter: 'all',
      works: [
        { key: 'job-1', id: 1, title: '测试视频 1', kind: 'video', done: true, failed: false },
        { key: 'job-2', id: 2, title: '测试图片 2', kind: 'image', done: true, failed: false }
      ],
      visibleWorks: []
    },
    properties: {
      pageId: 'home'
    },
    setData(patch) {
      setDataHistory.push(structuredClone(patch));
      Object.assign(this.data, patch);
    },
    loadWorks() {},
    loadAgent() {},
    toast() {}
  };

  // Bind methods
  for (const [key, method] of Object.entries(componentDefinition.methods)) {
    if (typeof method === 'function') instance[key] = method.bind(instance);
  }

  // A. Switching from 'home' to 'works'
  scrollCalls.length = 0;
  setDataHistory.length = 0;
  instance.switchTab('works');

  // Must reset scroll position to 0 with 0ms duration
  assert.equal(scrollCalls.length, 1);
  assert.deepEqual(scrollCalls[0], { scrollTop: 0, duration: 0 });

  // First setData MUST batch pageId and visibleWorks together (eliminating empty-state flash)
  assert.equal(setDataHistory.length, 1);
  assert.equal(setDataHistory[0].pageId, 'works');
  assert.equal(setDataHistory[0].visibleWorks.length, 2, 'visibleWorks must be populated in initial setData');
  assert.equal(setDataHistory[0].visibleWorks[0].title, '测试视频 1');

  // B. Switching from 'works' back to 'home'
  scrollCalls.length = 0;
  setDataHistory.length = 0;
  instance.switchTab('home');

  // Must reset scroll position to 0 to eliminate the blank void
  assert.equal(scrollCalls.length, 1);
  assert.deepEqual(scrollCalls[0], { scrollTop: 0, duration: 0 });
  assert.equal(setDataHistory[0].pageId, 'home');

  // C. Clicking the active tab ('home') again
  scrollCalls.length = 0;
  instance.switchTab('home');

  // Must smoothly scroll to top (duration 300)
  assert.equal(scrollCalls.length, 1);
  assert.deepEqual(scrollCalls[0], { scrollTop: 0, duration: 300 });

  console.log('paper tab switch and scroll reset tests passed');
})();
