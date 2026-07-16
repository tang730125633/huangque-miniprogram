const api = require('../../utils/api.js');

Page({
  data: {
    points: null,
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
      { id: 't2', title: '短视频创意拆解', image: '/assets/home/tutorial-video-analysis.jpg', path: '/pages/inspiration/inspiration', tab: true },
      { id: 't3', title: '数字化 IP 制作', image: '/assets/home/tutorial-digital-human.jpg', path: '/pages/video/video?mode=talking' }
    ]
  },

  onShow() {
    // swiper 只在首页可见时运行，避免切到其它 tab 后后台定时切页造成卡顿。
    if (!this.data.bannerAutoplay) this.setData({ bannerAutoplay: true });
    if (api.getToken()) this.refreshPoints();
    else this.setData({ points: null });
  },

  onHide() {
    if (this.data.bannerAutoplay) this.setData({ bannerAutoplay: false });
  },

  // 受保护功能：未登录先去登录
  _guardNav(path) {
    if (!api.getToken()) { wx.navigateTo({ url: '/pages/login/login' }); return; }
    wx.navigateTo({ url: path });
  },

  // 最大卡 = 视频创作（核心业务）→ 视频生成模式
  onTapPrimaryCreation() { this._guardNav('/pages/video/video?mode=generate'); },
  // 右上卡 = 智能生图/改图 → 作图页
  onTapImageCreation() { this._guardNav('/pages/banana/banana'); },

  // 暂无独立"视频拆解"页 → 提示即将上线（不误接视频生成页）
  onTapVideoAnalysis() { wx.showToast({ title: '功能即将上线', icon: 'none' }); },

  // 数字化 IP → 视频页 talking 模式
  onTapDigitalHuman() { this._guardNav('/pages/video/video?mode=talking'); },

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
    if (!api.getToken()) { wx.navigateTo({ url: '/pages/login/login' }); return; }
    if (item.tab) wx.switchTab({ url: item.path });
    else wx.navigateTo({ url: item.path });
  },

  onTapPoints() {
    if (api.getToken()) wx.switchTab({ url: '/pages/profile/profile' });
    else wx.navigateTo({ url: '/pages/login/login' });
  },

  refreshPoints() {
    api.request('/api/auth/me', { method: 'GET' }).then((res) => {
      if (res.statusCode === 200 && res.data && res.data.user) {
        this.setData({ points: res.data.user.points });
      }
    }).catch(() => {});
  }
});
