const api = require('../../utils/api.js');

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
    inviteLink: '',
    stats: {
      total_bound: 0,
      today_new: 0,
      valid_invites: 0,
      indirect_invites: 0
    },
    rewardTotal: 0,
    rewards: [],
    referrer: null
  },

  onShow() {
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
    this.setData({ loading: true, error: '' });
    return Promise.all([
      api.request('/api/auth/invite/code', { method: 'GET' }),
      api.request('/api/auth/invite/dashboard', { method: 'GET' }),
      api.request('/api/auth/invite/reward-points?limit=20&offset=0', { method: 'GET' }),
      api.request('/api/auth/invite/referrer', { method: 'GET' })
    ]).then((responses) => {
      const fallbackErrors = [
        '邀请码读取失败', '邀请统计读取失败', '奖励记录读取失败', '推荐人信息读取失败'
      ];
      responses.forEach((response, index) => {
        if (response.statusCode !== 200) {
          const body = response.data || {};
          throw new Error(body.detail || fallbackErrors[index]);
        }
      });
      const code = responses[0].data || {};
      const dashboard = responses[1].data || {};
      const rewards = responses[2].data || {};
      const referrer = responses[3].data || {};
      this.setData({
        loading: false,
        code: code.code || '',
        inviteLink: code.invite_link || '',
        stats: dashboard,
        rewardTotal: Number(rewards.total_reward_points || 0),
        rewards: (rewards.records || []).map(formatReward),
        referrer: referrer.referrer || null
      });
    }).catch((error) => {
      this.setData({ loading: false, error: error.message || '邀请数据读取失败' });
    });
  },

  copyCode() {
    if (!this.data.code) return;
    wx.setClipboardData({ data: this.data.code });
  },

  copyLink() {
    if (!this.data.inviteLink) return;
    wx.setClipboardData({ data: this.data.inviteLink });
  }
});
