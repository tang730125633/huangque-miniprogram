const api = require('../../utils/api.js');
const subscriptions = require('../../utils/subscriptions.js');

Page({
  data: {
    user: {},
    initial: '黄',
    isAdmin: false,
    notificationText: '正在读取…',
    notificationsConfigured: false
  },

  onShow() {
    if (!api.getToken()) { wx.reLaunch({ url: '/pages/login/login' }); return; }
    this.refresh();
    this.refreshNotifications();
  },

  refreshNotifications() {
    subscriptions.loadConfig().then((config) => {
      const events = config.events || [];
      const remaining = events.reduce((sum, item) => sum + Number(item.remaining || 0), 0);
      this.setData({
        notificationsConfigured: !!config.configured,
        notificationText: !config.configured ? '暂未配置' : (remaining > 0 ? ('已订阅 ' + remaining + ' 次') : '点击开启')
      });
    });
  },

  enableNotifications() {
    if (!this.data.notificationsConfigured) {
      wx.showToast({ title: '通知模板正在配置', icon: 'none' });
      this.refreshNotifications();
      return;
    }
    subscriptions.requestEvents(['work_complete', 'recharge_credited'])
      .then((result) => {
        if ((result.accepted || []).length) {
          wx.showToast({ title: '通知已开启', icon: 'success' });
        } else {
          wx.showToast({ title: '未开启新通知', icon: 'none' });
        }
        this.refreshNotifications();
      })
      .catch((err) => {
        wx.showModal({
          title: '通知未开启',
          content: (err && (err.errMsg || err.message)) || '请稍后重试',
          showCancel: false
        });
      });
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
