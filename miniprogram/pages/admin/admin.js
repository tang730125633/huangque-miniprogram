const api = require('../../utils/api.js');

function formatTime(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string' && !/^\d+$/.test(value)) return value.replace('T', ' ').slice(0, 19);
  const n = Number(value);
  const d = new Date(n < 1000000000000 ? n * 1000 : n);
  if (Number.isNaN(d.getTime())) return String(value);
  const pad = (x) => String(x).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
    pad(d.getHours()) + ':' + pad(d.getMinutes());
}

Page({
  data: {
    me: {},
    tab: 'users',
    query: '',
    users: [],
    total: 0,
    audits: [],
    loading: false,
    error: '',
    showAdjust: false,
    target: {},
    delta: '',
    reason: '',
    saving: false
  },

  onLoad() { this.bootstrap(); },
  onPullDownRefresh() {
    this.refreshAll().finally(() => wx.stopPullDownRefresh());
  },

  bootstrap() {
    if (!api.getToken()) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    api.request('/api/auth/me', { method: 'GET' }).then((res) => {
      const user = res.data && res.data.user;
      if (res.statusCode !== 200 || !user) throw new Error('无法读取登录信息');
      if (user.role !== 'admin') {
        wx.showModal({
          title: '无权访问',
          content: '当前账号不是管理员账号。',
          showCancel: false,
          success: () => wx.navigateBack()
        });
        return;
      }
      this.setData({ me: user });
      this.refreshAll();
    }).catch(() => this.setData({ error: '管理员身份校验失败，请重新登录' }));
  },

  refreshAll() {
    return Promise.all([this.loadUsers(), this.loadAudits()]);
  },

  setTab(e) { this.setData({ tab: e.currentTarget.dataset.tab }); },
  onQuery(e) { this.setData({ query: e.detail.value }); },
  searchUsers() { this.loadUsers(); },

  loadUsers() {
    this.setData({ loading: true, error: '' });
    const q = encodeURIComponent((this.data.query || '').trim());
    return api.request('/api/admin/users?q=' + q + '&sort=created_at&dir=desc&limit=120', { method: 'GET' })
      .then((res) => {
        const d = res.data || {};
        if (res.statusCode !== 200) throw new Error(d.detail || '用户列表加载失败');
        const users = (d.items || []).map((item) => Object.assign({}, item, {
          created_label: formatTime(item.created_at)
        }));
        this.setData({ users, total: Number(d.total || users.length), loading: false });
      })
      .catch((err) => this.setData({ loading: false, error: err.message || '用户列表加载失败' }));
  },

  loadAudits() {
    return api.request('/api/admin/points/audit?limit=80&actor=admin', { method: 'GET' })
      .then((res) => {
        const d = res.data || {};
        if (res.statusCode !== 200) throw new Error(d.detail || '流水加载失败');
        const audits = (d.items || []).map((item) => Object.assign({}, item, {
          time_label: formatTime(item.created_at),
          delta_label: Number(item.delta || 0) > 0 ? ('+' + item.delta) : String(item.delta || 0)
        }));
        this.setData({ audits });
      })
      .catch(() => {});
  },

  openAdjust(e) {
    const username = e.currentTarget.dataset.username;
    const user = this.data.users.find((item) => item.username === username);
    if (!user) return;
    this.setData({ showAdjust: true, target: user, delta: '', reason: '' });
  },
  closeAdjust() {
    if (this.data.saving) return;
    this.setData({ showAdjust: false, target: {}, delta: '', reason: '' });
  },
  stopBubble() {},
  onDelta(e) { this.setData({ delta: e.detail.value }); },
  onReason(e) { this.setData({ reason: e.detail.value }); },

  submitAdjust() {
    if (this.data.saving) return;
    const delta = Number(this.data.delta);
    const reason = (this.data.reason || '').trim();
    if (!Number.isInteger(delta) || delta === 0) {
      wx.showToast({ title: '请输入非零整数点数', icon: 'none' });
      return;
    }
    if (!reason) {
      wx.showToast({ title: '请填写调整原因', icon: 'none' });
      return;
    }
    const target = this.data.target;
    const after = Number(target.points || 0) + delta;
    if (after < 0) {
      wx.showToast({ title: '调整后点数不能为负数', icon: 'none' });
      return;
    }
    wx.showModal({
      title: delta > 0 ? '确认增加点数' : '确认扣减点数',
      content: target.username + '\n' + target.points + ' → ' + after + ' 点\n原因：' + reason,
      confirmText: '确认调整',
      confirmColor: delta > 0 ? '#e24ba0' : '#C2413A',
      success: (r) => { if (r.confirm) this.doAdjust(delta, reason); }
    });
  },

  doAdjust(delta, reason) {
    this.setData({ saving: true });
    api.request('/api/admin/points/adjust', {
      method: 'POST',
      data: { username: this.data.target.username, delta, reason }
    }).then((res) => {
      const d = res.data || {};
      if (res.statusCode !== 200) throw new Error(d.detail || '点数调整失败');
      const result = d.adjustment || {};
      this.setData({ saving: false, showAdjust: false, target: {}, delta: '', reason: '' });
      wx.showToast({ title: '已调整为 ' + result.after + ' 点', icon: 'success' });
      this.refreshAll();
    }).catch((err) => {
      this.setData({ saving: false });
      wx.showToast({ title: err.message || '点数调整失败', icon: 'none' });
    });
  }
});
