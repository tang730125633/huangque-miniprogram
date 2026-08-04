const invite = require('./utils/invite.js');
const notifications = require('./utils/notifications.js');

App({
  globalData: {
    // 后端已备案域名 + HTTPS。若换环境改这里即可（末尾不要带 /）
    apiBase: 'https://huangquechuanmei.com',
    pendingInviteCode: '',
    redirectLegacyHomeLaunch: false
  },
  _captureInvite(options) {
    const code = invite.extractLaunchInvite(options);
    if (code) this.globalData.pendingInviteCode = code;
  },
  onLaunch(options) {
    const path = String(options && options.path || '').replace(/^\/+/, '');
    this.globalData.redirectLegacyHomeLaunch = path === 'pages/home/home';
    this._captureInvite(options);
  },
  onShow(options) {
    this._captureInvite(options);
    notifications.checkLatest();
  }
});
