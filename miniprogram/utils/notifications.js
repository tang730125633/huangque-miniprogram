const api = require('./api.js');

let checking = false;
let modalOpen = false;
const shown = {};

function eligible(item, now) {
  return item && item.kind === 'announcement' && !Number(item.read_at || 0) &&
    Number(item.popup_until || 0) >= now && Number(item.popup_snoozed_until || 0) <= now;
}

function checkLatest() {
  if (checking || modalOpen || !api.getToken() || !wx.showModal) return Promise.resolve();
  checking = true;
  return api.request('/api/auth/notifications?limit=20', { method: 'GET' }).then((res) => {
    const items = res.statusCode === 200 && res.data && Array.isArray(res.data.items) ? res.data.items : [];
    const now = Math.floor(Date.now() / 1000);
    const notice = items.find((item) => eligible(item, now) && !shown[item.id]);
    if (!notice) return;
    shown[notice.id] = true;
    modalOpen = true;
    wx.showModal({
      title: notice.title || '平台公告',
      content: notice.detail || '',
      confirmText: '我知道了',
      cancelText: '稍后提醒',
      confirmColor: '#b048c8',
      success(result) {
        const action = result.confirm ? 'read' : 'snooze-today';
        api.request('/api/auth/notifications/' + encodeURIComponent(notice.id) + '/' + action, {
          method: 'POST', data: {}
        }).catch(() => {});
      },
      complete() { modalOpen = false; }
    });
  }).catch(() => {}).finally(() => { checking = false; });
}

module.exports = { checkLatest, eligible };
