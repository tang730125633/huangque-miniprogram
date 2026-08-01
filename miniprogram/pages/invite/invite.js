const api = require('../../utils/api.js');
const invite = require('../../utils/invite.js');
const cardUtil = require('../../utils/card.js');

function formatReward(record) {
  return Object.assign({}, record, {
    title: (record.invitee_name || record.invitee_username || '邀请用户') +
      '升级为' + (record.invitee_level_name || '会员'),
    pointsText: '+' + Number(record.reward_points || 0) + ' 点'
  });
}

Page({
  data: {
    loading: true,
    error: '',
    code: '',
    stats: {
      total_bound: 0,
      today_new: 0,
      valid_invites: 0,
      indirect_invites: 0
    },
    rewardTotal: 0,
    rewards: [],
    referrer: null,
    shareReady: false,
    shareImageUrl: '',
    publicId: '',
    cardName: ''
  },

  onShow() {
    if (wx.hideShareMenu) wx.hideShareMenu();
    if (!api.getToken()) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  load() {
    const loadId = (this._loadId || 0) + 1;
    this._loadId = loadId;
    if (wx.hideShareMenu) wx.hideShareMenu();
    this.setData({ loading: true, error: '', shareReady: false });
    return Promise.all([
      api.request('/api/auth/invite/code', { method: 'GET' }),
      api.request('/api/auth/invite/dashboard', { method: 'GET' }),
      api.request('/api/auth/invite/reward-points?limit=20&offset=0', { method: 'GET' }),
      api.request('/api/auth/invite/referrer', { method: 'GET' }),
      api.request('/api/auth/card/me', { method: 'GET' })
    ]).then((responses) => {
      if (loadId !== this._loadId) return;
      const fallbackErrors = [
        '邀请码读取失败', '邀请统计读取失败', '奖励记录读取失败', '推荐人信息读取失败'
      ];
      responses.slice(0, 4).forEach((response, index) => {
        if (response.statusCode !== 200) {
          const body = response.data || {};
          throw new Error(body.detail || fallbackErrors[index]);
        }
      });
      const code = responses[0].data || {};
      const dashboard = responses[1].data || {};
      const rewards = responses[2].data || {};
      const referrer = responses[3].data || {};
      const cardResponse = responses[4];
      if (!cardResponse || cardResponse.statusCode !== 200) {
        const body = (cardResponse && cardResponse.data) || {};
        throw new Error(body.detail || '名片状态读取失败');
      }
      const card = cardResponse && cardResponse.statusCode === 200 && cardResponse.data && cardResponse.data.card;
      const publicId = card && card.public_id;
      const shareReady = !!publicId && cardUtil.isPublished(card) && invite.validInviteCode(code.code);
      this.setData({
        loading: false,
        code: code.code || '',
        stats: dashboard,
        rewardTotal: Number(rewards.total_reward_points || 0),
        rewards: (rewards.records || []).map(formatReward),
        referrer: referrer.referrer || null,
        shareReady: false,
        shareImageUrl: '',
        publicId: publicId || '',
        cardName: (card && card.name) || ''
      }, () => {
        if (shareReady) this.enableShare(card, loadId);
      });
    }).catch((error) => {
      if (loadId !== this._loadId) return;
      this.setData({ loading: false, error: error.message || '邀请数据读取失败' });
    });
  },

  copyCode() {
    if (!this.data.code) return;
    wx.setClipboardData({ data: this.data.code });
  },
  goCardEdit() { wx.navigateTo({ url: '/pages/card-edit/card-edit' }); },
  openMyCard() {
    if (!this.data.publicId) return;
    wx.navigateTo({ url: '/pages/card/card?id=' + encodeURIComponent(this.data.publicId) + '&mine=1' });
  },

  enableShare(card, loadId) {
    return cardUtil.prepareShareImage(this, card).then((imageUrl) => {
      if (loadId !== this._loadId) return;
      this.setData({ shareImageUrl: imageUrl, shareReady: true });
      if (wx.showShareMenu) wx.showShareMenu({ menus: ['shareAppMessage'] });
    });
  },

  onShareAppMessage() {
    if (!this.data.shareReady) {
      return { title: '黄雀 AI 邀请你注册', path: invite.registrationSharePath(this.data.code), imageUrl: cardUtil.DEFAULT_SHARE_IMAGE };
    }
    return {
      title: (this.data.cardName || '我') + '的黄雀公开名片',
      path: invite.cardSharePath(this.data.publicId, this.data.code),
      imageUrl: this.data.shareImageUrl
    };
  }
});
