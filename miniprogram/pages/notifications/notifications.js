const api = require('../../utils/api.js');

const EVENT_TYPE = 'announcement';

function formatTime(value) {
  const date = new Date(Number(value || 0) * 1000);
  if (isNaN(date.getTime())) return '';
  const pad = (number) => String(number).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
    ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

Page({
  data: {
    loading: true,
    error: '',
    items: [],
    unreadCount: 0,
    subscriptionConfigured: false,
    subscriptionTemplateId: '',
    subscriptionRemaining: 0,
    subscriptionBusy: false
  },

  onShow() {
    if (!api.getToken()) { wx.navigateTo({ url: '/pages/login/login' }); return; }
    this.load();
  },

  onPullDownRefresh() { this.load(() => wx.stopPullDownRefresh()); },

  load(done) {
    this.setData({ loading: true, error: '' });
    Promise.all([
      api.request('/api/auth/notifications?limit=50', { method: 'GET' }),
      api.request('/api/auth/subscription/status', { method: 'GET' })
    ]).then(([noticeRes, statusRes]) => {
      if (noticeRes.statusCode !== 200) throw new Error((noticeRes.data && noticeRes.data.detail) || '消息读取失败');
      const raw = noticeRes.data && Array.isArray(noticeRes.data.items) ? noticeRes.data.items : [];
      const items = raw.map((item) => Object.assign({}, item, {
        timeText: formatTime(item.created_at), unread: !Number(item.read_at || 0)
      }));
      const events = statusRes.statusCode === 200 && statusRes.data && Array.isArray(statusRes.data.events)
        ? statusRes.data.events : [];
      const subscription = events.find((item) => item && item.event_type === EVENT_TYPE) || {};
      this.setData({
        loading: false,
        items,
        unreadCount: items.filter((item) => item.unread).length,
        subscriptionConfigured: !!subscription.configured,
        subscriptionTemplateId: subscription.template_id || '',
        subscriptionRemaining: Number(subscription.remaining || 0)
      });
    }).catch((error) => this.setData({ loading: false, error: error.message || '消息读取失败' }))
      .finally(() => { if (done) done(); });
  },

  openNotice(event) {
    const id = Number(event.currentTarget.dataset.id);
    const notice = this.data.items.find((item) => Number(item.id) === id);
    if (!notice) return;
    wx.showModal({ title: notice.title || '通知', content: notice.detail || '', showCancel: false });
    if (!notice.unread) return;
    api.request('/api/auth/notifications/' + encodeURIComponent(id) + '/read', {
      method: 'POST', data: {}
    }).then((res) => {
      if (res.statusCode !== 200) return;
      const items = this.data.items.map((item) => Number(item.id) === id
        ? Object.assign({}, item, { unread: false, read_at: Date.now() / 1000 }) : item);
      this.setData({ items, unreadCount: items.filter((item) => item.unread).length });
    }).catch(() => {});
  },

  markAllRead() {
    if (!this.data.unreadCount) return;
    api.request('/api/auth/notifications/read-all', { method: 'POST', data: {} }).then((res) => {
      if (res.statusCode !== 200) throw new Error('保存失败');
      this.setData({
        items: this.data.items.map((item) => Object.assign({}, item, { unread: false })),
        unreadCount: 0
      });
      wx.showToast({ title: '已全部标为已读' });
    }).catch(() => wx.showToast({ title: '保存失败，请重试', icon: 'none' }));
  },

  requestAnnouncementSubscription() {
    if (this.data.subscriptionBusy) return;
    const templateId = this.data.subscriptionTemplateId;
    if (!this.data.subscriptionConfigured || !templateId || !wx.requestSubscribeMessage) {
      wx.showToast({ title: '微信公告提醒暂未开通', icon: 'none' });
      return;
    }
    this.setData({ subscriptionBusy: true });
    new Promise((resolve, reject) => wx.requestSubscribeMessage({
      tmplIds: [templateId], success: resolve, fail: reject
    })).then((result) => {
      const choice = result && result[templateId];
      if (!['accept', 'reject', 'ban', 'filter'].includes(choice)) throw new Error('未取得订阅结果');
      return new Promise((resolve, reject) => wx.login({ success: resolve, fail: reject }))
        .then((login) => api.request('/api/auth/subscription/choices', {
          method: 'POST',
          data: { choices: { [EVENT_TYPE]: choice }, wx_code: login.code }
        })).then((res) => {
          if (res.statusCode !== 200) throw new Error((res.data && res.data.detail) || '订阅状态保存失败');
          const events = res.data && Array.isArray(res.data.events) ? res.data.events : [];
          const subscription = events.find((item) => item && item.event_type === EVENT_TYPE) || {};
          this.setData({ subscriptionRemaining: Number(subscription.remaining || 0) });
          wx.showToast({ title: choice === 'accept' ? '公告提醒已开启' : '未开启公告提醒', icon: 'none' });
        });
    }).catch(() => wx.showToast({ title: '订阅未完成，请稍后重试', icon: 'none' }))
      .finally(() => this.setData({ subscriptionBusy: false }));
  }
});

if (typeof module !== 'undefined') module.exports = { formatTime };
