const api = require('../../utils/api.js');
const device = require('../../utils/device.js');
const cardUtil = require('../../utils/card.js');

function blankCard() {
  return { avatar: '', name: '', title: '', company: '', bio: '', tags: '', links: '', email: '', address: '', phone: '', wechat_qr: '', privacy: cardUtil.privacy() };
}

function uploadMedia(filePath, field) {
  return new Promise((resolve, reject) => {
    const fs = wx.getFileSystemManager && wx.getFileSystemManager();
    if (!fs) { reject(new Error('当前微信版本不支持图片上传')); return; }
    fs.readFile({ filePath: filePath, encoding: 'base64', success: (result) => {
      api.request('/api/auth/card/media', { method: 'POST', data: { field: field, data: 'data:image/jpeg;base64,' + result.data }, timeout: 60000 })
        .then((res) => {
          const data = res.data || {};
          const url = data.url || (data.media && data.media.url);
          if (res.statusCode !== 200 || !url) throw new Error(data.detail || '图片上传失败');
          resolve(url);
        }).catch(reject);
    }, fail: () => reject(new Error('图片读取失败')) });
  });
}

Page({
  data: { step: 1, card: blankCard(), pendingMedia: {}, username: '', password: '', agreed: false, anonymous: true, loading: false, error: '', publicId: '' },
  onLoad() {
    if (!api.getToken()) return;
    this.setData({ anonymous: false, loading: true });
    api.request('/api/auth/card/me', { method: 'GET' }).then((res) => {
      const data = res.data || {};
      if (res.statusCode === 200 && data.card) this.setData({ card: Object.assign(blankCard(), data.card, { privacy: cardUtil.privacy(data.card) }), publicId: data.card.public_id || '' });
      this.setData({ loading: false });
    }).catch(() => this.setData({ loading: false }));
  },
  input(e) { this.setData({ ['card.' + e.currentTarget.dataset.field]: e.detail.value, error: '' }); },
  accountInput(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value, error: '' }); },
  setPrivacy(e) { this.setData({ ['card.privacy.' + e.currentTarget.dataset.field]: !!e.detail.value, error: '' }); },
  agreement(e) { this.setData({ agreed: ((e.detail && e.detail.value) || []).indexOf('yes') !== -1 }); },
  openPrivacyContract() {
    const fallback = () => wx.navigateTo({ url: '/pages/legal/legal?type=privacy' });
    if (!wx.openPrivacyContract) { fallback(); return; }
    wx.openPrivacyContract({ fail: fallback });
  },
  next() {
    if (!this.data.card.name.trim() || !this.data.card.title.trim() || !this.data.card.company.trim()) { this.setData({ error: '请填写姓名、职称和公司' }); return; }
    this.setData({ step: 2, error: '' });
  },
  previous() { this.setData({ step: 1, error: '' }); },
  chooseMedia(e) {
    const field = e.currentTarget.dataset.field;
    wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], success: (result) => {
      const media = result.tempFiles && result.tempFiles[0];
      if (!media || (media.fileType && media.fileType !== 'image')) { this.setData({ error: '只支持图片格式' }); return; }
      if (media.size > 5 * 1024 * 1024) { this.setData({ error: '请上传 5MB 以内的图片' }); return; }
      let filePath = media.tempFilePath;
      const proceed = () => {
        if (this.data.anonymous) {
          this.setData({ ['card.' + field]: filePath, ['pendingMedia.' + field]: filePath, error: '' });
          return;
        }
        this.setData({ loading: true, error: '' });
        uploadMedia(filePath, field).then((url) => this.setData({ ['card.' + field]: url, loading: false }))
          .catch((error) => this.setData({ loading: false, error: error.message || '图片上传失败' }));
      };
      if (wx.compressImage) wx.compressImage({ src: filePath, quality: 80, success: (compressed) => { filePath = compressed.tempFilePath || filePath; proceed(); }, fail: proceed });
      else proceed();
    }, fail: () => {} });
  },
  save() {
    if (this.data.loading || !cardUtil.isComplete(this.data.card)) { this.setData({ error: '请完成必填名片信息' }); return; }
    if (this.data.anonymous && (!this.data.username.trim() || !this.data.password || !this.data.agreed)) { this.setData({ error: '请设置账号、密码并同意协议' }); return; }
    this.setData({ loading: true, error: '' });
    const payload = cardUtil.cardPayload(this.data.card);
    const pendingMedia = this.data.pendingMedia || {};
    const attribution = cardUtil.lastValidAttribution();
    const request = this.data.anonymous
      ? api.request('/api/auth/miniprogram-register', { method: 'POST', data: { username: this.data.username.trim(), password: this.data.password, display_name: payload.name, device_id: device.getDeviceId(), card: payload, invite_code: attribution ? attribution.code : undefined, invite_attribution_token: attribution ? attribution.attribution_token : undefined } })
      : api.request('/api/auth/card/me', { method: 'PUT', data: payload });
    request.then((res) => {
      const data = res.data || {};
      if (res.statusCode !== 200) throw new Error(data.detail || '名片保存失败');
      if (this.data.anonymous) {
        const token = data.token || (data.user && data.user.token);
        if (!token) throw new Error('注册成功但未获得登录凭证');
        api.setToken(token);
      }
      const saved = Object.assign({}, payload, data.card || {});
      const finish = (card, warning) => {
        this.setData({ loading: false, anonymous: false, pendingMedia: {}, card: Object.assign({}, this.data.card, card), publicId: card.public_id || data.public_id || '', error: warning || '' });
        wx.showToast({ title: warning ? '文字名片已保存' : '名片已保存', icon: 'success' });
      };
      if (this.data.anonymous && Object.keys(pendingMedia).length) {
        this.uploadPendingMedia(saved, pendingMedia).then((updated) => finish(updated)).catch(() => finish(saved, '账号和文字名片已保存，请稍后重试图片'));
        return;
      }
      finish(saved);
    }).catch((error) => this.setData({ loading: false, error: error.message || '名片保存失败' }));
  },
  uploadPendingMedia(saved, pendingMedia) {
    const updated = Object.assign({}, saved);
    return Object.keys(pendingMedia).reduce((chain, field) => chain.then(() => uploadMedia(pendingMedia[field], field).then((url) => { updated[field] = url; })), Promise.resolve())
      .then(() => updated);
  },
  publish() {
    if (!api.getToken()) { this.save(); return; }
    this.setData({ loading: true, error: '' });
    api.request('/api/auth/card/publish', { method: 'POST' }).then((res) => {
      const data = res.data || {};
      if (res.statusCode !== 200 || !(data.public_id || (data.card && data.card.public_id))) throw new Error(data.detail || '公开名片失败');
      const id = data.public_id || data.card.public_id;
      this.setData({ loading: false, publicId: id });
      wx.redirectTo({ url: '/pages/card/card?id=' + encodeURIComponent(id) });
    }).catch((error) => this.setData({ loading: false, error: error.message || '公开名片失败' }));
  },
  unpublish() {
    if (!this.data.publicId || this.data.loading) return;
    wx.showModal({
      title: '取消公开名片', content: '取消后外部链接将无法访问，但名片资料会保留，之后可再次公开。', confirmText: '取消公开', confirmColor: '#C2413A',
      success: (result) => {
        if (!result.confirm) return;
        this.setData({ loading: true, error: '' });
        api.request('/api/auth/card/unpublish', { method: 'POST' }).then((res) => {
          const data = res.data || {};
          if (res.statusCode !== 200) throw new Error(data.detail || '取消公开失败');
          this.setData({ loading: false, publicId: '' });
          wx.showToast({ title: '已取消公开', icon: 'success' });
        }).catch((error) => this.setData({ loading: false, error: error.message || '取消公开失败' }));
      }
    });
  }
});

if (typeof module !== 'undefined') module.exports = { blankCard, uploadMedia };
