const api = require('../../utils/api.js');
const cardUtil = require('../../utils/card.js');
const invite = require('../../utils/invite.js');
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
    publicId: card.public_id || '',
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
    publicId: '',
    tagsList: [],
    workImages: [],
    workVideos: [],
    shareReady: false,
    shareImageUrl: ''
  },

  onShow() {
    const loadId = Number(this._loadId || 0) + 1;
    this._loadId = loadId;
    if (wx.hideShareMenu) wx.hideShareMenu();
    this.setData({ state: 'loading', error: '', shareReady: false });
    if (!api.getToken()) {
      wx.redirectTo({ url: api.loginUrl('my-card') });
      return;
    }
    this.loadOwner(loadId);
  },

  loadOwner(loadId) {
    return api.request('/api/auth/card/me?create=0', { method: 'GET' }).then((res) => {
      if (loadId && loadId !== this._loadId) return;
      const data = res.data || {};
      if (res.statusCode === 404 && data.code === 'card_not_found') {
        this.setData({ state: 'missing', error: '', card: {}, publicId: '' });
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
  editCard() { wx.navigateTo({ url: '/pages/card-edit/card-edit' }); },
  openCard() {
    if (!this.data.publicId) return;
    wx.navigateTo({ url: '/pages/card/card?id=' + encodeURIComponent(this.data.publicId) + '&mine=1' });
  },
  openInvitePlanet() { wx.navigateTo({ url: '/pages/network/network' }); },
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
