const api = require('../../utils/api.js');
const cardUtil = require('../../utils/card.js');
const RAW = require('./inspirations-data.js');

const IMG_BASE = 'https://huangquechuanmei.com/';
const PAGE_SIZE = 12;
const CARD_HEIGHTS = [360, 440, 520]; // rpx 三档稳定高度
const ENGINE_LABEL = {
  pro: '专业生图', gpt: 'GPT 生图', nb2: '灵感生图', zelong2: '泽龙生图',
  grok: '果肉视频', micro: '黄豆视频', omni: '欧米视频'
};
const BANANA_ENGINES = ['nb2', 'pro', 'gpt', 'xiaole', 'zelong2'];
const VIDEO_ENGINES = ['grok', 'micro', 'omni'];
const CATEGORY_ORDER = ['美妆产品', '护肤精华', '门店拓客', '医美焕肤', '风景', '防晒', '面膜护肤', '美女', '帅哥', '皮肤管理封面', '医美科普配图'];

function engineKey(model) {
  const m = String(model || '').toLowerCase();
  return BANANA_ENGINES.indexOf(m) >= 0 ? m : 'nb2';
}
function engineLabel(model) {
  const m = String(model || '').toLowerCase();
  return ENGINE_LABEL[m] || 'AI 生图';
}
function normalizeCase(it, managed) {
  const id = Number(it && it.id) || 0;
  const type = it && it.type === 'video' ? 'video' : 'image';
  const target = String((it && (it.target || it.model)) || '').toLowerCase();
  const engine = type === 'video'
    ? (VIDEO_ENGINES.indexOf(target) >= 0 ? target : 'grok')
    : engineKey(target);
  const image = String((it && (it.image || it.img)) || '');
  return {
    id,
    img: image.indexOf('http') === 0 ? image : IMG_BASE + image.replace(/^\.\.\//, '').replace(/^\//, ''),
    video: type === 'video' ? String(it.video || '') : '',
    type,
    title: String(it.title || ''),
    category: String(it.category || ''),
    engineKey: engine,
    engineLabel: engineLabel(engine),
    count: Number(it.count) || 0,
    height: CARD_HEIGHTS[id % CARD_HEIGHTS.length],
    prompt: String(it.prompt || ''),
    managed: managed === true
  };
}
function mergeCases(localItems, managedItems) {
  return (managedItems || []).map((item) => normalizeCase(item, true))
    .concat((localItems || []).map((item) => normalizeCase(item, false)));
}
function followTarget(item) {
  if (item.type === 'video') {
    return {
      storageKey: 'hq_followcreate_video',
      storageValue: { prompt: item.prompt, engine: item.engineKey, inspirationId: item.managed ? item.id : 0 },
      url: '/pages/video/video?mode=generate'
    };
  }
  return {
    storageKey: 'hq_followcreate',
    storageValue: { prompt: item.prompt, engine: item.engineKey },
    url: '/pages/banana/banana'
  };
}

Page({
  data: {
    statusBarHeight: 20,
    categories: [],
    category: '全部',
    leftList: [],
    rightList: [],
    loadingMore: false,
    noMore: false,
    isEmpty: false
  },

  onLoad() {
    let sbh = 20;
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      sbh = info.statusBarHeight || 20;
    } catch (e) {}

    this._managed = [];
    this._all = mergeCases(Array.isArray(RAW) ? RAW : [], []);
    this._setCategories();
    this.setData({ statusBarHeight: sbh });
    this._applyCategory('全部');
  },

  _setCategories() {
    const present = new Set(this._all.map((i) => i.category).filter(Boolean));
    const ordered = CATEGORY_ORDER.filter((c) => present.has(c));
    const extras = Array.from(present).filter((c) => ordered.indexOf(c) < 0);
    this.setData({ categories: ['全部'].concat(ordered, extras) });
  },

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar && tabBar.syncNavigation) tabBar.syncNavigation();
    this._loadManagedCases();
  },

  onPullDownRefresh() {
    this._loadManagedCases().then(() => wx.stopPullDownRefresh()).catch(() => wx.stopPullDownRefresh());
  },

  _loadManagedCases() {
    return api.request('/api/admin/public/inspirations', { method: 'GET', auth: false }).then((res) => {
      if (res.statusCode !== 200 || !res.data || !Array.isArray(res.data.items)) throw new Error('案例加载失败');
      this._managed = res.data.items;
      this._all = mergeCases(Array.isArray(RAW) ? RAW : [], this._managed);
      this._setCategories();
      const current = this.data.category || '全部';
      const category = current === '全部' || this._all.some((item) => item.category === current) ? current : '全部';
      this._applyCategory(category);
      return this._managed;
    }).catch(() => []);
  },

  _track(event, id) {
    if (!Number(id) || Number(id) < 1000000) return;
    api.request('/api/admin/public/inspiration-events', {
      method: 'POST', auth: false, data: { event, ids: [Number(id)] }
    }).catch(() => {});
  },

  _filtered() {
    return this.data.category === '全部'
      ? this._all
      : this._all.filter((i) => i.category === this.data.category);
  },

  _applyCategory(cat) {
    this._page = 0;
    this._leftH = 0;
    this._rightH = 0;
    const empty = this._filteredBy(cat).length === 0;
    this.setData({ category: cat, leftList: [], rightList: [], noMore: false, isEmpty: empty }, () => {
      if (!empty) this._loadMore();
    });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },

  _filteredBy(cat) {
    return cat === '全部' ? this._all : this._all.filter((i) => i.category === cat);
  },

  _loadMore() {
    const filtered = this._filtered();
    const chunk = filtered.slice(this._page * PAGE_SIZE, this._page * PAGE_SIZE + PAGE_SIZE);
    if (!chunk.length) { this.setData({ noMore: true, loadingMore: false }); return; }

    const left = this.data.leftList.slice();
    const right = this.data.rightList.slice();
    chunk.forEach((it) => {
      const card = {
        id: it.id, img: it.img, title: it.title, category: it.category,
        video: it.video, type: it.type, engineLabel: it.engineLabel,
        count: it.count, height: it.height, imageFailed: false
      };
      if (this._leftH <= this._rightH) { left.push(card); this._leftH += it.height; }
      else { right.push(card); this._rightH += it.height; }
    });

    this._page += 1;
    const done = this._page * PAGE_SIZE >= filtered.length;
    this.setData({ leftList: left, rightList: right, noMore: done, loadingMore: false });
  },

  onReachBottom() {
    if (this.data.noMore || this.data.loadingMore || this.data.isEmpty) return;
    this.setData({ loadingMore: true }, () => this._loadMore());
  },

  switchCategory(e) {
    const cat = e.currentTarget.dataset.c;
    if (cat === this.data.category) return;
    this._applyCategory(cat);
  },

  onImageError(e) {
    const col = e.currentTarget.dataset.col;
    const idx = e.currentTarget.dataset.idx;
    const key = (col === 'left' ? 'leftList' : 'rightList') + '[' + idx + '].imageFailed';
    this.setData({ [key]: true });
  },

  previewMedia(e) {
    const id = Number(e.currentTarget.dataset.id) || 0;
    const item = this._all.find((candidate) => candidate.id === id);
    if (!item) return;
    if (this._track) this._track('click', item.id);
    if (item.type === 'video') {
      if (!item.video || !wx.previewMedia) {
        wx.showToast({ title: '当前微信版本暂不支持视频预览', icon: 'none' });
        return;
      }
      wx.previewMedia({ sources: [{ url: item.video, type: 'video', poster: item.img }], current: 0 });
      return;
    }
    const urls = this.data.leftList.concat(this.data.rightList)
      .filter((i) => !i.imageFailed).map((i) => i.img);
    wx.previewImage({ current: item.img, urls });
  },

  follow(e) {
    const id = e.currentTarget.dataset.id;
    const item = this._all.find((i) => String(i.id) === String(id));
    if (!item) return;
    if (!api.getToken()) { wx.navigateTo({ url: '/pages/login/login' }); return; }
    return api.request('/api/auth/card/me', { method: 'GET' }).then((res) => {
      const data = res.data || {};
      const ownerCard = data.card || {};
      if (res.statusCode !== 200 || !cardUtil.isComplete(ownerCard) || !(data.wechat_bound || ownerCard.wechat_bound)) {
        wx.showToast({ title: '请先完善并绑定微信名片', icon: 'none' });
        wx.switchTab({ url: '/pages/my-card/my-card' });
        return;
      }
      const target = followTarget(item);
      if (this._track) this._track('click', item.id);
      wx.setStorageSync(target.storageKey, target.storageValue);
      wx.navigateTo({ url: target.url });
    }).catch(() => wx.showToast({ title: '名片状态读取失败', icon: 'none' }));
  }
});

module.exports = { normalizeCase, mergeCases, followTarget };
