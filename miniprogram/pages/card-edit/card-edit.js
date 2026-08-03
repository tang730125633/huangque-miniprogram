const api = require('../../utils/api.js');
const device = require('../../utils/device.js');
const cardUtil = require('../../utils/card.js');
const drafts = require('../../utils/drafts.js');

const EDIT_DRAFT_KEY = 'hq_draft_card_edit_v1';

function editDraftKey(owner) {
  return drafts.scopedKey(EDIT_DRAFT_KEY, owner || 'anonymous');
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
  const works = cardUtil.workSlots(card.works);
  return {
    card,
    workImages: Array.isArray(saved.workImages) ? saved.workImages : works.images,
    workVideos: Array.isArray(saved.workVideos) ? saved.workVideos : works.videos,
    otherWorks: Array.isArray(saved.otherWorks) ? saved.otherWorks : works.other,
    pendingMedia: saved.pendingMedia || {},
    agreed: !!saved.agreed
  };
}

function registrationNotice(data, payload) {
  const account = data.ai_account || (data.user && data.user.username) || payload.phone;
  if (data.created === false) {
    return { title: '已恢复原名片', content: '微信已绑定原黄雀 AI 账号 ' + account + '，已保存本次名片修改；不会重复注册或赠送点数。' };
  }
  return {
    title: '名片与黄雀 AI 已开通',
    content: '登录账号和初始密码均为 ' + account + '。' + (data.invite_rewarded ? '有效邀请奖励 100 点已到账。' : '本次未检测到有效邀请，不赠送邀请点数。') + ' 首次充值前请先修改密码。'
  };
}

function uploadMedia(filePath, field) {
  return new Promise((resolve, reject) => {
    const fs = wx.getFileSystemManager && wx.getFileSystemManager();
    if (!fs) { reject(new Error('当前微信版本不支持图片上传')); return; }
    fs.readFile({ filePath, encoding: 'base64', success: (result) => {
      api.request('/api/auth/card/media', { method: 'POST', data: { field, data: 'data:image/jpeg;base64,' + result.data }, timeout: 60000 })
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
  data: {
    card: blankCard(),
    workImages: cardUtil.workSlots().images,
    workVideos: cardUtil.workSlots().videos,
    otherWorks: [],
    pendingMedia: {},
    agreed: false,
    anonymous: true,
    loading: false,
    loadFailed: false,
    error: '',
    publicId: '',
    published: false,
    wechatBound: false,
    aiAccount: '',
    initialPassword: false,
    showPasswordForm: false,
    oldPassword: '',
    newPassword: '',
    confirmPassword: ''
  },

  onLoad() {
    if (!api.getToken()) {
      const restored = this.restoreDraft('');
      if (restored) this.setData(restored);
      return;
    }
    this.loadOwner();
  },

  restoreDraft(owner) {
    const saved = drafts.load(editDraftKey(owner)) || (owner ? drafts.load(editDraftKey('')) : null);
    return draftPatch(saved, owner);
  },

  saveDraft() {
    const owner = this.data.anonymous ? '' : this.data.aiAccount;
    return drafts.save(editDraftKey(owner), {
      owner,
      card: this.data.card,
      workImages: this.data.workImages,
      workVideos: this.data.workVideos,
      otherWorks: this.data.otherWorks,
      pendingMedia: this.data.pendingMedia,
      agreed: this.data.agreed
    }, []);
  },

  retryLoad() { this.loadOwner(); },

  loadOwner() {
    this.setData({ anonymous: false, loading: true, loadFailed: false, error: '' });
    api.request('/api/auth/card/me', { method: 'GET' }).then((res) => {
      const data = res.data || {};
      if (res.statusCode !== 200 || !data.card) throw new Error(data.detail || '名片读取失败');
      const card = Object.assign(blankCard(), data.card, { privacy: cardUtil.privacy(data.card) });
      const works = cardUtil.workSlots(card.works);
      const aiAccount = data.ai_account || card.ai_account || '';
      const restored = this.restoreDraft(aiAccount);
      this.setData(Object.assign({
        card,
        workImages: works.images,
        workVideos: works.videos,
        otherWorks: works.other,
        publicId: card.public_id || '',
        published: cardUtil.isPublished(card),
        wechatBound: !!(data.wechat_bound || card.wechat_bound),
        aiAccount,
        initialPassword: !!(data.initial_password || card.initial_password),
        loading: false,
        loadFailed: false
      }, restored || {}));
      if (restored && wx.showToast) wx.showToast({ title: '已恢复未保存内容', icon: 'none' });
    }).catch((error) => this.setData({ loading: false, loadFailed: true, error: error.message || '名片读取失败' }));
  },

  input(e) { this.setData({ ['card.' + e.currentTarget.dataset.field]: e.detail.value, error: '' }); },
  workTitleInput(e) {
    const list = e.currentTarget.dataset.type === 'video' ? 'workVideos' : 'workImages';
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ [list + '[' + index + '].title']: e.detail.value, error: '' });
  },
  passwordInput(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value, error: '' }); },
  setPrivacy(e) { this.setData({ ['card.privacy.' + e.currentTarget.dataset.field]: !!e.detail.value, error: '' }); },
  agreement(e) { this.setData({ agreed: ((e.detail && e.detail.value) || []).indexOf('yes') !== -1, error: '' }); },
  togglePasswordForm() { this.setData({ showPasswordForm: !this.data.showPasswordForm, error: '' }); },
  mediaComingSoon() { wx.showToast({ title: '作品媒体存储接口接入后开放', icon: 'none' }); },

  openPrivacyContract() {
    const fallback = () => wx.navigateTo({ url: '/pages/legal/legal?type=privacy' });
    if (!wx.openPrivacyContract) { fallback(); return; }
    wx.openPrivacyContract({ fail: fallback });
  },

  chooseMedia(e) {
    const field = e.currentTarget.dataset.field;
    wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], success: (result) => {
      const media = result.tempFiles && result.tempFiles[0];
      if (!media || (media.fileType && media.fileType !== 'image')) { this.setData({ error: '只支持图片格式' }); return; }
      if (media.size > 4 * 1024 * 1024) { this.setData({ error: '请上传 4MB 以内的图片' }); return; }
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

  ensureWechatBound() {
    if (this.data.wechatBound) return Promise.resolve();
    return cardUtil.wechatLoginCode().then((code) => api.request('/api/auth/card/wechat/bind', {
      method: 'POST', data: { wx_code: code }
    })).then((res) => {
      const data = res.data || {};
      if (res.statusCode !== 200) throw new Error(data.detail || '微信名片授权失败');
      this.setData({ wechatBound: true });
    });
  },

  registerCard(payload) {
    const attribution = cardUtil.lastValidAttribution();
    return cardUtil.wechatLoginCode().then((code) => api.request('/api/auth/miniprogram/card-register', {
      method: 'POST',
      data: {
        wx_code: code,
        phone: payload.phone,
        device_id: device.getDeviceId(),
        card: payload,
        invite_code: attribution ? attribution.code : undefined,
        invite_attribution_token: attribution ? attribution.attribution_token : undefined
      }
    })).then((res) => {
      const data = res.data || {};
      if (res.statusCode === 409 && data.code === 'account_exists') {
        throw new Error('该手机号已有黄雀 AI 账号，请先用原账号登录，再绑定微信名片');
      }
      if (res.statusCode !== 200 || !data.token) throw new Error(data.detail || '名片与黄雀 AI 开通失败');
      api.setToken(data.token);
      if (data.created !== false) return data;
      return api.request('/api/auth/card/me', { method: 'PUT', data: payload }).then((update) => {
        const updated = update.data || {};
        if (update.statusCode !== 200) throw new Error(updated.detail || '恢复账号后保存名片失败');
        return Object.assign({}, data, { card: updated.card || payload });
      });
    });
  },

  save() {
    if (this.data.loading) return;
    if (!cardUtil.isComplete(this.data.card)) {
      this.setData({ error: cardUtil.validPhone(this.data.card.phone) ? '请填写姓名、职称和公司' : '请填写正确的 11 位手机号' });
      return;
    }
    if (this.data.anonymous && !this.data.agreed) { this.setData({ error: '请先阅读并同意用户协议和隐私指引' }); return; }

    const payload = cardUtil.cardPayload(Object.assign({}, this.data.card, {
      works: cardUtil.worksPayload(this.data.workImages, this.data.workVideos, this.data.otherWorks)
    }));
    if (!this.saveDraft()) {
      this.setData({ error: '本机存储空间不足，无法保护本次填写内容，请清理微信存储后重试' });
      return;
    }
    this.setData({ loading: true, error: '' });
    const pendingMedia = this.data.pendingMedia || {};
    const wasAnonymous = this.data.anonymous;
    const request = wasAnonymous
      ? this.registerCard(payload)
      : this.ensureWechatBound().then(() => api.request('/api/auth/card/me', { method: 'PUT', data: payload })).then((res) => {
        const data = res.data || {};
        if (res.statusCode !== 200) throw new Error(data.detail || '名片保存失败');
        return data;
      });

    request.then((data) => {
      const saved = Object.assign({}, payload, data.card || {});
      const continueSave = () => {
        const finish = (card, warning) => {
          const publicId = card.public_id || data.public_id || this.data.publicId || '';
          const published = cardUtil.isPublished(card);
          this.setData({
            loading: false,
            anonymous: false,
            pendingMedia: warning ? pendingMedia : {},
            card: Object.assign({}, this.data.card, card),
            publicId,
            published,
            wechatBound: true,
            aiAccount: data.ai_account || (data.user && data.user.username) || this.data.aiAccount || payload.phone,
            initialPassword: data.initial_password === undefined ? wasAnonymous : !!data.initial_password,
            error: warning || ''
          });
          if (!warning) drafts.clear(editDraftKey(wasAnonymous ? '' : this.data.aiAccount));
          if (published) { this.openCard(publicId, warning ? '文字名片已保存' : '修改已保存'); return; }
          this.publish(warning);
        };
        if (wasAnonymous && Object.keys(pendingMedia).length) {
          this.uploadPendingMedia(saved, pendingMedia).then((updated) => finish(updated)).catch(() => finish(saved, '账号和文字名片已保存，请稍后重试图片'));
          return;
        }
        finish(saved);
      };

      if (!wasAnonymous) { continueSave(); return; }
      const notice = registrationNotice(data, payload);
      wx.showModal({
        title: notice.title,
        content: notice.content,
        showCancel: false,
        confirmText: '知道了',
        success: continueSave,
        fail: continueSave
      });
    }).catch((error) => this.setData({ loading: false, error: error.message || '名片保存失败' }));
  },

  uploadPendingMedia(saved, pendingMedia) {
    const updated = Object.assign({}, saved);
    return Object.keys(pendingMedia).reduce((chain, field) => chain.then(() => uploadMedia(pendingMedia[field], field).then((url) => { updated[field] = url; })), Promise.resolve())
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
      api.clearToken();
      wx.showModal({
        title: '密码已修改', content: '为保护账号，请使用新密码重新登录。', showCancel: false, confirmText: '重新登录',
        success: () => wx.reLaunch({ url: '/pages/login/login?redirect=my-card' })
      });
    }).catch((error) => this.setData({ loading: false, error: error.message || '修改密码失败' }));
  },

  openCard(publicId, title) {
    if (!publicId) { this.setData({ error: '名片已保存，但公开编号读取失败，请重试' }); return; }
    wx.showToast({ title: title || '名片已公开', icon: 'success' });
    wx.redirectTo({ url: '/pages/card/card?id=' + encodeURIComponent(publicId) + '&mine=1' });
  },

  publish(warning) {
    if (!api.getToken()) { this.setData({ error: '请先完成注册再公开名片' }); return; }
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

if (typeof module !== 'undefined') module.exports = { blankCard, uploadMedia, draftPatch, registrationNotice, editDraftKey, EDIT_DRAFT_KEY };
