const api = require('../../utils/api.js');
const promptTemplates = require('../../utils/prompt_templates.js');

// 与后端 / 网页版一致的价目与上限
const COSTBASE = {
  nb2: { std: 18, hd: 35 }, pro: { std: 35, hd: 44 },
  gpt: { std: 20, hd: 35 }, xiaole: { std: 12, hd: 16 }, zelong2: { std: 8, hd: 12 }
};
const ENGINE_MAXN = { nb2: 2, pro: 2, gpt: 4, xiaole: 2, zelong2: 2 };
const ENGINES = [
  { key: 'nb2', name: '黄雀生图 2', desc: '快·中文好 ✦推荐' },
  { key: 'pro', name: '黄雀生图 Pro', desc: '精品·最强中文/4K' },
  { key: 'gpt', name: '黄雀 Image 2', desc: 'OpenAI·写实' },
  { key: 'xiaole', name: '果肉生图', desc: '写实·稳定' }
  // 2026-07-13 泽龙2(zelong2)下线：近7天成功率仅19%、几乎全429限流。下方 COSTBASE/ENGINE_MAXN 里的 zelong2 为死键，无害。
];
const RATIOS = ['9:16', '1:1', '16:9', '3:4'];
const POLL_INTERVAL = 4000;
const POLL_TIMEOUT_SEC = 900;

Page({
  data: {
    engines: ENGINES,
    ratios: RATIOS,
    promptTemplates: promptTemplates.IMAGE_TEMPLATES,
    promptTemplateKey: 'poster',
    tplBrand: '黄雀 AI',
    tplColor: '紫粉霓虹',
    tplSelling: '三秒生成视觉内容',
    tplPrice: '免费体验',
    promptUndo: '',
    canUndoPrompt: false,
    prompt: '',
    engine: 'nb2',
    ratio: '9:16',
    quality: 'hd',
    count: 1,
    maxCount: 2,
    cost: 35,
    refImg: '',        // base64（发给后端）
    refPreview: '',    // 本地临时路径（用于预览）
    busy: false,
    note: '',
    noteColor: '#68736D',
    resultUrl: '',
    thumbs: [],
    history: [],
    points: null
  },

  onShow() {
    if (!api.getToken()) { wx.reLaunch({ url: '/pages/login/login' }); return; }
    // 灵感页「跟创」带来的提示词 + 引擎（一次性消费）
    const fc = wx.getStorageSync('hq_followcreate');
    if (fc && fc.prompt) {
      wx.removeStorageSync('hq_followcreate');
      const engine = (ENGINE_MAXN[fc.engine] ? fc.engine : this.data.engine);
      const maxCount = ENGINE_MAXN[engine] || 1;
      this.setData({ prompt: fc.prompt, engine, maxCount, count: Math.min(this.data.count, maxCount) });
      wx.showToast({ title: '已带入灵感提示词', icon: 'none' });
    }
    const ip12Prefill = wx.getStorageSync('hq_ip12_prefill_image');
    if (ip12Prefill && ip12Prefill.prompt) {
      wx.removeStorageSync('hq_ip12_prefill_image');
      this.setData({ prompt: ip12Prefill.prompt });
      wx.showToast({ title: '已带入 IP12 图片计划', icon: 'none' });
    }
    this.updateCost();
    this.refreshPoints();
    this.loadHistory();
  },

  onPullDownRefresh() {
    this.refreshPoints();
    this.loadHistory();
    wx.stopPullDownRefresh();
  },

  onPrompt(e) { this.setData({ prompt: e.detail.value }); },

  selectPromptTemplate(e) { this.setData({ promptTemplateKey: e.currentTarget.dataset.k }); },
  onTemplateField(e) {
    const key = e.currentTarget.dataset.key;
    if (['tplBrand', 'tplColor', 'tplSelling', 'tplPrice'].indexOf(key) < 0) return;
    const patch = {}; patch[key] = e.detail.value;
    this.setData(patch);
  },
  applyPromptTemplate() {
    const result = promptTemplates.buildImagePrompt(this.data.promptTemplateKey, {
      brand: this.data.tplBrand,
      color: this.data.tplColor,
      selling: this.data.tplSelling,
      price: this.data.tplPrice
    });
    this.setData({
      promptUndo: this.data.prompt,
      canUndoPrompt: true,
      prompt: result.prompt,
      ratio: result.ratio
    });
    this.setNote('模板已润色，可继续修改提示词', '#2F6FED');
    wx.showToast({ title: '已套用模板', icon: 'none' });
  },
  undoPromptTemplate() {
    if (!this.data.canUndoPrompt) return;
    this.setData({ prompt: this.data.promptUndo, promptUndo: '', canUndoPrompt: false });
    this.setNote('已恢复套用前的提示词', '#68736D');
  },

  selectEngine(e) {
    const engine = e.currentTarget.dataset.k;
    const maxCount = ENGINE_MAXN[engine] || 1;
    const count = Math.min(this.data.count, maxCount);
    this.setData({ engine, maxCount, count }, () => this.updateCost());
  },
  selectRatio(e) { this.setData({ ratio: e.currentTarget.dataset.v }); },
  selectQuality(e) { this.setData({ quality: e.currentTarget.dataset.v }, () => this.updateCost()); },
  dec() { this.setData({ count: Math.max(1, this.data.count - 1) }, () => this.updateCost()); },
  inc() { this.setData({ count: Math.min(this.data.maxCount, this.data.count + 1) }, () => this.updateCost()); },

  updateCost() {
    const t = COSTBASE[this.data.engine] || COSTBASE.nb2;
    const cost = (t[this.data.quality] || t.hd) * this.data.count;
    this.setData({ cost });
  },

  setNote(t, c) { this.setData({ note: t, noteColor: c || '#68736D' }); },

  chooseRef() {
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sizeType: ['compressed'], sourceType: ['album', 'camera'],
      success: (res) => {
        const f = res.tempFiles[0];
        wx.getFileSystemManager().readFile({
          filePath: f.tempFilePath, encoding: 'base64',
          success: (r) => { this.setData({ refImg: r.data, refPreview: f.tempFilePath }); },
          fail: () => { this.setNote('参考图读取失败，换一张试试', '#C2413A'); }
        });
      }
    });
  },
  clearRef() { this.setData({ refImg: '', refPreview: '' }); },

  generate() {
    if (this.data.busy) return;
    const prompt = (this.data.prompt || '').trim();
    if (!prompt) { this.setNote('请先输入提示词', '#C2413A'); return; }

    const engine = this.data.engine;
    const body = { prompt, ratio: this.data.ratio, quality: this.data.quality, count: this.data.count };
    if (this.data.refImg) body.image = this.data.refImg;

    let endpoint;
    if (engine === 'nb2' || engine === 'pro') {
      endpoint = '/api/gen/banana';
      body.model = engine;
    } else {
      endpoint = '/api/gen/image';
      if (engine === 'xiaole' || engine === 'zelong2') body.provider = engine;
    }

    this.setData({ busy: true, resultUrl: '', thumbs: [] });
    this.setNote('提交中…', '#2F6FED');
    const t0 = Date.now();

    api.request(endpoint, { method: 'POST', data: body, timeout: 60000 })
      .then((res) => {
        if (res.statusCode === 401) { this.setData({ busy: false }); return; }
        if (res.statusCode === 402) {
          this.setData({ busy: false });
          this.setNote('点数不足，暂时无法继续生成', '#C2413A');
          return;
        }
        const d = res.data || {};
        if (!d.job_id) {
          this.setData({ busy: false });
          this.setNote('提交失败：' + (d.detail || '未知错误'), '#C2413A');
          return;
        }
        this.poll(d.job_id, t0);
      })
      .catch(() => { this.setData({ busy: false }); this.setNote('网络错误，请重试', '#C2413A'); });
  },

  poll(id, t0) {
    const tick = () => {
      api.request('/api/gen/job/' + id, { method: 'GET' })
        .then((res) => {
          const d = res.data || {};
          const sec = Math.round((Date.now() - t0) / 1000);
          if (!d.status) { this.setData({ busy: false }); this.setNote('任务丢失，请重试', '#C2413A'); return; }

          if (d.status === 'done') {
            this.setData({ busy: false });
            const urls = (d.result && d.result.urls && d.result.urls.length)
              ? d.result.urls : [d.result && d.result.url].filter(Boolean);
            this.setData({ resultUrl: urls[0] || '', thumbs: urls.length > 1 ? urls : [] });
            this.setNote('✅ 出图完成（' + sec + 's）', '#16803C');
            this.refreshPoints();
            this.loadHistory();
          } else if (d.status === 'error' || d.status === 'failed') {
            this.setData({ busy: false });
            this.setNote('失败：' + (d.error || d.detail || d.status) + ' · 已退点', '#C2413A');
          } else if (sec > POLL_TIMEOUT_SEC) {
            this.setData({ busy: false });
            this.setNote('仍在处理，请稍后下拉刷新查看历史', '#2F6FED');
            this.loadHistory();
          } else {
            this.setNote('生成中（' + sec + 's）· 可留在本页等待', '#2F6FED');
            setTimeout(tick, POLL_INTERVAL);
          }
        })
        .catch(() => { setTimeout(tick, POLL_INTERVAL); });
    };
    setTimeout(tick, POLL_INTERVAL);
  },

  pickThumb(e) { this.setData({ resultUrl: e.currentTarget.dataset.u }); },

  previewResult() {
    if (!this.data.resultUrl) return;
    wx.previewImage({ current: this.data.resultUrl, urls: [this.data.resultUrl] });
  },

  saveResult() {
    if (!this.data.resultUrl) return;
    wx.showLoading({ title: '保存中', mask: true });
    wx.downloadFile({
      url: this.data.resultUrl,
      success: (r) => {
        if (r.statusCode !== 200) { wx.hideLoading(); wx.showToast({ title: '下载失败', icon: 'none' }); return; }
        wx.saveImageToPhotosAlbum({
          filePath: r.tempFilePath,
          success: () => { wx.hideLoading(); wx.showToast({ title: '已保存到相册' }); },
          fail: () => { wx.hideLoading(); wx.showToast({ title: '未授权或保存失败', icon: 'none' }); }
        });
      },
      fail: () => { wx.hideLoading(); wx.showToast({ title: '下载失败', icon: 'none' }); }
    });
  },

  previewHistory(e) {
    wx.previewImage({ current: e.currentTarget.dataset.u, urls: this.data.history });
  },

  refreshPoints() {
    api.request('/api/auth/me', { method: 'GET' }).then((res) => {
      if (res.statusCode === 200 && res.data && res.data.user) {
        this.setData({ points: res.data.user.points });
      }
    }).catch(() => {});
  },

  loadHistory() {
    api.request('/api/gen/history?limit=12', { method: 'GET' }).then((res) => {
      const d = res.data || {};
      if (d.items && d.items.length) {
        this.setData({ history: d.items.map((it) => it.url).filter(Boolean) });
      }
    }).catch(() => {});
  }
});
