const api = require('../../utils/api.js');

const CLONE_POLL_INTERVAL = 5000;
const CLONE_POLL_MAX = 60; // 60 * 5s = 5 min

Page({
  data: {
    stage: 'loading',   // loading | no-slot | clone | training | ready | failed
    slotId: '',
    slotCost: 0,        // 后端 /slots 返回的槽位点数价格
    points: null,       // 当前点数（/slots 返回）
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
    playing: false
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
    if (this.data.stage === 'loading') this.loadSlots();
  },

  loadSlots() {
    api.request('/api/gen/audio/slots', { method: 'GET' }).then((res) => {
      const d = res.data || {};
      // 后端返回 {items, slot_count, slot_max, slot_cost, points}
      const slots = d.items || d.slots || (Array.isArray(d) ? d : []);
      this.setData({ slotCost: d.slot_cost || 0, points: (d.points == null ? null : d.points) });
      if (slots.length) {
        const slot = slots[0];
        this.setData({ slotId: slot.slot_id, name: slot.display_name || '我的声音' });
        if (slot.status === 'training') { this.setData({ stage: 'training' }); this.pollStatus(0); }
        else if (slot.status === 'ready') { this.setData({ stage: 'ready', previewUrl: slot.preview_url || '' }); }
        else { this.setData({ stage: 'clone' }); }
      } else {
        this.setData({ stage: 'no-slot' });
      }
    }).catch(() => { this.setData({ stage: 'no-slot' }); });
  },

  onName(e) { this.setData({ name: e.detail.value }); },

  // 兑换码入口已废弃（后端 redeem-slot 恒 410），槽位改为点数购买
  buySlot() {
    if (this.data.busy) return;
    this.setData({ busy: true, err: '' });
    api.request('/api/gen/audio/buy-slot', { method: 'POST', data: {} }).then((res) => {
      this.setData({ busy: false });
      const d = res.data || {};
      if (res.statusCode === 200 && d.ok && d.slot && d.slot.slot_id) {
        this.setData({ slotId: d.slot.slot_id, points: (d.points_left == null ? this.data.points : d.points_left), stage: 'clone', err: '' });
      } else if (res.statusCode === 402) {
        this.setData({ err: d.detail || ('点数不足，开通名额需 ' + (d.need || this.data.slotCost) + ' 点') });
      } else {
        this.setData({ err: d.detail || '开通失败，请稍后重试' });
      }
    }).catch(() => { this.setData({ busy: false, err: '网络错误，请重试' }); });
  },

  toggleRecord() {
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
    if (!this.data.slotId) { this.setData({ err: '缺少音色槽位，请先开通名额' }); return; }
    const name = (this.data.name || '我的声音').trim();
    this.setData({ busy: true, err: '' });

    api.request('/api/gen/audio/clone-vip', {
      method: 'POST', timeout: 60000,
      data: { slot_id: this.data.slotId, audio: this.data.audioB64, audio_format: this.data.audioFormat, name: name }
    }).then((res) => {
      this.setData({ busy: false });
      const d = res.data || {};
      if (res.statusCode === 200 && d.ok) {
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
          if (d.status === 'ready') {
            this.setData({ stage: 'ready', previewUrl: d.preview_url || '' });
          } else if (d.status === 'failed') {
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
    this.setData({ stage: 'clone', hasSample: false, audioB64: '', recSec: 0, recProgress: 0, err: '', previewUrl: '', playing: false });
  },

  goAudio() { wx.navigateTo({ url: '/pages/audio/audio' }); }
});
