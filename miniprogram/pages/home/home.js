const api = require('../../utils/api.js');
const cardUtil = require('../../utils/card.js');

Page({
  data: {
    points: null,
    membershipActive: false,
    membershipEnforced: false,
    membershipReady: false,
    cardReady: false,
    videoEntryChecking: false,
    videoIp12PromptVisible: false,
    bannerCurrent: 0,
    bannerAutoplay: true,

    // 位图素材路径集中于此，便于 Codex 后续批量替换
    assets: {
      creativeSymbol: '/assets/home/creative-symbol.png',
      imageToolIcon: '/assets/home/image-tool-icon.png',
      videoAnalysisIcon: '/assets/home/video-analysis-icon.png',
      digitalHumanAvatar: '/assets/home/digital-human-avatar.png'
    },

    // 顶部轮播（可扩展）
    banners: [
      {
        id: 'video-mix',
        title: 'AI 营销混剪',
        sub: '多段素材，智能生成营销短片',
        image: '/assets/home/video-mix-banner.jpg',
        path: '/pages/video/video?mode=cinematic'
      },
      {
        id: 'role-transfer',
        title: '电影化身 · 动作模仿',
        sub: '你的形象照着参考视频演，一键生成',
        image: '/assets/home/role-transfer-banner.jpg',
        path: '/pages/video/video?mode=cinematic'
      }
    ],

    // 教程与创作案例
    tutorials: [
      { id: 't1', title: 'AI 灵感作图入门', image: '/assets/home/tutorial-image-creation.jpg', path: '/pages/banana/banana' },
      { id: 't2', title: '创作灵感案例', image: '/assets/home/tutorial-video-analysis.jpg', path: '/pages/inspiration/inspiration' },
      { id: 't3', title: '数字化 IP 制作', image: '/assets/home/tutorial-digital-human.jpg', path: '/pages/ip12/ip12' }
    ]
  },

  onShow() {
    // swiper 只在首页可见时运行，避免切到其它 tab 后后台定时切页造成卡顿。
    if (!this.data.bannerAutoplay) this.setData({ bannerAutoplay: true });
    if (api.getToken()) { this.setData({ membershipReady: false, cardReady: false }); this.refreshPoints(); }
    else this.setData({ points: null, membershipReady: false, cardReady: false });
  },

  onHide() {
    this._videoEntryCheckId = Number(this._videoEntryCheckId || 0) + 1;
    this.setData({ videoEntryChecking: false, videoIp12PromptVisible: false });
    if (this.data.bannerAutoplay) this.setData({ bannerAutoplay: false });
  },

  // 受保护功能：未登录先去登录
  _guardNav(path, onAllowed) {
    if (!api.getToken()) { wx.navigateTo({ url: api.loginUrl(path) }); return null; }
    if (!this.data.membershipReady) { wx.showToast({ title: '正在加载账号权益', icon: 'none' }); this.refreshPoints(); return null; }
    if (!this.data.cardReady) {
      wx.showToast({ title: '请先完善并绑定微信名片', icon: 'none' });
      wx.switchTab({ url: '/pages/my-card/my-card' });
      return null;
    }
    if (this.data.membershipEnforced && !this.data.membershipActive) {
      api.showMembershipRequired();
      return null;
    }
    if (typeof onAllowed === 'function') return onAllowed();
    return wx.navigateTo({ url: path });
  },

  // 最大卡 = 视频创作（核心业务）→ 视频生成模式
  onTapPrimaryCreation() {
    return this._guardNav('/pages/video/video?mode=generate', () => this.checkIp12BeforeVideo());
  },

  checkIp12BeforeVideo() {
    if (this.data.videoEntryChecking) return Promise.resolve(null);
    const checkId = Number(this._videoEntryCheckId || 0) + 1;
    this._videoEntryCheckId = checkId;
    this.setData({ videoEntryChecking: true });
    return api.request('/workbench/ip12/api/conversations', { method: 'GET' }).then((res) => {
      if (this._videoEntryCheckId !== checkId) return null;
      if (res.statusCode === 401) return null;
      if (res.statusCode !== 200) { this.continueToVideo(); return null; }
      const project = Array.isArray(res.data) && res.data[0];
      const completed = project && project.coach_state && project.coach_state.completed_modules || [];
      if (completed.indexOf(6) !== -1) this.continueToVideo();
      else this.setData({ videoIp12PromptVisible: true });
      return project || null;
    }).catch(() => {
      if (this._videoEntryCheckId !== checkId) return null;
      this.continueToVideo();
      return null;
    }).finally(() => {
      if (this._videoEntryCheckId === checkId) this.setData({ videoEntryChecking: false });
    });
  },

  continueToVideo() {
    this.setData({ videoIp12PromptVisible: false });
    wx.navigateTo({ url: '/pages/video/video?mode=generate' });
  },

  createIp12BeforeVideo() {
    this.setData({ videoIp12PromptVisible: false });
    wx.navigateTo({ url: '/pages/ip12/ip12' });
  },

  skipVideoIp12Prompt() { this.setData({ videoIp12PromptVisible: false }); },
  keepVideoIp12Prompt() {},
  // 右上卡 = 智能生图/改图 → 作图页
  onTapImageCreation() { this._guardNav('/pages/banana/banana'); },

  // 现有可体验的一键跟创页；未完成的视频拆解能力不再对外占位。
  onTapVideoAnalysis() { wx.switchTab({ url: '/pages/inspiration/inspiration' }); },

  // IP12 成长档案；旧口播功能仍在视频页，以“数字人口播”明确区分。
  onTapDigitalHuman() { this._guardNav('/pages/ip12/ip12'); },

  onBannerChange(e) {
    const current = Number(e.detail.current) || 0;
    // 不再把 current 反向绑定给 swiper，避免 change → setData → 重设 current 的反馈循环。
    if (current !== this.data.bannerCurrent) this.setData({ bannerCurrent: current });
  },

  onTapRoleTransfer(e) { this._guardNav(e.currentTarget.dataset.path || '/pages/video/video'); },

  onTapTutorial(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.tutorials.find((x) => x.id === id);
    if (!item || !item.path) return;
    if (item.path === '/pages/inspiration/inspiration') { wx.switchTab({ url: item.path }); return; }
    this._guardNav(item.path);
  },

  onTapPoints() {
    if (api.getToken()) wx.switchTab({ url: '/pages/profile/profile' });
    else wx.navigateTo({ url: '/pages/login/login' });
  },

  refreshPoints() {
    Promise.all([
      api.request('/api/auth/me', { method: 'GET' }),
      api.request('/api/auth/card/me', { method: 'GET' })
    ]).then(([res, cardRes]) => {
      if (res.statusCode === 200 && res.data && res.data.user && cardRes.statusCode === 200 && cardRes.data && cardRes.data.card) {
        const ownerCard = cardRes.data.card;
        this.setData({
          points: res.data.user.points,
          membershipActive: !!res.data.user.membership_active,
          membershipEnforced: !!res.data.membership_enforcement_enabled,
          membershipReady: true,
          cardReady: cardUtil.isComplete(ownerCard) && !!(cardRes.data.wechat_bound || ownerCard.wechat_bound)
        });
      }
    }).catch(() => {});
  }
});
