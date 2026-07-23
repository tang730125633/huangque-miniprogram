const api = require('../../utils/api.js');

const CLONE_POLL_INTERVAL = 5000;
const CLONE_POLL_MAX = 60; // 60 * 5s = 5 min
const VOICE_CONSENT_VERSION = '2026-07-23-v1';

Page({
  data: {
    stage: 'loading',   // loading | no-slot | clone | training | ready | failed
    slotId: '',
    slots: [],
    slotCount: 0,
    slotMax: 5,
    slotCost: 50,
    canBuySlot: true,
    points: null,
    name: '',
    busy: false,
    err: '',
    recording: false,
    hasSample: false,
    recSec: 0,
    recProgress: 0,
    audioB64: '',
    audioFormat: 'mp3',
    trainSec: 0,
    previewUrl: '',
    playing: false,
    voiceConsent: false,
    voiceConsentAt: ''
  },

  onLoad() {
    this._rec = wx.getRecorderManager();
    this._rec.onStart(() => { this.setData({ recording: true, recSec: 0, recProgress: 0 }); this._startTimer(); });
    this._rec.onStop((res) => {
      this._stopTimer();
      this.setData({ recording: false });
      if (res && res.tempFilePath) this._readSample(res.tempFilePath);
    });
    this._rec.onError(() => {
      this._stopTimer();
      this.setData({ recording: false, err: '录音失败，请检查麦克风权限' });
    });
    this._player = wx.createInnerAudioContext();
    this._player.onEnded(() => this.setData({ playing: false }));
    this._player.onStop(() => this.setData({ playing: false }));
  },
  onUnload() {
    this._stopTimer();
    if (this._pollTimer) clearTimeout(this._pollTimer);
    if (this._player) this._player.destroy();
  },

  onShow() {
    if (!api.getToken()) { wx.reLaunch({ url: '/pages/login/login' }); return; }
    if (!this.data.recording && !this.data.busy) this.loadSlots();
  },

  loadSlots() {
    api.request('/api/gen/audio/slots', { method: 'GET', timeout: 12000 }).then((res) => {
      const d = res.data || {};
      const rawSlots = d.items || d.slots || (Array.isArray(d) ? d : []);
      const slots = rawSlots.map((slot, index) => this._formatSlot(slot, index));
      const slotCount = d.slot_count == null ? slots.length : Number(d.slot_count);
      const slotMax = Number(d.slot_max || 5);
      this.setData({
        slots,
        slotCount,
        slotMax,
        slotCost: Number(d.slot_cost || 50),
        canBuySlot: slotCount < slotMax,
        points: d.points == null ? null : d.points
      });
      if (slots.length) {
        const selectedIndex = Math.max(0, slots.findIndex((slot) => slot.slot_id === this.data.slotId));
        this.selectSlotByIndex(selectedIndex);
      } else {
        this.setData({ stage: 'no-slot', slotId: '', name: '', previewUrl: '' });
      }
    }).catch(() => { this.setData({ stage: 'no-slot' }); });
  },

  _formatSlot(slot, index) {
    const ready = slot.status === 'ready' || !!slot.preview_url;
    const status = ready ? 'ready' : (slot.status || 'active');
    const statusMap = {
      active: { label: '待复刻', className: 'idle' },
      training: { label: '复刻中', className: 'training' },
      ready: { label: '可使用', className: 'ready' },
      failed: { label: '需重试', className: 'failed' }
    };
    const meta = statusMap[status] || statusMap.active;
    return Object.assign({}, slot, {
      status,
      displayName: slot.voice_name || slot.display_name || ('音色 ' + (index + 1)),
      statusLabel: meta.label,
      statusClass: meta.className
    });
  },

  selectSlot(e) {
    this.selectSlotByIndex(Number(e.currentTarget.dataset.index || 0));
  },

  selectSlotByIndex(index) {
    const slot = this.data.slots[index];
    if (!slot) return;
    if (this._pollTimer) clearTimeout(this._pollTimer);
    this.setData({
      slotId: slot.slot_id,
      name: slot.displayName,
      previewUrl: slot.preview_url || '',
      playing: false,
      err: slot.clone_error || ''
    });
    if (slot.status === 'ready' || slot.preview_url) {
      this.setData({ stage: 'ready' });
    } else if (slot.status === 'training') {
      this.setData({ stage: 'training', trainSec: 0 });
      this.pollStatus(0);
    } else if (slot.status === 'failed') {
      this.setData({ stage: 'failed' });
    } else {
      this.setData({ stage: 'clone' });
    }
  },

  _updateSelectedSlot(changes) {
    const slots = this.data.slots.map((slot, index) => {
      if (slot.slot_id !== this.data.slotId) return slot;
      return this._formatSlot(Object.assign({}, slot, changes), index);
    });
    this.setData({ slots });
  },

  onName(e) { this.setData({ name: e.detail.value }); },

  onVoiceConsentChange(e) {
    const values = (e && e.detail && e.detail.value) || [];
    const agreed = values.indexOf('agreed') >= 0;
    this.setData({
      voiceConsent: agreed,
      voiceConsentAt: agreed ? new Date().toISOString() : '',
      err: ''
    });
  },

  buySlot() {
    if (this.data.busy || !this.data.canBuySlot) return;
    wx.showModal({
      title: '购买音色槽位',
      content: '将消耗 ' + this.data.slotCost + ' 点，购买后可新增 1 个专属音色。',
      confirmText: '确认购买',
      success: (result) => {
        if (result.confirm) this._purchaseSlot();
      }
    });
  },

  _purchaseSlot() {
    this.setData({ busy: true, err: '' });
    api.request('/api/gen/audio/buy-slot', { method: 'POST', data: {} }).then((res) => {
      const d = res.data || {};
      if (res.statusCode === 200 && d.ok && d.slot && d.slot.slot_id) {
        this.setData({
          busy: false,
          slotId: d.slot.slot_id,
          points: d.points_left == null ? this.data.points : d.points_left,
          stage: 'loading',
          err: ''
        });
        wx.showToast({ title: '槽位购买成功', icon: 'success' });
        this.loadSlots();
      } else if (res.statusCode === 402) {
        this.setData({ busy: false, err: d.detail || ('点数不足，购买槽位需 ' + (d.need || this.data.slotCost) + ' 点') });
      } else {
        this.setData({ busy: false, err: d.detail || '购买失败，请稍后重试' });
      }
    }).catch(() => { this.setData({ busy: false, err: '网络错误，请重试' }); });
  },

  toggleRecord() {
    if (!this.data.voiceConsent) {
      this.setData({ err: '请先阅读并单独同意《声纹授权协议》' });
      wx.showToast({ title: '请先同意声纹授权协议', icon: 'none' });
      return;
    }
    if (this.data.recording) {
      this._rec.stop();
    } else {
      this.setData({ err: '' });
      this._rec.start({ duration: 60000, format: 'mp3', sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 48000 });
    }
  },

  _startTimer() {
    this._stopTimer();
    this._timer = setInterval(() => {
      const s = this.data.recSec + 1;
      this.setData({ recSec: s, recProgress: Math.min(100, Math.round(s / 60 * 100)) });
      if (s >= 60) this._rec.stop();
    }, 1000);
  },
  _stopTimer() { if (this._timer) { clearInterval(this._timer); this._timer = null; } },

  _readSample(filePath) {
    if (this.data.recSec < 10) {
      this.setData({ err: '录音太短，请录制至少 10 秒', hasSample: false, audioB64: '' });
      return;
    }
    this._sampleFile = filePath;
    wx.getFileSystemManager().readFile({
      filePath, encoding: 'base64',
      success: (r) => { this.setData({ audioB64: r.data, audioFormat: 'mp3', hasSample: true }); },
      fail: () => { this.setData({ err: '样音读取失败，请重录' }); }
    });
  },

  playSample() {
    if (!this._sampleFile) return;
    this._player.stop();
    this._player.src = this._sampleFile;
    this._player.play();
  },

  submitClone() {
    if (this.data.busy || this.data.recording || !this.data.hasSample) return;
    if (!this.data.voiceConsent) {
      this.setData({ err: '请先阅读并单独同意《声纹授权协议》' });
      return;
    }
    if (!this.data.slotId) { this.setData({ err: '缺少音色槽位，请先开通名额' }); return; }
    const name = (this.data.name || '我的声音').trim();
    this.setData({ busy: true, err: '' });

    api.request('/api/gen/audio/clone-vip', {
      method: 'POST', timeout: 60000,
      data: {
        slot_id: this.data.slotId,
        audio: this.data.audioB64,
        audio_format: this.data.audioFormat,
        name: name,
        voice_consent: true,
        voice_consent_version: VOICE_CONSENT_VERSION,
        voice_consent_at: this.data.voiceConsentAt
      }
    }).then((res) => {
      this.setData({ busy: false });
      const d = res.data || {};
      if (res.statusCode === 200 && d.ok) {
        this._updateSelectedSlot({ status: 'training', clone_error: '' });
        this.setData({ stage: 'training', trainSec: 0 });
        this.pollStatus(0);
      } else {
        this.setData({ err: d.detail || '提交失败，请重试' });
      }
    }).catch(() => { this.setData({ busy: false, err: '网络错误，请重试' }); });
  },

  pollStatus(n) {
    this.setData({ trainSec: n * 5 });
    this._pollTimer = setTimeout(() => {
      api.request('/api/gen/audio/clone-status?slot_id=' + encodeURIComponent(this.data.slotId), { method: 'GET' })
        .then((res) => {
          // 后端返回 {ok, result:{status, preview_url, clone_error, ...}}，状态嵌在 result 里
          const d = (res.data && res.data.result) || res.data || {};
          const previewUrl = d.preview_url || (d.voice && d.voice.preview_url) || '';
          if (d.status === 'ready' || previewUrl) {
            this._updateSelectedSlot({ status: 'ready', preview_url: previewUrl });
            this.setData({ stage: 'ready', previewUrl });
          } else if (d.status === 'failed') {
            this._updateSelectedSlot({ status: 'failed', clone_error: d.clone_error || '' });
            this.setData({ stage: 'failed', err: d.clone_error || '' });
          } else if (n >= CLONE_POLL_MAX) {
            this.setData({ stage: 'failed', err: '克隆超时，请稍后到配音页查看或重试' });
          } else {
            this.pollStatus(n + 1);
          }
        })
        .catch(() => { this.pollStatus(n + 1); });
    }, CLONE_POLL_INTERVAL);
  },

  playPreview() {
    if (!this.data.previewUrl) return;
    if (this.data.playing) { this._player.pause(); this.setData({ playing: false }); }
    else { this._player.src = this.data.previewUrl; this._player.play(); this.setData({ playing: true }); }
  },

  reclone() {
    this.setData({ stage: 'clone', hasSample: false, audioB64: '', recSec: 0, recProgress: 0, err: '', previewUrl: '', playing: false, voiceConsent: false, voiceConsentAt: '' });
  },

  goAudio() { wx.navigateTo({ url: '/pages/audio/audio' }); }
});
