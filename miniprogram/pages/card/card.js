const api = require('../../utils/api.js');
const invite = require('../../utils/invite.js');
const cardUtil = require('../../utils/card.js');

function cardView(source, includeEmpty) {
  const card = source || {};
  const privacy = cardUtil.privacy(card);
  const works = cardUtil.workSlots(card.works);
  const publicMedia = (items) => items.filter((item) => /^https:\/\//.test(String(item.url || '')));
  return Object.assign({}, card, {
    initial: String(card.name || '黄').slice(0, 1),
    tagsList: String(card.tags || '').split(/[,，\s]+/).filter(Boolean),
    showPhone: privacy.phone && !!card.phone,
    showEmail: privacy.email && !!card.email,
    showAddress: privacy.address && !!card.address,
    showQr: privacy.wechat_qr && !!card.wechat_qr,
    workImages: includeEmpty ? works.images : publicMedia(works.images),
    workVideos: includeEmpty ? works.videos : publicMedia(works.videos)
  });
}

function canShareCard(state) {
  return !!(state && state.isMine === true && state.shareReady === true);
}

Page({
  data: { loading: true, error: '', card: {}, isMine: false, ownerHint: false, joining: false, shareReady: false, shareImageUrl: '', publicId: '', inviteCode: '', attributionToken: '' },

  onShow() { if (this.data.joining) this.setData({ joining: false }); },

  onLoad(options) {
    if (wx.hideShareMenu) wx.hideShareMenu();
    const id = String((options && options.id) || '').trim();
    const code = invite.extractLaunchInvite({ query: options || {} });
    const ownerHint = String((options && options.mine) || '') === '1' || !id;
    this.setData({ publicId: id, inviteCode: code, isMine: false, ownerHint });
    if (ownerHint) this.loadOwnerPreview(id, code);
    else this.loadPublic(id, code);
  },

  loadOwnerPreview(id, code) {
    this._shareId = Number(this._shareId || 0) + 1;
    this.setData({ loading: true, error: '', isMine: false, shareReady: false });
    if (api.getToken()) return this.loadMine(id, code);
    if (id) { this.loadPublic(id, code); return Promise.resolve(); }
    this.setData({ loading: false, error: '请先登录后管理自己的名片。' });
    return Promise.resolve();
  },

  loadPublic(id, code) {
    this._shareId = Number(this._shareId || 0) + 1;
    if (wx.hideShareMenu) wx.hideShareMenu();
    this.setData({ loading: true, error: '', isMine: false, ownerHint: false, shareReady: false, attributionToken: '' });
    const query = '?id=' + encodeURIComponent(id) + (code ? '&invite=' + encodeURIComponent(code) : '');
    api.request('/api/auth/card/public' + query, { method: 'GET', auth: false }).then((res) => {
      const data = res.data || {};
      if (res.statusCode !== 200 || !(data.card || data.id || data.public_id)) throw new Error(data.detail || '名片不存在或已取消公开');
      // 归因只接受该公开页服务端的校验结果，URL 和本机时间都不能单独建立关系。
      const attributionToken = data.invite_attribution_token || data.attribution_token;
      const inviteValid = code && attributionToken && (data.invite_valid === true || (data.invite && data.invite.valid === true));
      if (inviteValid) {
        cardUtil.rememberValidInvite(code, attributionToken, data.invite_expires_at || data.attribution_expires_at, data.invite_validated_at || data.server_time);
      }
      const source = data.card || data;
      const card = cardView(source);
      this.setData({ loading: false, card: card, isMine: false, ownerHint: false, publicId: source.public_id || id, shareReady: false, shareImageUrl: '', attributionToken: inviteValid ? attributionToken : '' });
    }).catch((error) => this.setData({ loading: false, error: error.message || '名片加载失败' }));
  },

  loadMine(expectedId, code) {
    this._shareId = Number(this._shareId || 0) + 1;
    if (!api.getToken()) { this.setData({ loading: false, error: '请先登录后管理自己的名片。' }); return; }
    if (wx.hideShareMenu) wx.hideShareMenu();
    this.setData({ loading: true, error: '', shareReady: false });
    return api.request('/api/auth/card/me?create=0', { method: 'GET' }).then((res) => {
      const data = res.data || {};
      if (res.statusCode !== 200 || !data.card) throw new Error(data.detail || '你还没有完成名片');
      if (expectedId && data.card.public_id !== expectedId) { this.loadPublic(expectedId, code); return; }
      this.showMine(data.card);
    }).catch((error) => {
      if (expectedId) { this.loadPublic(expectedId, code); return; }
      this.setData({ loading: false, error: error.message || '名片读取失败' });
    });
  },

  showMine(source) {
    const shareReady = cardUtil.isPublished(source) && invite.validInviteCode(source.invite_code);
    const card = cardView(source, true);
    this.setData({ loading: false, card, isMine: true, ownerHint: true, shareReady: false, shareImageUrl: '', publicId: source.public_id || '' }, () => {
      if (shareReady) this.enableShare(card);
    });
  },

  goJoin() {
    if (this.data.joining) return;
    this.setData({ joining: true });
    if (this.data.attributionToken) {
      api.request('/api/auth/invite/journey/start', { method: 'POST', auth: false, data: { invite_attribution_token: this.data.attributionToken } }).catch(() => {});
    }
    wx.navigateTo({ url: '/pages/card-edit/card-edit?source=invite', fail: () => this.setData({ joining: false }) });
  },
  goEdit() { wx.navigateTo({ url: '/pages/card-edit/card-edit' }); },
  callPhone() {
    const phone = this.data.card && this.data.card.phone;
    if (phone && wx.makePhoneCall) wx.makePhoneCall({ phoneNumber: String(phone) });
  },
  previewQr() {
    const current = this.data.card && this.data.card.wechat_qr;
    if (current && wx.previewImage) wx.previewImage({ current, urls: [current] });
  },
  videoError() { if (wx.showToast) wx.showToast({ title: '视频暂时无法播放，请稍后重试', icon: 'none' }); },
  copyLink() { this.copyContact(this.data.card && this.data.card.links, '链接已复制'); },
  copyEmail() { this.copyContact(this.data.card && this.data.card.email, '邮箱已复制'); },
  copyContact(value, title) {
    if (!value || !wx.setClipboardData) return;
    wx.setClipboardData({ data: String(value), success: () => wx.showToast({ title, icon: 'success' }) });
  },
  retry() {
    if (this.data.ownerHint) this.loadOwnerPreview(this.data.publicId, this.data.inviteCode);
    else if (this.data.publicId) this.loadPublic(this.data.publicId, this.data.inviteCode);
    else this.loadOwnerPreview('', this.data.inviteCode);
  },
  enableShare(card) {
    if (this.data.isMine !== true) {
      this.setData({ shareReady: false, shareImageUrl: '' });
      if (wx.hideShareMenu) wx.hideShareMenu();
      return Promise.resolve(false);
    }
    const shareId = Number(this._shareId || 0) + 1;
    this._shareId = shareId;
    const publicId = this.data.publicId;
    return cardUtil.prepareShareImage(this, card).then((imageUrl) => {
      if (shareId !== this._shareId || publicId !== this.data.publicId || this.data.isMine !== true) return false;
      this.setData({ shareImageUrl: imageUrl, shareReady: true });
      if (wx.showShareMenu) wx.showShareMenu({ menus: ['shareAppMessage'] });
      return true;
    });
  },
  onShareAppMessage() {
    if (!canShareCard(this.data)) return { title: '黄雀 AI', path: '/pages/home/home', imageUrl: cardUtil.DEFAULT_SHARE_IMAGE };
    const id = this.data.publicId || this.data.card.public_id;
    if (!id) return { title: '黄雀 AI 公开名片', path: '/pages/card-edit/card-edit', imageUrl: cardUtil.DEFAULT_SHARE_IMAGE };
    return { title: (this.data.card.name || '我') + '的黄雀公开名片', path: invite.cardSharePath(id, this.data.card.invite_code), imageUrl: this.data.shareImageUrl };
  }
});

if (typeof module !== 'undefined') module.exports = { cardView, canShareCard };
