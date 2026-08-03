const api = require('./api.js');

const TIER_NAMES = { experience: '体验官', partner: '合伙人', initiator: '发起人' };
let noticePromise = null;

function countdownText(expiresAt, now) {
  const seconds = Math.max(0, Number(expiresAt || 0) - Number(now || Math.floor(Date.now() / 1000)));
  if (!seconds) return '已到期';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (days) return days + '天' + hours + '小时后到期';
  if (hours) return hours + '小时' + minutes + '分后到期';
  return minutes + '分' + String(secs).padStart(2, '0') + '秒后到期';
}

function rewardStatusText(item, now) {
  item = item || {};
  const points = Number(item.reward_points || 0);
  if (item.reward_status === 'pending_upgrade') {
    return '待升级领取 ' + points + ' 点 · ' + countdownText(item.reward_expires_at, now);
  }
  if (item.reward_status === 'credited' || item.reward_status === 'recorded') {
    return '已到账 ' + points + ' 点';
  }
  if (item.reward_status === 'transferred') return '已转给符合条件的上级';
  if (item.reward_status === 'voided') return '奖励已作废';
  if (item.reward_status === 'no_recipient') return '无符合条件的领取人';
  return '暂无奖励';
}

function downlineView(item, serverTime) {
  item = item || {};
  return Object.assign({}, item, {
    membership_name: item.membership_name || TIER_NAMES[item.membership_tier] || '非会员',
    reward_text: rewardStatusText(item, serverTime)
  });
}

function noticeCopy(notice) {
  notice = notice || {};
  const type = notice.notice_type || notice.type;
  const points = Number(notice.total_points === undefined ? notice.reward_points : notice.total_points) || 0;
  if (type === 'reward_unlocked') {
    return {
      title: '升级成功，邀请奖励已解锁',
      content: points > 0 ? points + ' 点邀请奖励已自动到账' : '邀请权益已自动发放'
    };
  }
  const tier = TIER_NAMES[notice.required_tier] || '对应会员等级';
  return {
    title: '你有一笔邀请奖励待领取',
    content: '在有效期内升级为' + tier + '即可自动领取' + (points > 0 ? ' ' + points + ' 点奖励' : '邀请权益') + '。'
  };
}

function acknowledge(id) {
  if (!id) return Promise.resolve();
  return api.request('/api/auth/invite/notices/' + encodeURIComponent(id) + '/read', { method: 'POST', data: {} });
}

function showNextRewardNotice(options) {
  options = options || {};
  if (!api.getToken() || typeof wx === 'undefined' || !wx.showModal) return Promise.resolve(null);
  if (noticePromise) return noticePromise;
  noticePromise = api.request('/api/auth/invite/notices/next', { method: 'GET' }).then((res) => {
    const notice = res.statusCode === 200 && res.data && res.data.notice;
    if (!notice) return null;
    const copy = noticeCopy(notice);
    return new Promise((resolve) => {
      wx.showModal({
        title: copy.title,
        content: copy.content,
        confirmText: '查看我的下线',
        cancelText: '知道了',
        success(result) {
          acknowledge(notice.id).finally(() => {
            if (result.confirm && options.navigate !== false) wx.navigateTo({ url: '/pages/invite/invite' });
            resolve(notice);
          });
        },
        fail() { resolve(notice); }
      });
    });
  }).catch(() => null).finally(() => { noticePromise = null; });
  return noticePromise;
}

module.exports = { countdownText, rewardStatusText, downlineView, noticeCopy, showNextRewardNotice };
