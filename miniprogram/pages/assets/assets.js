const api = require('../../utils/api.js');

const TABS = [
  { key: 'image', name: '图片' },
  { key: 'audio', name: '音频' },
  { key: 'video', name: '视频' }
];

function promptOf(item) {
  if (!item) return '';
  const prompt = typeof item.prompt === 'string' ? item.prompt.trim() : '';
  if (prompt) return prompt;
  return typeof item.text === 'string' ? item.text.trim() : '';
}

Page({
  data: {
    tabs: TABS,
    tab: 'image',
    images: [],
    audios: [],
    videos: [],
    loading: false,
    playingId: '',
    promptOpen: false,
    activePrompt: '',
    activePromptTitle: ''
  },

  onLoad() {
    this._audio = wx.createInnerAudioContext();
    this._audio.onEnded(() => this.setData({ playingId: '' }));
    this._audio.onStop(() => this.setData({ playingId: '' }));
    this._audio.onError(() => this.setData({ playingId: '' }));
  },
  onUnload() { if (this._audio) this._audio.destroy(); },

  onShow() {
    if (!api.getToken()) { wx.reLaunch({ url: '/pages/login/login' }); return; }
    this.load();
  },

  onPullDownRefresh() { this.load(() => wx.stopPullDownRefresh()); },

  switchTab(e) {
    if (this._audio) this._audio.stop();
    this.setData({ tab: e.currentTarget.dataset.k, playingId: '' }, () => this.load());
  },

  load(done) {
    const tab = this.data.tab;
    let path = '/api/gen/history?limit=60';
    if (tab === 'audio') path = '/api/gen/audio/assets?limit=60';
    else if (tab === 'video') path = '/api/gen/video/assets?limit=60';

    this.setData({ loading: true });
    api.request(path, { method: 'GET' }).then((res) => {
      const items = (res.data && res.data.items) || [];
      if (tab === 'image') {
        const records = items.filter((it) => it.url).map((it, index) => {
          const prompt = promptOf(it);
          return {
            id: String(it.job_id || it.url) + ':' + index,
            url: api.absUrl(it.url),
            prompt,
            hasPrompt: Boolean(prompt)
          };
        }).filter((it) => it.url);
        Promise.all(records.map((item) => {
          if (item.url.indexOf('/api/gen/file/') === -1) return Promise.resolve(item);
          return api.downloadProtected(item.url)
            .then((url) => Object.assign({}, item, { url }))
            .catch(() => null);
        })).then((images) => {
          // 用户可能在下载期间切走 tab，避免旧请求覆盖当前页面状态。
          if (this.data.tab === 'image') this.setData({ images: images.filter(Boolean) });
        });
      } else if (tab === 'audio') {
        this.setData({
          audios: items.filter((it) => it.url).map((it) => ({
            id: String(it.job_id || it.url), url: api.absUrl(it.url), text: it.text || '配音作品'
          }))
        });
      } else {
        // 后端返回 video_url（可能是 COS 直链或受保护的 /api/gen/file/ 相对路径）
        // 和 image_file（封面文件名，受保护，需带 token 下载后才能显示）
        const videos = items.filter((it) => it.video_url).map((it) => {
          const prompt = promptOf(it);
          return {
            url: api.absUrl(it.video_url),
            cover: api.absUrl(it.image_url || it.cover_url || it.cover || ''),
            coverFile: it.image_file || '',
            text: it.text || '视频作品',
            prompt,
            hasPrompt: Boolean(prompt)
          };
        });
        this.setData({ videos }, () => this._loadCovers());
      }
      this.setData({ loading: false });
      if (done) done();
    }).catch(() => { this.setData({ loading: false }); if (done) done(); });
  },

  previewImage(e) {
    wx.previewImage({
      current: e.currentTarget.dataset.u,
      urls: this.data.images.map((item) => item.url).filter(Boolean)
    });
  },

  showPrompt(e) {
    const kind = e.currentTarget.dataset.kind;
    const index = Number(e.currentTarget.dataset.i);
    const items = kind === 'video' ? this.data.videos : this.data.images;
    const prompt = items[index] && items[index].prompt;
    if (!prompt) {
      wx.showToast({ title: '该作品没有提示词记录', icon: 'none' });
      return;
    }
    this.setData({
      promptOpen: true,
      activePrompt: prompt,
      activePromptTitle: kind === 'video' ? '视频提示词' : '图片提示词'
    });
  },

  closePrompt() {
    this.setData({ promptOpen: false, activePrompt: '', activePromptTitle: '' });
  },

  keepPromptOpen() {},

  copyPrompt() {
    if (!this.data.activePrompt) return;
    wx.setClipboardData({
      data: this.data.activePrompt,
      success: () => wx.showToast({ title: '提示词已复制' }),
      fail: () => wx.showToast({ title: '复制失败，请稍后重试', icon: 'none' })
    });
  },

  saveImage(e) {
    this._saveToAlbum(e.currentTarget.dataset.u, 'image');
  },

  saveVideo(e) {
    this._saveToAlbum(e.currentTarget.dataset.u, 'video');
  },

  _saveToAlbum(url, mediaType) {
    if (!url) return;
    wx.showLoading({ title: '保存中', mask: true });
    const save = (filePath) => {
      const method = mediaType === 'video' ? 'saveVideoToPhotosAlbum' : 'saveImageToPhotosAlbum';
      wx[method]({
        filePath,
        success: () => {
          wx.hideLoading();
          wx.showToast({ title: '已保存到相册' });
        },
        fail: (err) => {
          wx.hideLoading();
          const message = String((err && err.errMsg) || '');
          if (message.indexOf('auth deny') !== -1 || message.indexOf('authorize') !== -1) {
            this._showAlbumSettings();
            return;
          }
          wx.showToast({ title: '保存失败，请稍后重试', icon: 'none' });
        }
      });
    };
    if (url.indexOf('http') !== 0) {
      save(url);
      return;
    }
    api.downloadProtected(url)
      .then(save)
      .catch(() => {
        wx.hideLoading();
        wx.showToast({ title: '下载失败，请稍后重试', icon: 'none' });
      });
  },

  _showAlbumSettings() {
    wx.showModal({
      title: '需要相册权限',
      content: '请在设置中允许保存到相册后重试。',
      confirmText: '去设置',
      success: (res) => {
        if (res.confirm) wx.openSetting();
      }
    });
  },

  playAudio(e) {
    const id = e.currentTarget.dataset.id;
    const url = e.currentTarget.dataset.u;
    if (this.data.playingId === id) {
      this._audio.stop();
      this.setData({ playingId: '' });
      return;
    }
    this._audio.stop();
    this._audio.src = url;
    this._audio.play();
    this.setData({ playingId: id });
  },

  // 受保护封面：带 token 下载前 12 个到本地临时文件再显示（<image> 无法带请求头）
  _loadCovers() {
    const videos = this.data.videos || [];
    videos.slice(0, 12).forEach((v, i) => {
      if (v.cover || !v.coverFile) return;
      api.downloadProtected('/api/gen/file/' + v.coverFile)
        .then((tmp) => this.setData({ ['videos[' + i + '].cover']: tmp }))
        .catch(() => {});
    });
  },

  playVideo(e) {
    const url = e.currentTarget.dataset.u || '';
    // COS 直链可直接播；/api/gen/file/ 受保护视频要带 token 下载后用本地路径播
    if (url.indexOf('/api/gen/file/') === -1) {
      wx.previewMedia({ sources: [{ url, type: 'video' }] });
      return;
    }
    wx.showLoading({ title: '加载视频中…' });
    api.downloadProtected(url)
      .then((tmp) => { wx.hideLoading(); wx.previewMedia({ sources: [{ url: tmp, type: 'video' }] }); })
      .catch(() => { wx.hideLoading(); wx.showToast({ title: '视频加载失败，稍后重试', icon: 'none' }); });
  }
});
