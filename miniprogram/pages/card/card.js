const api = require('../../utils/api.js');
const invite = require('../../utils/invite.js');
const cardUtil = require('../../utils/card.js');

function cardView(source) {
  const card = source || {};
  const privacy = cardUtil.privacy(card);
  return Object.assign({}, card, {
    initial: String(card.name || '黄').slice(0, 1),
    tagsList: String(card.tags || '').split(/[,，\s]+/).filter(Boolean),
    showPhone: privacy.phone && !!card.phone,
    showEmail: privacy.email && !!card.email,
    showAddress: privacy.address && !!card.address,
    showQr: privacy.wechat_qr && !!card.wechat_qr
  });
}

Page({
  data: { loading: true, error: '', card: {}, isMine: false, publicId: '', inviteCode: '' },

  onLoad(options) {
    const id = String((options && options.id) || '').trim();
    const code = invite.extractLaunchInvite({ query: options || {} });
    this.setData({ publicId: id, inviteCode: code });
    if (id) this.loadPublic(id, code);
    else this.loadMine();
  },

  loadPublic(id, code) {
    this.setData({ loading: true, error: '' });
    const query = '?id=' + encodeURIComponent(id) + (code ? '&invite=' + encodeURIComponent(code) : '');
    api.request('/api/auth/card/public' + query, { method: 'GET' }).then((res) => {
      const data = res.data || {};
      if (res.statusCode !== 200 || !(data.card || data.id || data.public_id)) throw new Error(data.detail || '名片不存在或已取消公开');
      // 归因只接受该公开页服务端的校验结果，URL 和本机时间都不能单独建立关系。
      if (code && (data.invite_valid === true || (data.invite && data.invite.valid === true))) {
        cardUtil.rememberValidInvite(code, data.invite_validated_at || data.server_time);
      }
      const source = data.card || data;
      this.setData({ loading: false, card: cardView(source), publicId: source.public_id || id });
    }).catch((error) => this.setData({ loading: false, error: error.message || '名片加载失败' }));
  },

  loadMine() {
    if (!api.getToken()) { this.setData({ loading: false, error: '请通过他人分享的名片进入，或登录后管理自己的名片。' }); return; }
    this.setData({ loading: true, error: '' });
    api.request('/api/auth/card/me', { method: 'GET' }).then((res) => {
      const data = res.data || {};
      if (res.statusCode !== 200 || !data.card) throw new Error(data.detail || '你还没有完成名片');
      this.setData({ loading: false, card: cardView(data.card), isMine: true, publicId: data.card.public_id || '' });
    }).catch((error) => this.setData({ loading: false, error: error.message || '名片读取失败' }));
  },

  goJoin() { wx.navigateTo({ url: '/pages/card-edit/card-edit' }); },
  goEdit() { wx.navigateTo({ url: '/pages/card-edit/card-edit' }); },
  onShareAppMessage() {
    const id = this.data.publicId || this.data.card.public_id;
    if (!id) return { title: '黄雀 AI 公开名片', path: '/pages/card-edit/card-edit' };
    return { title: (this.data.card.name || '我') + '的黄雀公开名片', path: invite.cardSharePath(id, this.data.card.invite_code) };
  }
});

if (typeof module !== 'undefined') module.exports = { cardView };
