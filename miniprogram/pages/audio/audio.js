const api = require('../../utils/api.js');

const COST = 10;
const POLL_INTERVAL = 2000;
const POLL_MAX = 90; // 90 * 2s = 180s

// 公共音色的友好副标题（后端只给 voice_key，这里补展示文案）
const PUBLIC_META = {
  S_d21F8OR62: '温柔女声 · 情感种草',
  S_l8wE8OR62: '活力女声 · 广告推荐',
  S_pa0E8OR62: '沉稳男声 · 知识口播',
  S_xaUB8OR62: '亲和女声 · 本地生活'
};

const PARAM_DEFS = [
  { key: 'speed', name: '语速', min: 0.5, max: 2.0, step: 0.1 },
  { key: 'pitch', name: '音调', min: -12, max: 12, step: 1 },
  { key: 'volume', name: '音量', min: -50, max: 100, step: 10 }
];

Page({
  data: {
    text: '',
    voices: [],
    filtered: [],
    voiceTab: 'public',
    selectedVoice: '',
    paramDefs: PARAM_DEFS,
    params: { speed: 1.0, pitch: 0, volume: 0 },
    cost: COST,
    busy: false,
    note: '',
    noteColor: '#68736D',
    defaultNote: '配音消耗 10 点 · 失败自动退点',
    resultUrl: '',
    playing: false,
    points: null
  },

  onLoad() {
    this._audio = wx.createInnerAudioContext();
    this._audio.onEnded(() => this.setData({ playing: false }));
    this._audio.onStop(() => this.setData({ playing: false }));
    this._audio.onError(() => { this.setData({ playing: false }); wx.showToast({ title: '播放失败', icon: 'none' }); });
    this._preview = wx.createInnerAudioContext();
  },
  onUnload() {
    if (this._audio) this._audio.destroy();
    if (this._preview) this._preview.destroy();
  },

  onShow() {
    if (!api.getToken()) { wx.reLaunch({ url: '/pages/login/login' }); return; }
    this.refreshPoints();
    this.loadVoices();
  },

  onText(e) { this.setData({ text: e.detail.value }); },

  switchTab(e) {
    const voiceTab = e.currentTarget.dataset.t;
    this.setData({ voiceTab }, () => this.applyFilter());
  },

  applyFilter() {
    const filtered = this.data.voices.filter((v) => (v.scope || 'public') === this.data.voiceTab);
    // 若当前选中音色不在此分组，自动选中该组第一个
    let selectedVoice = this.data.selectedVoice;
    if (!filtered.some((v) => v.voice_key === selectedVoice)) {
      selectedVoice = filtered.length ? filtered[0].voice_key : '';
    }
    this.setData({ filtered, selectedVoice });
  },

  pickVoice(e) { this.setData({ selectedVoice: e.currentTarget.dataset.k }); },

  playPreview(e) {
    const url = e.currentTarget.dataset.u;
    if (!url || !this._preview) return;
    this._preview.stop();
    this._preview.src = url;
    this._preview.play();
  },

  stepParam(e) {
    const key = e.currentTarget.dataset.k;
    const dir = parseInt(e.currentTarget.dataset.d, 10);
    const def = PARAM_DEFS.find((p) => p.key === key);
    let val = this.data.params[key] + dir * def.step;
    val = Math.max(def.min, Math.min(def.max, val));
    val = key === 'speed' ? Math.round(val * 10) / 10 : Math.round(val);
    const params = Object.assign({}, this.data.params);
    params[key] = val;
    this.setData({ params });
  },

  setNote(t, c) { this.setData({ note: t, noteColor: c || '#68736D' }); },

  generate() {
    if (this.data.busy) return;
    const text = (this.data.text || '').trim();
    if (!text) { this.setNote('请先输入配音文案', '#C2413A'); return; }
    if (!this.data.selectedVoice) { this.setNote('请先选择一个音色', '#C2413A'); return; }
    if (this.data.points !== null && this.data.points < COST) {
      this.setNote('点数不足（需 ' + COST + ' 点）', '#C2413A');
      return;
    }

    this.setData({ busy: true, resultUrl: '', playing: false });
    if (this._audio) this._audio.stop();
    this.setNote('提交中…', '#2F6FED');

    const body = {
      text: text,
      voice: this.data.selectedVoice,
      speed: this.data.params.speed,
      pitch: this.data.params.pitch,
      volume: this.data.params.volume
    };

    api.request('/api/gen/audio', { method: 'POST', data: body, timeout: 60000 })
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
        this.poll(d.job_id, 0);
      })
      .catch(() => { this.setData({ busy: false }); this.setNote('网络错误，请重试', '#C2413A'); });
  },

  poll(id, n) {
    api.request('/api/gen/job/' + id, { method: 'GET' })
      .then((res) => {
        const d = res.data || {};
        if (!d.status) { this.setData({ busy: false }); this.setNote('任务丢失，请重试', '#C2413A'); return; }
        if (d.status === 'done') {
          this.setData({ busy: false });
          const url = d.result && (d.result.url || d.result.file);
          this.setData({ resultUrl: api.absUrl(url || '') });
          this.setNote('✅ 配音完成', '#16803C');
          this.refreshPoints();
        } else if (d.status === 'error' || d.status === 'failed') {
          this.setData({ busy: false });
          this.setNote('失败：' + (d.error || d.detail || d.status) + ' · 已退点', '#C2413A');
        } else if (n >= POLL_MAX) {
          this.setData({ busy: false });
          this.setNote('生成超时，请稍后重试', '#C2413A');
        } else {
          this.setNote('生成中…（' + ((n + 1) * 2) + 's）', '#2F6FED');
          setTimeout(() => this.poll(id, n + 1), POLL_INTERVAL);
        }
      })
      .catch(() => { setTimeout(() => this.poll(id, n + 1), POLL_INTERVAL); });
  },

  togglePlay() {
    if (!this.data.resultUrl || !this._audio) return;
    if (this.data.playing) {
      this._audio.pause();
      this.setData({ playing: false });
    } else {
      this._audio.src = this.data.resultUrl;
      this._audio.play();
      this.setData({ playing: true });
    }
  },

  copyUrl() {
    if (!this.data.resultUrl) return;
    wx.setClipboardData({ data: this.data.resultUrl, success: () => wx.showToast({ title: '链接已复制' }) });
  },

  goClone() { wx.navigateTo({ url: '/pages/clone/clone' }); },

  refreshPoints() {
    api.request('/api/auth/me', { method: 'GET' }).then((res) => {
      if (res.statusCode === 200 && res.data && res.data.user) {
        this.setData({ points: res.data.user.points });
      }
    }).catch(() => {});
  },

  loadVoices() {
    api.request('/api/gen/audio/voices', { method: 'GET' }).then((res) => {
      const d = res.data || {};
      const list = (d.voices || d.items || (Array.isArray(d) ? d : [])).map((v) => {
        const scope = v.scope || 'public';
        const sub = v.sub || (scope === 'public' ? PUBLIC_META[v.voice_key] : '') || '';
        return Object.assign({}, v, { scope, sub });
      });
      this.setData({ voices: list }, () => this.applyFilter());
    }).catch(() => {});
  }
});
