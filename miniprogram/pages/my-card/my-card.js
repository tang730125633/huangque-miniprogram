const api = require('../../utils/api.js');
const cardUtil = require('../../utils/card.js');
const invite = require('../../utils/invite.js');
const pricing = require('../../utils/pricing.js');
const notifications = require('../../utils/notifications.js');

function ownerState(data) {
  data = data || {};
  const card = data.card || {};
  const works = cardUtil.workSlots(card.works);
  return {
    card,
    initial: String(card.name || '黄').slice(0, 1),
    complete: cardUtil.isComplete(card),
    published: cardUtil.isPublished(card),
    wechatBound: !!(data.wechat_bound || card.wechat_bound),
    publicId: card.public_id || '',
    aiAccount: data.ai_account || card.ai_account || '',
    tagsList: String(card.tags || '').split(/[,，\s]+/).filter(Boolean),
    workImages: works.images,
    workVideos: works.videos
  };
}

Page({
  data: {
    state: 'loading',
    error: '',
    card: {},
    initial: '黄',
    complete: false,
    published: false,
    wechatBound: false,
    publicId: '',
    aiAccount: '',
    tagsList: [],
    workImages: [],
    workVideos: [],
    binding: false,
    shareReady: false,
    shareImageUrl: '',
    inviteRewardPoints: null
  },

  onShow() {
    pricing.watch(this, (prices) => this.setData({ inviteRewardPoints: pricing.commerce(prices).inviteRewardPoints }));
    const loadId = Number(this._loadId || 0) + 1;
    this._loadId = loadId;
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar && tabBar.syncNavigation) tabBar.syncNavigation();
    if (wx.hideShareMenu) wx.hideShareMenu();
    this.setData({ state: 'loading', error: '', binding: false, shareReady: false });
    this.loginByWechat(loadId);
  },

  onHide() { pricing.stop(this); },
  onUnload() { pricing.stop(this); },

  loginByWechat(loadId) {
    return cardUtil.loginCardSession().then((session) => {
      if (loadId && loadId !== this._loadId) return;
      if (session.state === 'guest') {
        this.setData({ state: 'guest' });
        return;
      }
      if (session.state === 'pending-bind') return this.loadOwner(loadId);
      const data = session.data;
      if (data.card) this.showOwner(data, loadId);
      else this.loadOwner(loadId);
    }).catch((error) => {
      if (!loadId || loadId === this._loadId) this.setData({ state: 'error', error: error.message || '名片加载失败' });
    });
  },

  loadOwner(loadId) {
    return api.request('/api/auth/card/me', { method: 'GET', cardAuth: true }).then((res) => {
      if (loadId && loadId !== this._loadId) return;
      const data = res.data || {};
      if (res.statusCode === 404 || (res.statusCode === 200 && !data.card)) {
        this.showOwner({ card: {}, wechat_bound: false }, loadId);
        return;
      }
      if (res.statusCode !== 200 || !data.card) throw new Error(data.detail || '名片读取失败');
      this.showOwner(data, loadId);
    }).catch((error) => {
      if (!loadId || loadId === this._loadId) this.setData({ state: 'error', error: error.message || '名片读取失败' });
    });
  },

  showOwner(data, loadId) {
    if (loadId && loadId !== this._loadId) return;
    const next = ownerState(data);
    notifications.checkLatest();
    this.setData(Object.assign({ state: 'owner', error: '', shareReady: false, shareImageUrl: '' }, next), () => {
      if (!next.published || !invite.validInviteCode(next.card.invite_code)) return;
      cardUtil.prepareShareImage(this, next.card).then((imageUrl) => {
        if ((loadId && loadId !== this._loadId) || this.data.publicId !== next.publicId) return;
        this.setData({ shareImageUrl: imageUrl, shareReady: true });
        if (wx.showShareMenu) wx.showShareMenu({ menus: ['shareAppMessage'] });
      });
    });
  },

  createCard() { wx.navigateTo({ url: '/pages/card-edit/card-edit?source=new' }); },
  loginExisting() { wx.navigateTo({ url: '/pages/login/login?redirect=my-card' }); },
  editCard() { wx.navigateTo({ url: '/pages/card-edit/card-edit' }); },
  openCard() {
    if (!this.data.publicId) return;
    wx.navigateTo({ url: '/pages/card/card?id=' + encodeURIComponent(this.data.publicId) + '&mine=1' });
  },
  openInvitePlanet() { wx.navigateTo({ url: '/pages/network/network' }); },
  openAccount() { wx.switchTab({ url: '/pages/profile/profile' }); },
  callPhone() {
    const phone = this.data.card && this.data.card.phone;
    if (phone && wx.makePhoneCall) wx.makePhoneCall({ phoneNumber: String(phone) });
  },
  openWechat() {
    const current = this.data.card && this.data.card.wechat_qr;
    if (current && wx.previewImage) { wx.previewImage({ current, urls: [current] }); return; }
    this.editCard();
  },
  videoError() { if (wx.showToast) wx.showToast({ title: '视频无法播放，请重新上传 MP4', icon: 'none' }); },
  retry() { this.onShow(); },

  bindAndEdit() {
    if (this.data.binding) return;
    if (!api.getToken()) { this.loginExisting(); return; }
    this.setData({ binding: true, error: '' });
    cardUtil.wechatLoginCode().then((code) => api.request('/api/auth/card/wechat/bind', {
      method: 'POST', data: { wx_code: code }
    })).then((res) => {
      const data = res.data || {};
      if (res.statusCode !== 200) throw new Error(data.detail || '微信授权失败');
      if (data.card_token) api.setCardToken(data.card_token);
      api.clearCardBindIntent();
      wx.navigateTo({ url: '/pages/card-edit/card-edit' });
    }).catch((error) => this.setData({ binding: false, error: error.message || '微信授权失败' }));
  },

  onShareAppMessage() {
    if (!this.data.shareReady) return { title: '黄雀 AI', path: '/pages/my-card/my-card', imageUrl: cardUtil.DEFAULT_SHARE_IMAGE };
    return {
      title: (this.data.card.name || '我') + '的黄雀公开名片',
      path: invite.cardSharePath(this.data.publicId, this.data.card.invite_code),
      imageUrl: this.data.shareImageUrl || cardUtil.DEFAULT_SHARE_IMAGE
    };
  }
});

if (typeof module !== 'undefined') module.exports = { ownerState };
