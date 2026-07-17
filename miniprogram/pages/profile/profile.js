const api = require('../../utils/api.js');

Page({
  data: {
    user: {},
    initial: '黄',
    isAdmin: false
  },

  onShow() {
    if (!api.getToken()) { wx.reLaunch({ url: '/pages/login/login' }); return; }
    this.refresh();
  },

  refresh() {
    api.request('/api/auth/me', { method: 'GET' }).then((res) => {
      if (res.statusCode === 200 && res.data && res.data.user) {
        const user = res.data.user;
        const label = (user.name || user.display_name || user.username || '黄').trim();
        this.setData({
          user,
          initial: label.charAt(0).toUpperCase(),
          isAdmin: user.role === 'admin'
        });
      }
    }).catch(() => {});
  },

  goAssets() { wx.switchTab({ url: '/pages/assets/assets' }); },
  goAudio() { wx.navigateTo({ url: '/pages/audio/audio' }); },
  goClone() { wx.navigateTo({ url: '/pages/clone/clone' }); },
  goRecharge() { wx.navigateTo({ url: '/pages/recharge/recharge' }); },
  goLegal(e) {
    const type = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.type) || 'privacy';
    wx.navigateTo({ url: '/pages/legal/legal?type=' + type });
  },
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
