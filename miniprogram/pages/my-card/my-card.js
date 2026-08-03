const api = require('../../utils/api.js');
const cardUtil = require('../../utils/card.js');
const invite = require('../../utils/invite.js');

function ownerState(data) {
  data = data || {};
  const card = data.card || {};
  return {
    card,
    initial: String(card.name || '黄').slice(0, 1),
    complete: cardUtil.isComplete(card),
    published: cardUtil.isPublished(card),
    wechatBound: !!(data.wechat_bound || card.wechat_bound),
    publicId: card.public_id || '',
    aiAccount: data.ai_account || card.ai_account || ''
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
    binding: false,
    shareReady: false,
    shareImageUrl: ''
  },

  onShow() {
    if (wx.hideShareMenu) wx.hideShareMenu();
    this.setData({ state: 'loading', error: '', binding: false, shareReady: false });
    if (api.getToken()) this.loadOwner();
    else this.loginByWechat();
  },

  loginByWechat() {
    cardUtil.wechatLoginCode().then((code) => api.request('/api/auth/miniprogram/card-login', {
      method: 'POST', data: { wx_code: code }
    })).then((res) => {
      const data = res.data || {};
      if (res.statusCode === 404 && data.code === 'card_unbound') {
        this.setData({ state: 'guest' });
        return;
      }
      if (res.statusCode !== 200 || !data.token) throw new Error(data.detail || '微信名片登录失败');
      api.setToken(data.token);
      if (data.card) this.showOwner(data);
      else this.loadOwner();
    }).catch((error) => this.setData({ state: 'error', error: error.message || '名片加载失败' }));
  },

  loadOwner() {
    api.request('/api/auth/card/me', { method: 'GET' }).then((res) => {
      const data = res.data || {};
      if (res.statusCode !== 200 || !data.card) throw new Error(data.detail || '名片读取失败');
      this.showOwner(data);
    }).catch((error) => this.setData({ state: 'error', error: error.message || '名片读取失败' }));
  },

  showOwner(data) {
    const next = ownerState(data);
    this.setData(Object.assign({ state: 'owner', error: '', shareReady: false, shareImageUrl: '' }, next), () => {
      if (!next.published || !invite.validInviteCode(next.card.invite_code)) return;
      cardUtil.prepareShareImage(this, next.card).then((imageUrl) => {
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
  openAccount() { wx.switchTab({ url: '/pages/profile/profile' }); },
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
