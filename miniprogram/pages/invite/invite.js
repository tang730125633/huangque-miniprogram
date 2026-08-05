const api = require('../../utils/api.js');
const invite = require('../../utils/invite.js');
const cardUtil = require('../../utils/card.js');
const inviteRewards = require('../../utils/invite-rewards.js');

Page({
  data: {
    loading: true, loadingMore: false, error: '', code: '',
    stats: { total_bound: 0, today_new: 0, valid_invites: 0, indirect_invites: 0 },
    rewardTotal: 0, downlines: [], nextCursor: 0, serverTime: 0,
    canBrowseNetwork: false, referrer: null, shareReady: false,
    shareImageUrl: '', publicId: '', cardName: ''
  },

  onShow() {
    if (wx.hideShareMenu) wx.hideShareMenu();
    if (!api.getToken()) { wx.reLaunch({ url: '/pages/login/login' }); return; }
    this.load();
  },

  onUnload() { this.stopCountdown(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },

  load() {
    const loadId = (this._loadId || 0) + 1;
    this._loadId = loadId;
    this.stopCountdown();
    if (wx.hideShareMenu) wx.hideShareMenu();
    this.setData({ loading: true, error: '', shareReady: false });
    return Promise.all([
      api.request('/api/auth/invite/code', { method: 'GET' }),
      api.request('/api/auth/invite/dashboard', { method: 'GET' }),
      api.request('/api/auth/invite/downlines?limit=20&cursor=0', { method: 'GET' }),
      api.request('/api/auth/invite/referrer', { method: 'GET' }),
      api.request('/api/auth/card/me?create=0', { method: 'GET' })
    ]).then((responses) => {
      if (loadId !== this._loadId) return;
      const fallbackErrors = ['邀请码读取失败', '邀请统计读取失败', '下线数据读取失败', '推荐人信息读取失败', '名片状态读取失败'];
      responses.slice(0, 4).forEach((response, index) => {
        if (!response || response.statusCode !== 200) throw new Error((response && response.data && response.data.detail) || fallbackErrors[index]);
      });
      const cardResponse = responses[4];
      const cardMissing = cardResponse && cardResponse.statusCode === 404 && cardResponse.data && cardResponse.data.code === 'card_not_found';
      if (!cardResponse || (cardResponse.statusCode !== 200 && !cardMissing)) {
        throw new Error((cardResponse && cardResponse.data && cardResponse.data.detail) || fallbackErrors[4]);
      }
      const code = responses[0].data || {};
      const dashboard = responses[1].data || {};
      const downlines = responses[2].data || {};
      const referrer = responses[3].data || {};
      const card = cardResponse.statusCode === 200 && cardResponse.data && cardResponse.data.card;
      const publicId = card && card.public_id;
      const shareReady = !!publicId && cardUtil.isPublished(card) && invite.validInviteCode(code.code);
      this._rawDownlines = downlines.items || [];
      this.setData({
        loading: false, code: code.code || '', stats: dashboard,
        rewardTotal: Number(downlines.total_reward_points || 0),
        downlines: this._rawDownlines.map((item) => inviteRewards.downlineView(item, downlines.server_time)),
        nextCursor: Number(downlines.next_cursor || 0), serverTime: Number(downlines.server_time || 0),
        canBrowseNetwork: !!downlines.can_browse_network, referrer: referrer.referrer || null,
        shareReady: false, shareImageUrl: '', publicId: publicId || '', cardName: (card && card.name) || ''
      }, () => {
        this.startCountdown();
        if (shareReady) this.enableShare(card, loadId);
      });
    }).catch((error) => {
      if (loadId !== this._loadId) return;
      this.setData({ loading: false, error: error.message || '邀请数据读取失败' });
    });
  },

  startCountdown() {
    this.stopCountdown();
    this._serverTickAt = Date.now();
    this._countdownTimer = setInterval(() => {
      const now = this.data.serverTime + Math.floor((Date.now() - this._serverTickAt) / 1000);
      this.setData({ downlines: (this._rawDownlines || []).map((item) => inviteRewards.downlineView(item, now)) });
    }, 1000);
  },
  stopCountdown() { if (this._countdownTimer) clearInterval(this._countdownTimer); this._countdownTimer = null; },

  syncServerTime(value) {
    const serverTime = Number(value || 0);
    if (!serverTime) return Number(this.data.serverTime || 0);
    this._serverTickAt = Date.now();
    return serverTime;
  },

  loadMore() {
    if (!this.data.nextCursor || this.data.loadingMore) return;
    this.setData({ loadingMore: true });
    api.request('/api/auth/invite/downlines?limit=20&cursor=' + encodeURIComponent(this.data.nextCursor), { method: 'GET' }).then((res) => {
      const data = res.data || {};
      if (res.statusCode !== 200) throw new Error(data.detail || '下线数据加载失败');
      this._rawDownlines = (this._rawDownlines || []).concat(data.items || []);
      const serverTime = this.syncServerTime(data.server_time);
      this.setData({
        loadingMore: false, nextCursor: Number(data.next_cursor || 0), serverTime,
        downlines: this._rawDownlines.map((item) => inviteRewards.downlineView(item, serverTime))
      });
    }).catch((error) => this.setData({ loadingMore: false, error: error.message || '下线数据加载失败' }));
  },

  openDownline(e) {
    const grant = e.currentTarget.dataset.grant;
    if (!this.data.canBrowseNetwork || !grant) {
      wx.showModal({ title: '会员权益', content: '开通会员后可查看其他用户的上下线信息。', confirmText: '去开通', success: (result) => { if (result.confirm) wx.navigateTo({ url: '/pages/recharge/recharge' }); } });
      return;
    }
    wx.navigateTo({ url: '/pages/network/network?grant=' + encodeURIComponent(grant) });
  },

  openDownlineCard(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) { wx.showToast({ title: '该用户暂未创建名片', icon: 'none' }); return; }
    wx.navigateTo({ url: '/pages/card/card?id=' + encodeURIComponent(id) });
  },

  copyCode() { if (this.data.code) wx.setClipboardData({ data: this.data.code }); },
  goCardEdit() { wx.navigateTo({ url: '/pages/card-edit/card-edit' }); },
  promptCardInvite() {
    wx.showModal({
      title: '请先创建并公开名片',
      content: '公开名片后，好友可以先查看你的名片，再通过名片完成注册。',
      confirmText: '去创建',
      success: (result) => { if (result.confirm) this.goCardEdit(); }
    });
  },
  openMyCard() { if (this.data.publicId) wx.navigateTo({ url: '/pages/card/card?id=' + encodeURIComponent(this.data.publicId) + '&mine=1' }); },
  enableShare(card, loadId) {
    return cardUtil.prepareShareImage(this, card).then((imageUrl) => {
      if (loadId !== this._loadId) return;
      this.setData({ shareImageUrl: imageUrl, shareReady: true });
      if (wx.showShareMenu) wx.showShareMenu({ menus: ['shareAppMessage'] });
    });
  },
  onShareAppMessage(event) {
    const requestedType = event && event.target && event.target.dataset && event.target.dataset.shareType;
    const shareType = requestedType || (this.data.shareReady ? 'card' : 'link');
    if (shareType !== 'card' || !this.data.shareReady) return { title: '黄雀 AI 邀请你注册', path: invite.registrationSharePath(this.data.code), imageUrl: cardUtil.DEFAULT_SHARE_IMAGE };
    return { title: (this.data.cardName || '我') + '的黄雀公开名片', path: invite.cardSharePath(this.data.publicId, this.data.code), imageUrl: this.data.shareImageUrl };
  }
});
