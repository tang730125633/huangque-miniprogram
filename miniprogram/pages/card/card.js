const api = require('../../utils/api.js');
const invite = require('../../utils/invite.js');
const cardUtil = require('../../utils/card.js');

function cardView(source) {
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
    workImages: publicMedia(works.images),
    workVideos: publicMedia(works.videos)
  });
}

Page({
  data: { loading: true, error: '', card: {}, isMine: false, shareReady: false, shareImageUrl: '', publicId: '', inviteCode: '', attributionToken: '' },

  onLoad(options) {
    if (wx.hideShareMenu) wx.hideShareMenu();
    const id = String((options && options.id) || '').trim();
    const code = invite.extractLaunchInvite({ query: options || {} });
    this.setData({ publicId: id, inviteCode: code, isMine: String((options && options.mine) || '') === '1' });
    if (id) this.loadPublic(id, code);
    else this.loadMine();
  },

  loadPublic(id, code) {
    if (wx.hideShareMenu) wx.hideShareMenu();
    this.setData({ loading: true, error: '', shareReady: false, attributionToken: '' });
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
      const shareReady = invite.validInviteCode(source.invite_code);
      const card = cardView(source);
      this.setData({ loading: false, card: card, publicId: source.public_id || id, shareReady: false, shareImageUrl: '', attributionToken: inviteValid ? attributionToken : '' }, () => {
        if (shareReady) this.enableShare(card);
      });
    }).catch((error) => this.setData({ loading: false, error: error.message || '名片加载失败' }));
  },

  loadMine() {
    if (!api.getToken()) { this.setData({ loading: false, error: '请通过他人分享的名片进入，或登录后管理自己的名片。' }); return; }
    if (wx.hideShareMenu) wx.hideShareMenu();
    this.setData({ loading: true, error: '', shareReady: false });
    api.request('/api/auth/card/me', { method: 'GET' }).then((res) => {
      const data = res.data || {};
      if (res.statusCode !== 200 || !data.card) throw new Error(data.detail || '你还没有完成名片');
      const shareReady = cardUtil.isPublished(data.card) && invite.validInviteCode(data.card.invite_code);
      const card = cardView(data.card);
      this.setData({ loading: false, card: card, isMine: true, shareReady: false, shareImageUrl: '', publicId: data.card.public_id || '' }, () => {
        if (shareReady) this.enableShare(card);
      });
    }).catch((error) => this.setData({ loading: false, error: error.message || '名片读取失败' }));
  },

  goJoin() {
    if (this.data.attributionToken) {
      api.request('/api/auth/invite/journey/start', { method: 'POST', auth: false, data: { invite_attribution_token: this.data.attributionToken } }).catch(() => {});
    }
    wx.navigateTo({ url: '/pages/card-edit/card-edit?source=invite' });
  },
  goEdit() { wx.navigateTo({ url: '/pages/card-edit/card-edit' }); },
  retry() {
    if (this.data.publicId) this.loadPublic(this.data.publicId, this.data.inviteCode);
    else this.loadMine();
  },
  enableShare(card) {
    cardUtil.prepareShareImage(this, card).then((imageUrl) => {
      this.setData({ shareImageUrl: imageUrl, shareReady: true });
      if (wx.showShareMenu) wx.showShareMenu({ menus: ['shareAppMessage'] });
    });
  },
  onShareAppMessage() {
    if (!this.data.shareReady) return { title: '黄雀 AI', path: '/pages/home/home', imageUrl: cardUtil.DEFAULT_SHARE_IMAGE };
    const id = this.data.publicId || this.data.card.public_id;
    if (!id) return { title: '黄雀 AI 公开名片', path: '/pages/card-edit/card-edit', imageUrl: cardUtil.DEFAULT_SHARE_IMAGE };
    return { title: (this.data.card.name || '我') + '的黄雀公开名片', path: invite.cardSharePath(id, this.data.card.invite_code), imageUrl: this.data.shareImageUrl };
  }
});

if (typeof module !== 'undefined') module.exports = { cardView };
