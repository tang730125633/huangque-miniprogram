const invite = require('./utils/invite.js');
const notifications = require('./utils/notifications.js');
const inviteRewards = require('./utils/invite-rewards.js');

function showStartupNotices() {
  return inviteRewards.showNextRewardNotice().then(() => notifications.checkLatest());
}

App({
  globalData: {
    // 后端已备案域名 + HTTPS。若换环境改这里即可（末尾不要带 /）
    apiBase: 'https://huangquechuanmei.com',
    pendingInviteCode: ''
  },
  _captureInvite(options) {
    const code = invite.extractLaunchInvite(options);
    if (code) this.globalData.pendingInviteCode = code;
  },
  onLaunch(options) {
    this._captureInvite(options);
  },
  onShow(options) {
    this._captureInvite(options);
    return showStartupNotices();
  }
});

if (typeof module !== 'undefined') module.exports = { showStartupNotices };
