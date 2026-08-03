const api = require('../../utils/api.js');
const cardUtil = require('../../utils/card.js');
const RAW = require('./inspirations-data.js');

const IMG_BASE = 'https://huangquechuanmei.com/';
const PAGE_SIZE = 12;
const CARD_HEIGHTS = [360, 440, 520]; // rpx 三档稳定高度
const ENGINE_LABEL = { pro: '专业生图', gpt: 'GPT 生图', nb2: '灵感生图', zelong2: '泽龙生图' };
const BANANA_ENGINES = ['nb2', 'pro', 'gpt', 'xiaole', 'zelong2'];
const CATEGORY_ORDER = ['美妆产品', '护肤精华', '门店拓客', '医美焕肤', '风景', '防晒', '面膜护肤', '美女', '帅哥', '皮肤管理封面', '医美科普配图'];

function engineKey(model) {
  const m = String(model || '').toLowerCase();
  return BANANA_ENGINES.indexOf(m) >= 0 ? m : 'nb2';
}
function engineLabel(model) {
  const m = String(model || '').toLowerCase();
  return ENGINE_LABEL[m] || 'AI 生图';
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

    // 完整数据保留在实例上（含 prompt），渲染列表不含 prompt，保持 setData 轻量
    this._all = (Array.isArray(RAW) ? RAW : []).map((it) => ({
      id: it.id,
      img: IMG_BASE + String(it.image || '').replace(/^\.\.\//, ''),
      title: it.title || '',
      category: it.category || '',
      engineKey: engineKey(it.model),
      engineLabel: engineLabel(it.model),
      count: it.count || 0,
      height: CARD_HEIGHTS[(Number(it.id) || 0) % 3],
      prompt: it.prompt || ''
    }));

    const present = new Set(this._all.map((i) => i.category).filter(Boolean));
    const ordered = CATEGORY_ORDER.filter((c) => present.has(c));
    const extras = Array.from(present).filter((c) => ordered.indexOf(c) < 0);

    this.setData({ statusBarHeight: sbh, categories: ['全部'].concat(ordered, extras) });
    this._applyCategory('全部');
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
        engineLabel: it.engineLabel, count: it.count, height: it.height, imageFailed: false
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

  previewImage(e) {
    const urls = this.data.leftList.concat(this.data.rightList)
      .filter((i) => !i.imageFailed).map((i) => i.img);
    wx.previewImage({ current: e.currentTarget.dataset.img, urls });
  },

  follow(e) {
    const id = e.currentTarget.dataset.id;
    const item = this._all.find((i) => i.id === id);
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
      wx.setStorageSync('hq_followcreate', { prompt: item.prompt, engine: item.engineKey });
      wx.navigateTo({ url: '/pages/banana/banana' });
    }).catch(() => wx.showToast({ title: '名片状态读取失败', icon: 'none' }));
  }
});
