const api = require('../../utils/api.js');
const cardUtil = require('../../utils/card.js');
const drafts = require('../../utils/drafts.js');

const EDIT_DRAFT_KEY = 'hq_draft_card_edit_v1';
const MAX_WORK_VIDEO_BYTES = 20 * 1024 * 1024;

function editDraftKey(owner) {
  return drafts.scopedKey(EDIT_DRAFT_KEY, owner || 'account');
}

function blankCard() {
  return { avatar: '', name: '', title: '', company: '', bio: '', tags: '', links: '', email: '', address: '', phone: '', wechat_qr: '', works: [], privacy: cardUtil.privacy() };
}

function draftPatch(saved, owner) {
  if (!saved || !saved.card) return null;
  owner = String(owner || '');
  const savedOwner = String(saved.owner || '');
  const savedPhone = String(saved.card.phone || '');
  if ((savedOwner && savedOwner !== owner) || (!savedOwner && owner && savedPhone !== owner)) return null;
  const card = Object.assign(blankCard(), saved.card, { privacy: cardUtil.privacy(saved.card) });
  const draftWorks = [].concat(saved.workImages || [], saved.workVideos || [], saved.otherWorks || []);
  const works = cardUtil.workSlots(draftWorks.length ? draftWorks : card.works);
  return {
    card,
    workImages: works.images,
    workVideos: works.videos,
    otherWorks: works.other,
    pendingMedia: saved.pendingMedia || {}
  };
}

function uploadMediaRecord(filePath, field) {
  return new Promise((resolve, reject) => {
    const fs = wx.getFileSystemManager && wx.getFileSystemManager();
    const video = /^work_video_[1-3]$/.test(field);
    if (!fs) { reject(new Error('当前微信版本不支持媒体上传')); return; }
    fs.readFile({ filePath, encoding: 'base64', success: (result) => {
      api.request('/api/auth/card/media', { method: 'POST', data: { field, data: 'data:' + (video ? 'video/mp4' : 'image/jpeg') + ';base64,' + result.data }, timeout: video ? 120000 : 60000 })
        .then((res) => {
          const data = res.data || {};
          const url = data.url || (data.media && data.media.url);
          if (res.statusCode !== 200 || !url) throw new Error(data.detail || '媒体上传失败');
          resolve({ url, key: data.key || (data.media && data.media.key) || '', card: data.card || null });
        }).catch(reject);
    }, fail: () => reject(new Error('媒体读取失败')) });
  });
}

function uploadMedia(filePath, field) {
  return uploadMediaRecord(filePath, field).then((media) => media.url);
}

Page({
  data: {
    card: blankCard(),
    workImages: cardUtil.workSlots().images,
    workVideos: cardUtil.workSlots().videos,
    otherWorks: [],
    pendingMedia: {},
    hasCard: false,
    ready: false,
    loading: false,
    loadFailed: false,
    error: '',
    publicId: '',
    published: false,
    aiAccount: '',
    showPasswordForm: false,
    oldPassword: '',
    newPassword: '',
    confirmPassword: ''
  },

  onLoad() {
    if (!api.getToken()) {
      wx.redirectTo({ url: api.loginUrl('card-edit') });
      return;
    }
    this.loadOwner();
  },

  restoreDraft(owner) {
    const saved = drafts.load(editDraftKey(owner));
    return draftPatch(saved, owner);
  },

  saveDraft() {
    const owner = this.data.aiAccount;
    return drafts.save(editDraftKey(owner), {
      owner,
      card: this.data.card,
      workImages: this.data.workImages,
      workVideos: this.data.workVideos,
      otherWorks: this.data.otherWorks,
      pendingMedia: this.data.pendingMedia
    }, Object.keys(this.data.pendingMedia || {}).map((field) => this.data.pendingMedia[field]));
  },

  retryLoad() { if (!this.data.loading) this.loadOwner(); },

  loadOwner() {
    this.setData({ ready: false, loading: true, loadFailed: false, error: '' });
    return api.request('/api/auth/card/me?create=0', { method: 'GET' }).then((res) => {
      const data = res.data || {};
      if (res.statusCode === 404 && data.code === 'card_not_found') {
        return api.request('/api/auth/me', { method: 'GET' }).then((accountRes) => {
          const accountData = accountRes.data || {};
          const user = accountData.user || {};
          const owner = String(user.username || user.phone || user.id || '');
          if (accountRes.statusCode !== 200 || !owner) throw new Error(accountData.detail || '账号信息读取失败');
          this.showLoadedCard(blankCard(), false, owner);
        });
      }
      if (res.statusCode !== 200 || !data.card) throw new Error(data.detail || '名片读取失败');
      const card = Object.assign(blankCard(), data.card, { privacy: cardUtil.privacy(data.card) });
      const owner = String(data.ai_account || (data.user && data.user.username) || card.ai_account || card.phone || '');
      if (!owner) throw new Error('账号信息读取失败');
      this.showLoadedCard(card, true, owner);
    }).catch((error) => this.setData({ ready: false, loading: false, loadFailed: true, error: error.message || '名片读取失败' }));
  },

  showLoadedCard(card, hasCard, owner) {
    const works = cardUtil.workSlots(card.works);
    const restored = this.restoreDraft(owner);
    this.setData(Object.assign({
      card,
      workImages: works.images,
      workVideos: works.videos,
      otherWorks: works.other,
      publicId: card.public_id || '',
      published: cardUtil.isPublished(card),
      hasCard,
      aiAccount: owner,
      ready: true,
      loading: false,
      loadFailed: false
    }, restored || {}));
    if (restored && wx.showToast) wx.showToast({ title: '已恢复未保存内容', icon: 'none' });
  },

  busyGuard() {
    if (!this.data.loading) return false;
    if (wx.showToast) wx.showToast({ title: '正在处理，请稍候', icon: 'none' });
    return true;
  },

  mediaError(message) {
    this.setData({ loading: false, error: message });
    if (wx.showToast) wx.showToast({ title: message, icon: 'none' });
  },

  input(e) { if (!this.data.loading) this.setData({ ['card.' + e.currentTarget.dataset.field]: e.detail.value, error: '' }); },
  workTitleInput(e) {
    if (this.data.loading) return;
    const list = e.currentTarget.dataset.type === 'video' ? 'workVideos' : 'workImages';
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ [list + '[' + index + '].title']: e.detail.value, error: '' });
  },
  passwordInput(e) { if (!this.data.loading) this.setData({ [e.currentTarget.dataset.field]: e.detail.value, error: '' }); },
  setPrivacy(e) { if (!this.data.loading) this.setData({ ['card.privacy.' + e.currentTarget.dataset.field]: !!e.detail.value, error: '' }); },
  togglePasswordForm() { if (!this.data.loading) this.setData({ showPasswordForm: !this.data.showPasswordForm, error: '' }); },

  chooseMedia(e) {
    if (this.busyGuard()) return;
    const field = e.currentTarget.dataset.field;
    const workIndex = e.currentTarget.dataset.workIndex;
    wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'], sourceType: ['album', 'camera'], success: (result) => {
      const media = result.tempFiles && result.tempFiles[0];
      if (!media || (media.fileType && media.fileType !== 'image')) { this.mediaError('只支持图片格式'); return; }
      this.setData({ loading: true, error: '' });
      let filePath = media.tempFilePath;
      const proceed = () => {
        const fs = wx.getFileSystemManager && wx.getFileSystemManager();
        let size = Number(media.size || 0);
        try { if (fs && fs.statSync) size = Number(fs.statSync(filePath).size || size); } catch (_) {}
        if (size > 4 * 1024 * 1024) { this.mediaError('请上传 4MB 以内的图片'); return; }
        if (workIndex !== undefined) {
          const index = Number(workIndex);
          const workField = 'work_image_' + (index + 1);
          if (!this.data.hasCard) {
            drafts.persistFile(filePath).then((savedPath) => this.setData({ ['workImages[' + index + '].url']: savedPath, ['pendingMedia.' + workField]: savedPath, loading: false, error: '' }))
              .catch(() => this.mediaError('图片暂存失败，请重试'));
            return;
          }
          uploadMediaRecord(filePath, workField).then((uploaded) => this.setData({
            ['workImages[' + index + '].url']: uploaded.url,
            ['workImages[' + index + '].key']: uploaded.key,
            loading: false
          })).catch((error) => this.mediaError(error.message || '作品图片上传失败'));
          return;
        }
        if (!this.data.hasCard) {
          drafts.persistFile(filePath).then((savedPath) => this.setData({ ['card.' + field]: savedPath, ['pendingMedia.' + field]: savedPath, loading: false, error: '' }))
            .catch(() => this.mediaError('图片暂存失败，请重试'));
          return;
        }
        uploadMedia(filePath, field).then((url) => this.setData({ ['card.' + field]: url, loading: false }))
          .catch((error) => this.mediaError(error.message || '图片上传失败'));
      };
      if (wx.compressImage) wx.compressImage({ src: filePath, quality: 80, success: (compressed) => { filePath = compressed.tempFilePath || filePath; proceed(); }, fail: proceed });
      else proceed();
    }, fail: (error) => { if (!/cancel/i.test(String(error && error.errMsg))) this.mediaError('图片选择失败，请检查微信权限'); } });
  },

  chooseWorkVideo(e) {
    if (this.busyGuard()) return;
    const index = Number(e.currentTarget.dataset.workIndex);
    wx.chooseMedia({ count: 1, mediaType: ['video'], sourceType: ['album', 'camera'], maxDuration: 60, success: (result) => {
      const media = result.tempFiles && result.tempFiles[0];
      if (!media || (media.fileType && media.fileType !== 'video')) { this.mediaError('请选择 MP4 视频'); return; }
      const filePath = media.tempFilePath;
      const fs = wx.getFileSystemManager && wx.getFileSystemManager();
      let size = Number(media.size || 0);
      try { if (fs && fs.statSync) size = Number(fs.statSync(filePath).size || size); } catch (_) {}
      if (size > MAX_WORK_VIDEO_BYTES) { this.mediaError('请上传 20MB 以内的视频'); return; }
      this.setData({ loading: true, error: '' });
      const field = 'work_video_' + (index + 1);
      if (!this.data.hasCard) {
        drafts.persistFile(filePath).then((savedPath) => this.setData({ ['workVideos[' + index + '].url']: savedPath, ['pendingMedia.' + field]: savedPath, loading: false, error: '' }))
          .catch(() => this.mediaError('视频暂存失败，请重试'));
        return;
      }
      uploadMediaRecord(filePath, field).then((uploaded) => this.setData({
        ['workVideos[' + index + '].url']: uploaded.url,
        ['workVideos[' + index + '].key']: uploaded.key,
        loading: false
      })).catch((error) => this.mediaError(error.message || '作品视频上传失败'));
    }, fail: (error) => { if (!/cancel/i.test(String(error && error.errMsg))) this.mediaError('视频选择失败，请检查微信权限'); } });
  },

  videoError() { if (wx.showToast) wx.showToast({ title: '视频无法播放，请重新上传 MP4', icon: 'none' }); },

  save() {
    if (this.data.loading) return;
    if (!cardUtil.isComplete(this.data.card)) {
      this.setData({ error: cardUtil.validPhone(this.data.card.phone) ? '请填写姓名、职称和公司' : '请填写正确的 11 位手机号' });
      return;
    }
    const payload = cardUtil.cardPayload(Object.assign({}, this.data.card, {
      works: cardUtil.worksPayload(this.data.workImages, this.data.workVideos, this.data.otherWorks)
    }));
    if (!this.saveDraft()) {
      this.setData({ error: '本机存储空间不足，无法保护本次填写内容，请清理微信存储后重试' });
      return;
    }
    this.setData({ loading: true, error: '' });
    const pendingMedia = this.data.pendingMedia || {};
    api.request('/api/auth/card/me', { method: 'PUT', data: payload }).then((res) => {
      const data = res.data || {};
      if (res.statusCode !== 200) throw new Error(data.detail || '名片保存失败');
      const saved = Object.assign({}, payload, data.card || {});
      const finish = (card) => {
        const publicId = card.public_id || data.public_id || this.data.publicId || '';
        const published = cardUtil.isPublished(card);
        const works = cardUtil.workSlots(card.works);
        this.setData({
          loading: false,
          hasCard: true,
          pendingMedia: {},
          card: Object.assign({}, this.data.card, card),
          workImages: works.images,
          workVideos: works.videos,
          otherWorks: works.other,
          publicId,
          published,
          error: ''
        });
        drafts.clear(editDraftKey(this.data.aiAccount));
        if (published) { this.openCard(publicId, '修改已保存'); return; }
        this.publish();
      };
      if (!Object.keys(pendingMedia).length) { finish(saved); return; }
      this.uploadPendingMedia(saved, pendingMedia).then(finish).catch((error) => {
        this.setData({
          loading: false,
          hasCard: true,
          publicId: saved.public_id || data.public_id || this.data.publicId || '',
          error: '文字资料已保存；媒体上传失败，请点击保存重试：' + (error.message || '网络异常')
        });
      });
    }).catch((error) => this.setData({ loading: false, error: error.message || '名片保存失败' }));
  },

  uploadPendingMedia(saved, pendingMedia) {
    const updated = Object.assign({}, saved);
    return Object.keys(pendingMedia).reduce((chain, field) => chain.then(() => uploadMediaRecord(pendingMedia[field], field).then((media) => {
      if (media.card) Object.assign(updated, media.card);
      else updated[field] = media.url;
    })), Promise.resolve())
      .then(() => updated);
  },

  changePassword() {
    if (this.data.loading) return;
    const oldPassword = this.data.oldPassword;
    const newPassword = this.data.newPassword;
    if (!oldPassword || newPassword.length < 6 || newPassword !== this.data.confirmPassword) {
      this.setData({ error: !oldPassword ? '请填写当前密码' : (newPassword.length < 6 ? '新密码至少 6 位' : '两次新密码输入不一致') });
      return;
    }
    this.setData({ loading: true, error: '' });
    api.request('/api/auth/change_password', { method: 'POST', data: { old_password: oldPassword, new_password: newPassword } }).then((res) => {
      const data = res.data || {};
      if (res.statusCode !== 200) throw new Error(data.detail || '修改密码失败');
      wx.showModal({
        title: '密码已修改', content: '以后登录黄雀 AI 工作台时，请使用新密码。', showCancel: false, confirmText: '知道了',
        complete: () => this.setData({ loading: false, showPasswordForm: false, oldPassword: '', newPassword: '', confirmPassword: '' })
      });
    }).catch((error) => this.setData({ loading: false, error: error.message || '修改密码失败' }));
  },

  openCard(publicId, title) {
    if (!publicId) { this.setData({ error: '名片已保存，但公开编号读取失败，请重试' }); return; }
    wx.showToast({ title: title || '名片已公开', icon: 'success' });
    wx.redirectTo({ url: '/pages/card/card?id=' + encodeURIComponent(publicId) + '&mine=1' });
  },

  publish(warning) {
    if (!api.getToken()) { this.setData({ error: '请先登录再公开名片' }); return; }
    this.setData({ loading: true, error: '' });
    api.request('/api/auth/card/publish', { method: 'POST' }).then((res) => {
      const data = res.data || {};
      if (res.statusCode !== 200 || !(data.public_id || (data.card && data.card.public_id))) throw new Error(data.detail || '公开名片失败');
      const id = data.public_id || data.card.public_id;
      this.setData({ loading: false, publicId: id, published: true, card: Object.assign({}, this.data.card, data.card || {}) });
      this.openCard(id, warning ? '文字名片已公开' : '名片已公开');
    }).catch((error) => this.setData({ loading: false, published: false, error: (error.message || '公开名片失败') + '，名片资料已保存，请重试' }));
  },

  unpublish() {
    if (!this.data.publicId || this.data.loading) return;
    wx.showModal({
      title: '取消公开名片', content: '取消后外部链接将无法访问，但名片资料会保留。', confirmText: '取消公开', confirmColor: '#C2413A',
      success: (result) => {
        if (!result.confirm) return;
        this.setData({ loading: true, error: '' });
        api.request('/api/auth/card/unpublish', { method: 'POST' }).then((res) => {
          const data = res.data || {};
          if (res.statusCode !== 200) throw new Error(data.detail || '取消公开失败');
          this.setData({ loading: false, published: false });
          wx.showToast({ title: '已取消公开', icon: 'success' });
        }).catch((error) => this.setData({ loading: false, error: error.message || '取消公开失败' }));
      }
    });
  }
});

if (typeof module !== 'undefined') module.exports = { blankCard, uploadMedia, uploadMediaRecord, draftPatch, editDraftKey, EDIT_DRAFT_KEY };
