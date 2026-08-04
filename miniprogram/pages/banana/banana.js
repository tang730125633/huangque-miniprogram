const api = require('../../utils/api.js');
const pricing = require('../../utils/pricing.js');
const drafts = require('../../utils/drafts.js');
const promptTemplates = require('../../utils/prompt_templates.js');
const imageMentions = require('../../utils/image_mentions.js');

const PRICE_KEYS = {
  nb2: { std: 'image.banana.nb2.std', hd: 'image.banana.nb2.hd' },
  pro: { std: 'image.banana.pro.std', hd: 'image.banana.pro.hd' },
  gpt: { std: 'image.openai.std', hd: 'image.openai.hd' },
  xiaole: { std: 'image.xiaole.std', hd: 'image.xiaole.hd' }
};
const ENGINE_MAXN = { nb2: 2, pro: 2, gpt: 4, xiaole: 2, zelong2: 2 };
const ENGINES = [
  { key: 'nb2', name: '黄雀生图 2', desc: '快·中文好 ✦推荐' },
  { key: 'pro', name: '黄雀生图 Pro', desc: '精品·最强中文/4K' },
  { key: 'gpt', name: '黄雀 Image 2', desc: 'OpenAI·写实' },
  { key: 'xiaole', name: '果肉生图', desc: '写实·稳定' }
  // 2026-07-13 泽龙2(zelong2)下线：近7天成功率仅19%、几乎全429限流。
];
const RATIOS = ['9:16', '1:1', '16:9', '3:4'];
const DRAFT_KEY = 'hq_draft_banana_v1';
const IMAGE_REF_LIMITS = { nb2: 14, pro: 14, gpt: 16, xiaole: 4 };
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
    promptCursor: -1,
    promptMentionOpen: false,
    engine: 'nb2',
    ratio: '9:16',
    quality: 'hd',
    count: 1,
    maxCount: 2,
    cost: null,
    pricingReady: false,
    pricingChecking: false,
    maxRefCount: IMAGE_REF_LIMITS.nb2,
    refPreviews: [],
    refBusy: false,
    draftStatus: '',
    draftStatusError: false,
    hasDraft: false,
    busy: false,
    note: '',
    noteColor: '#68736D',
    resultUrl: '',
    thumbs: [],
    history: [],
    points: null
  },

  onLoad() {
    this._refImages = [];
    this._refOpToken = 0;
    this._draftLoaded = false;
    this._active = true;
  },

  onShow() {
    this._active = true;
    if (!api.getToken()) { wx.reLaunch({ url: '/pages/login/login' }); return; }
    if (!this._draftLoaded) {
      this._draftLoaded = true;
      this.restoreDraft();
    }
    // 灵感页「跟创」带来的提示词 + 引擎（一次性消费）
    const fc = wx.getStorageSync('hq_followcreate');
    if (fc && fc.prompt) {
      wx.removeStorageSync('hq_followcreate');
      const engine = ENGINES.some((item) => item.key === fc.engine) ? fc.engine : this.data.engine;
      const maxCount = ENGINE_MAXN[engine] || 1;
      const maxRefCount = this._refLimit(engine);
      const refPreviews = this.data.refPreviews.slice(0, maxRefCount);
      const patch = { prompt: fc.prompt, engine, maxCount, maxRefCount, refPreviews, count: Math.min(this.data.count, maxCount) };
      if (this.saveDraft('已自动保存', patch)) {
        this._refImages = (this._refImages || []).slice(0, maxRefCount);
        this.setData(patch);
      } else {
        this.setData({ prompt: fc.prompt });
      }
      wx.showToast({ title: '已带入灵感提示词', icon: 'none' });
    }
    const ip12Prefill = wx.getStorageSync('hq_ip12_prefill_image');
    if (ip12Prefill && ip12Prefill.prompt) {
      wx.removeStorageSync('hq_ip12_prefill_image');
      this.setData({ prompt: ip12Prefill.prompt }, () => this.saveDraft());
      wx.showToast({ title: '已带入 IP12 图片计划', icon: 'none' });
    }
    pricing.watch(this, (prices) => this._applyPricing(prices), () => this._pricingError());
    this.refreshPoints();
    this.loadHistory();
  },

  onPullDownRefresh() {
    if (this._pricingRefresh) this._pricingRefresh();
    this.refreshPoints();
    this.loadHistory();
    wx.stopPullDownRefresh();
  },

  onHide() { this._active = false; pricing.stop(this); this.setData({ pricingChecking: false }); this._flushDraftSave(); },
  onUnload() {
    this._active = false;
    pricing.stop(this);
    this._refOpToken += 1;
    this._flushDraftSave();
  },

  _draftKey() {
    if (!this._draftStorageKey) this._draftStorageKey = drafts.scopedKey(DRAFT_KEY, api.getToken());
    return this._draftStorageKey;
  },

  _refLimit(engine) { return IMAGE_REF_LIMITS[engine] || 1; },

  _draftPayload(state) {
    return {
      prompt: state.prompt,
      promptTemplateKey: state.promptTemplateKey,
      tplBrand: state.tplBrand,
      tplColor: state.tplColor,
      tplSelling: state.tplSelling,
      tplPrice: state.tplPrice,
      promptUndo: state.promptUndo,
      canUndoPrompt: state.canUndoPrompt,
      engine: state.engine,
      ratio: state.ratio,
      quality: state.quality,
      count: state.count,
      refFiles: (state.refPreviews || []).slice(0, this._refLimit(state.engine))
    };
  },

  saveDraft(status, override) {
    if (this._draftTimer) { clearTimeout(this._draftTimer); this._draftTimer = null; }
    const state = Object.assign({}, this.data, override || {});
    const payload = this._draftPayload(state);
    const ok = drafts.save(this._draftKey(), payload, payload.refFiles);
    this.setData({
      hasDraft: ok || this.data.hasDraft,
      draftStatus: ok ? (status || '已自动保存') : '自动保存失败，请重新选择图片或稍后再试',
      draftStatusError: !ok
    });
    return ok;
  },

  _queueDraftSave() {
    if (this._draftTimer) clearTimeout(this._draftTimer);
    this._draftTimer = setTimeout(() => {
      this._draftTimer = null;
      this.saveDraft();
    }, 300);
  },

  _flushDraftSave() {
    if (!this._draftTimer) return;
    clearTimeout(this._draftTimer);
    this._draftTimer = null;
    this.saveDraft();
  },

  _readRef(filePath) {
    return new Promise((resolve, reject) => {
      try {
        wx.getFileSystemManager().readFile({
          filePath, encoding: 'base64',
          success: (res) => resolve(res.data), fail: reject
        });
      } catch (e) { reject(e); }
    });
  },

  restoreDraft() {
    const saved = drafts.load(this._draftKey());
    if (!saved) return;
    const engine = ENGINES.some((item) => item.key === saved.engine) ? saved.engine : 'nb2';
    const maxCount = ENGINE_MAXN[engine] || 1;
    const count = Math.max(1, Math.min(maxCount, Math.floor(Number(saved.count) || 1)));
    const maxRefCount = this._refLimit(engine);
    const allFiles = Array.isArray(saved.refFiles) ? saved.refFiles.filter((item) => typeof item === 'string' && item) : [];
    const refFiles = allFiles.slice(0, maxRefCount);
    const patch = {
      prompt: typeof saved.prompt === 'string' ? saved.prompt : '',
      promptTemplateKey: promptTemplates.IMAGE_TEMPLATES.some((item) => item.key === saved.promptTemplateKey) ? saved.promptTemplateKey : 'poster',
      tplBrand: typeof saved.tplBrand === 'string' ? saved.tplBrand : '黄雀 AI',
      tplColor: typeof saved.tplColor === 'string' ? saved.tplColor : '紫粉霓虹',
      tplSelling: typeof saved.tplSelling === 'string' ? saved.tplSelling : '三秒生成视觉内容',
      tplPrice: typeof saved.tplPrice === 'string' ? saved.tplPrice : '免费体验',
      promptUndo: typeof saved.promptUndo === 'string' ? saved.promptUndo : '',
      canUndoPrompt: saved.canUndoPrompt === true,
      engine,
      ratio: RATIOS.indexOf(saved.ratio) >= 0 ? saved.ratio : '9:16',
      quality: saved.quality === 'std' ? 'std' : 'hd',
      count,
      maxCount,
      maxRefCount,
      refPreviews: refFiles,
      refBusy: refFiles.length > 0,
      hasDraft: true,
      draftStatus: refFiles.length ? '正在恢复本机草稿…' : '已恢复本机草稿',
      draftStatusError: false
    };
    this.setData(patch, () => this.updateCost());
    if (!refFiles.length) {
      if (allFiles.length && this.saveDraft('已恢复本机草稿')) drafts.discardFiles(allFiles);
      return;
    }
    const opToken = ++this._refOpToken;
    Promise.all(refFiles.map((filePath) => this._readRef(filePath)
      .then((data) => ({ filePath, data }))
      .catch(() => null)))
      .then((items) => {
        if (opToken !== this._refOpToken) return;
        const currentLimit = this._refLimit(this.data.engine);
        const valid = items.filter(Boolean).slice(0, currentLimit);
        const validFiles = valid.map((item) => item.filePath);
        const missingFiles = validFiles.length !== Math.min(allFiles.length, currentLimit);
        const needsReconcile = validFiles.length !== allFiles.length;
        this._refImages = valid.map((item) => item.data);
        this.setData({
          refPreviews: validFiles,
          refBusy: false,
          draftStatus: missingFiles ? '草稿已恢复，参考图需重新选择' : '已恢复本机草稿',
          draftStatusError: missingFiles
        });
        if (needsReconcile && this.saveDraft('已恢复本机草稿', { refPreviews: validFiles }) && missingFiles) {
          this.setData({ draftStatus: '草稿已恢复，参考图需重新选择', draftStatusError: true });
        }
      });
  },

  clearDraft() {
    wx.showModal({
      title: '清空草稿？',
      content: '提示词和已保存的参考图都会被清除。',
      confirmText: '清空',
      success: (res) => { if (res.confirm) this._clearDraftNow(); }
    });
  },

  _clearDraftNow() {
    if (this._draftTimer) { clearTimeout(this._draftTimer); this._draftTimer = null; }
    this._refOpToken += 1;
    drafts.clear(this._draftKey());
    this._refImages = [];
    this.setData({
      prompt: '', promptTemplateKey: 'poster', tplBrand: '黄雀 AI', tplColor: '紫粉霓虹',
      tplSelling: '三秒生成视觉内容', tplPrice: '免费体验', promptUndo: '', canUndoPrompt: false,
      engine: 'nb2', ratio: '9:16', quality: 'hd', count: 1, maxCount: 2, maxRefCount: IMAGE_REF_LIMITS.nb2,
      refPreviews: [], refBusy: false, hasDraft: false, draftStatus: '草稿已清空', draftStatusError: false
    }, () => this.updateCost());
  },

  _clearAcceptedDraft(expectedRevision) {
    if (this._draftTimer) { clearTimeout(this._draftTimer); this._draftTimer = null; }
    this._refOpToken += 1;
    if (!drafts.clearIfRevision(this._draftKey(), expectedRevision)) return false;
    this._refImages = [];
    this.setData({
      refPreviews: [], refBusy: false, hasDraft: false,
      draftStatus: '任务已受理，草稿已清空', draftStatusError: false
    });
    return true;
  },

  onPrompt(e) {
    const cursor = Number.isInteger(e.detail.cursor) ? e.detail.cursor : e.detail.value.length;
    this._promptMentionRange = imageMentions.trigger(e.detail.value, cursor);
    this.setData({ prompt: e.detail.value, promptCursor: cursor, promptMentionOpen: !!(this._promptMentionRange && this.data.refPreviews.length) }, () => this._queueDraftSave());
  },
  selectPromptMention(e) {
    const index = Number(e.currentTarget.dataset.i) + 1;
    const range = this._promptMentionRange;
    if (!range || index > this.data.refPreviews.length) return;
    const result = imageMentions.insert(this.data.prompt, index, range.start, range.end);
    this._promptMentionRange = null;
    this.setData({ prompt: result.value, promptCursor: result.cursor, promptMentionOpen: false }, () => this.saveDraft());
  },

  selectPromptTemplate(e) { this.setData({ promptTemplateKey: e.currentTarget.dataset.k }, () => this.saveDraft()); },
  onTemplateField(e) {
    const key = e.currentTarget.dataset.key;
    if (['tplBrand', 'tplColor', 'tplSelling', 'tplPrice'].indexOf(key) < 0) return;
    const patch = {}; patch[key] = e.detail.value;
    this.setData(patch, () => this._queueDraftSave());
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
    }, () => this.saveDraft());
    this.setNote('模板已润色，可继续修改提示词', '#2F6FED');
    wx.showToast({ title: '已套用模板', icon: 'none' });
  },
  undoPromptTemplate() {
    if (!this.data.canUndoPrompt) return;
    this.setData({ prompt: this.data.promptUndo, promptUndo: '', canUndoPrompt: false }, () => this.saveDraft());
    this.setNote('已恢复套用前的提示词', '#68736D');
  },

  selectEngine(e) {
    if (this.data.refBusy) { this.setNote('参考图保存中，请稍候', '#2F6FED'); return; }
    const engine = e.currentTarget.dataset.k;
    const nextLimit = this._refLimit(engine);
    const removed = (this.data.refPreviews || []).length - nextLimit;
    if (removed > 0) {
      const mentionError = imageMentions.validate(this.data.prompt, nextLimit);
      if (mentionError) { this.setNote(mentionError + '，请先修改提示词', '#C2413A'); return; }
      wx.showModal({
        title: '切换后仅保留前 ' + nextLimit + ' 张图片',
        content: '其余参考图会从本机草稿中删除，是否继续？',
        confirmText: '继续切换',
        success: (res) => { if (res.confirm) this._applyEngine(engine); }
      });
      return;
    }
    this._applyEngine(engine);
  },
  _applyEngine(engine) {
    const maxCount = ENGINE_MAXN[engine] || 1;
    const count = Math.min(this.data.count, maxCount);
    const maxRefCount = this._refLimit(engine);
    const refPreviews = (this.data.refPreviews || []).slice(0, maxRefCount);
    const patch = { engine, maxCount, count, maxRefCount, refPreviews };
    if (!this.saveDraft('已自动保存', patch)) return;
    const removed = (this.data.refPreviews || []).length - refPreviews.length;
    this._refImages = (this._refImages || []).slice(0, maxRefCount);
    this.setData(patch, () => this.updateCost());
    if (removed) this.setNote('已切换引擎，仅保留前 ' + maxRefCount + ' 张参考图', '#2F6FED');
  },
  selectRatio(e) { this.setData({ ratio: e.currentTarget.dataset.v }, () => this.saveDraft()); },
  selectQuality(e) { this.setData({ quality: e.currentTarget.dataset.v }, () => { this.updateCost(); this.saveDraft(); }); },
  dec() { this.setData({ count: Math.max(1, this.data.count - 1) }, () => { this.updateCost(); this.saveDraft(); }); },
  inc() { this.setData({ count: Math.min(this.data.maxCount, this.data.count + 1) }, () => { this.updateCost(); this.saveDraft(); }); },

  _priceKey() {
    const engine = PRICE_KEYS[this.data.engine];
    return engine && engine[this.data.quality];
  },

  _costFrom(prices) {
    const unit = pricing.point(prices, this._priceKey());
    return unit ? unit * this.data.count : null;
  },

  _applyPricing(prices) {
    this._prices = prices;
    const cost = this._costFrom(prices);
    if (!cost) { this._pricingError(); return false; }
    this.setData({ cost, pricingReady: true });
    return true;
  },

  _pricingError() {
    this._prices = null;
    this.setData({ cost: null, pricingReady: false });
  },

  updateCost() {
    const cost = this._costFrom(this._prices);
    this.setData({ cost, pricingReady: !!cost });
  },

  setNote(t, c) { this.setData({ note: t, noteColor: c || '#68736D' }); },

  chooseRef() {
    if (this.data.refBusy) return;
    const left = this._refLimit(this.data.engine) - this.data.refPreviews.length;
    if (left <= 0) return;
    const opToken = ++this._refOpToken;
    this.setData({ refBusy: true });
    wx.chooseMedia({
      count: Math.min(left, 9), mediaType: ['image'], sizeType: ['compressed'], sourceType: ['album', 'camera'],
      success: (res) => {
        const files = (res.tempFiles || []).slice(0, left);
        Promise.all(files.map((file) => drafts.persistFile(file.tempFilePath)
          .then((filePath) => this._readRef(filePath)
            .then((data) => ({ filePath, data }))
            .catch((error) => { drafts.discardFiles([filePath]); throw error; }))
          .catch(() => null)))
          .then((items) => {
            const valid = items.filter(Boolean);
            if (opToken !== this._refOpToken) {
              drafts.discardFiles(valid.map((item) => item.filePath));
              return;
            }
            const maxRefCount = this._refLimit(this.data.engine);
            const capacity = Math.max(0, maxRefCount - this.data.refPreviews.length);
            const accepted = valid.slice(0, capacity);
            drafts.discardFiles(valid.slice(capacity).map((item) => item.filePath));
            const refPreviews = this.data.refPreviews.concat(accepted.map((item) => item.filePath));
            if (!accepted.length) {
              this.setData({ refBusy: false });
              this.setNote('参考图保存失败，请重新选择', '#C2413A');
              return;
            }
            if (!this.saveDraft('已自动保存', { refPreviews })) {
              this.setData({ refBusy: false });
              this.setNote('参考图保存失败，请重新选择', '#C2413A');
              return;
            }
            this._refImages = (this._refImages || []).concat(accepted.map((item) => item.data));
            this.setData({ refPreviews, refBusy: false });
            if (valid.length !== files.length) this.setNote('部分参考图读取失败，请重新选择', '#C2413A');
          })
          .catch(() => {
            if (opToken !== this._refOpToken) return;
            this.setData({ refBusy: false });
            this.setNote('参考图保存失败，请重新选择', '#C2413A');
          });
      },
      fail: () => { if (opToken === this._refOpToken) this.setData({ refBusy: false }); }
    });
  },
  removeRef(e) {
    if (this.data.refBusy) return;
    const index = Number(e.currentTarget.dataset.i);
    if (!Number.isInteger(index) || index < 0 || index >= this.data.refPreviews.length) return;
    if (imageMentions.usesShiftedIndex(this.data.prompt, index + 1)) {
      this.setNote('提示词已引用图片 ' + (index + 1) + ' 或后续图片，请先删除对应 @图片N', '#C2413A');
      return;
    }
    const refPreviews = this.data.refPreviews.slice(); refPreviews.splice(index, 1);
    if (!this.saveDraft('已自动保存', { refPreviews })) return;
    (this._refImages || []).splice(index, 1);
    this.setData({ refPreviews });
  },
  clearRef() {
    if (this.data.refBusy || !this.data.refPreviews.length) return;
    if (imageMentions.usesShiftedIndex(this.data.prompt, 1)) {
      this.setNote('提示词仍有 @图片N，请先删除引用再清空图片', '#C2413A');
      return;
    }
    wx.showModal({
      title: '清空参考图？',
      content: '已保存到本机草稿的参考图会一并删除。',
      confirmText: '清空',
      success: (res) => { if (res.confirm) this._clearRefNow(); }
    });
  },
  _clearRefNow() {
    if (!this.saveDraft('已自动保存', { refPreviews: [] })) return;
    this._refImages = [];
    this.setData({ refPreviews: [] });
  },

  insertRefMention(e) {
    const index = Number(e.currentTarget.dataset.i) + 1;
    if (!Number.isInteger(index) || index < 1 || index > this.data.refPreviews.length) return;
    const cursor = this.data.promptCursor >= 0 ? this.data.promptCursor : this.data.prompt.length;
    const result = imageMentions.insert(this.data.prompt, index, cursor, cursor);
    this.setData({ prompt: result.value, promptCursor: result.cursor, promptMentionOpen: false }, () => this.saveDraft());
  },

  generate() {
    if (this.data.busy || this.data.pricingChecking) return;
    const prompt = (this.data.prompt || '').trim();
    if (!prompt) { this.setNote('请先输入提示词', '#C2413A'); return; }

    const engine = this.data.engine;
    const body = { prompt, ratio: this.data.ratio, quality: this.data.quality, count: this.data.count };
    if (this.data.refBusy) { this.setNote('参考图保存中，请稍候', '#2F6FED'); return; }
    const refImages = this._refImages || [];
    if (this.data.refPreviews.length !== refImages.length) {
      this.setNote('部分参考图已失效，请移除后重新选择', '#C2413A'); return;
    }
    const mentionError = imageMentions.validate(prompt, refImages.length);
    if (mentionError) { this.setNote(mentionError, '#C2413A'); return; }
    if (refImages.length) body.reference_images = refImages.slice(0, this._refLimit(engine));

    let endpoint;
    if (engine === 'nb2' || engine === 'pro') {
      endpoint = '/api/gen/banana';
      body.model = engine;
    } else {
      endpoint = '/api/gen/image';
      if (engine === 'xiaole' || engine === 'zelong2') body.provider = engine;
    }

    const shownCost = this.data.cost;
    this.setData({ pricingChecking: true });
    return pricing.confirm(shownCost, (prices) => this._costFrom(prices))
      .then((latest) => {
        if (!this._active) return;
        this.setData({ pricingChecking: false });
        this._applyPricing(latest.prices);
        if (latest.changed) {
          this.setNote('价格已更新为 ' + latest.cost + ' 点，请确认后重新提交', '#2F6FED');
          return;
        }
        this._submitGenerate(endpoint, body);
      })
      .catch(() => {
        if (!this._active) return;
        this.setData({ pricingChecking: false });
        this._pricingError();
        this.setNote('实时价格确认失败，请稍后重试', '#C2413A');
      });
  },

  _submitGenerate(endpoint, body) {
    this.setData({ busy: true, resultUrl: '', thumbs: [] });
    this.setNote('提交中…', '#2F6FED');
    const t0 = Date.now();
    this.saveDraft('已自动保存');
    const submittedDraft = JSON.stringify(this._draftPayload(this.data));
    const submittedRevision = drafts.getRevision(this._draftKey());

    api.request(endpoint, { method: 'POST', data: body, timeout: 60000 })
      .then((res) => {
        if (res.statusCode === 401) { this.setData({ busy: false }); return; }
        if (res.statusCode === 402) {
          this.setData({ busy: false });
          this.setNote('点数不足，暂时无法继续生成', '#C2413A');
          return;
        }
        const d = res.data || {};
        const accepted = res.statusCode >= 200 && res.statusCode < 300 && d.job_id;
        if (!accepted) {
          this.setData({ busy: false });
          this.setNote('提交失败：' + (d.detail || '未知错误'), '#C2413A');
          return;
        }
        if (JSON.stringify(this._draftPayload(this.data)) === submittedDraft) {
          this._clearAcceptedDraft(submittedRevision);
        } else if (this._active) {
          this.saveDraft('任务已受理，已保留后续修改');
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
