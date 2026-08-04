const api = require('../../utils/api.js');
const membership = require('../../utils/membership.js');
const pricing = require('../../utils/pricing.js');

Page({
  data: {
    user: {},
    initial: '黄',
    isAdmin: false,
    membership: membership.buildMembershipView({}),
    membershipPriceYuan: null,
    membershipBonusPoints: null
  },

  onShow() {
    pricing.watch(this, (prices) => this.setData(pricing.commerce(prices)));
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar && tabBar.syncNavigation) tabBar.syncNavigation();
    if (!api.getToken()) {
      wx.switchTab({ url: '/pages/home/home', success: () => wx.navigateTo({ url: '/pages/login/login' }) });
      return;
    }
    this.refresh();
  },

  onHide() { pricing.stop(this); },
  onUnload() { pricing.stop(this); },

  refresh() {
    api.request('/api/auth/me', { method: 'GET' }).then((res) => {
      if (res.statusCode === 200 && res.data && res.data.user) {
        const user = res.data.user;
        const label = (user.name || user.display_name || user.username || '黄').trim();
        this.setData({
          user,
          initial: label.charAt(0).toUpperCase(),
          isAdmin: user.role === 'admin',
          membership: membership.buildMembershipView(user)
        });
      }
    }).catch(() => {});
  },

  goAssets() { wx.switchTab({ url: '/pages/assets/assets' }); },
  goAudio() { wx.navigateTo({ url: '/pages/audio/audio' }); },
  goClone() { wx.navigateTo({ url: '/pages/clone/clone' }); },
  goRecharge() { wx.navigateTo({ url: '/pages/recharge/recharge' }); },
  goCard() { wx.switchTab({ url: '/pages/my-card/my-card' }); },
  goNetwork() { wx.navigateTo({ url: '/pages/network/network' }); },
  goInvite() { wx.navigateTo({ url: '/pages/invite/invite' }); },
  goAdmin() {
    if (!this.data.isAdmin) return;
    wx.navigateTo({ url: '/pages/admin/admin' });
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出当前账号吗？',
      confirmColor: '#C2413A',
      success: (r) => {
        if (!r.confirm) return;
        api.request('/api/auth/logout', { method: 'POST' }).catch(() => {});
        api.clearToken();
        wx.reLaunch({ url: '/pages/login/login' });
      }
    });
  }
});
