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
    showPasswordReset: false,
    target: {},
    delta: '',
    reason: '',
    newPassword: '',
    confirmPassword: '',
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
    const userId = String(e.currentTarget.dataset.userId || '');
    const user = this.data.users.find((item) => String(item.id) === userId);
    if (!user) return;
    this.setData({ showAdjust: true, target: user, delta: '', reason: '' });
  },
  closeAdjust() {
    if (this.data.saving) return;
    this.setData({ showAdjust: false, target: {}, delta: '', reason: '' });
  },
  openPasswordReset(e) {
    const userId = String(e.currentTarget.dataset.userId || '');
    const user = this.data.users.find((item) => String(item.id) === userId);
    if (!user) return;
    this.setData({ showPasswordReset: true, target: user, newPassword: '', confirmPassword: '' });
  },
  closePasswordReset() {
    if (this.data.saving) return;
    this.setData({ showPasswordReset: false, target: {}, newPassword: '', confirmPassword: '' });
  },
  stopBubble() {},
  onDelta(e) { this.setData({ delta: e.detail.value }); },
  onReason(e) { this.setData({ reason: e.detail.value }); },
  onNewPassword(e) { this.setData({ newPassword: e.detail.value }); },
  onConfirmPassword(e) { this.setData({ confirmPassword: e.detail.value }); },

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
      content: (target.account || target.display_name) + '\n' + target.points + ' → ' + after + ' 点\n原因：' + reason,
      confirmText: '确认调整',
      confirmColor: delta > 0 ? '#e24ba0' : '#C2413A',
      success: (r) => { if (r.confirm) this.doAdjust(target.id, delta, reason); }
    });
  },

  doAdjust(userId, delta, reason) {
    this.setData({ saving: true });
    api.request('/api/admin/points/adjust', {
      method: 'POST',
      data: { user_id: userId, delta, reason }
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
  },

  submitPasswordReset() {
    if (this.data.saving) return;
    const password = this.data.newPassword || '';
    if (password.length < 6 || password.length > 128) {
      wx.showToast({ title: '临时密码需为 6–128 位', icon: 'none' });
      return;
    }
    if (password !== this.data.confirmPassword) {
      wx.showToast({ title: '两次输入的密码不一致', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '确认重置密码',
      content: (this.data.target.account || this.data.target.display_name) + '\n该用户的全部登录态会立即失效，下次登录必须改密。',
      confirmText: '确认重置',
      confirmColor: '#C2413A',
      success: (r) => { if (r.confirm) this.doPasswordReset(this.data.target.id, password); }
    });
  },

  doPasswordReset(userId, password) {
    this.setData({ saving: true });
    api.request('/api/admin/users/password/reset', {
      method: 'POST',
      data: { user_id: userId, new_password: password }
    }).then((res) => {
      const d = res.data || {};
      if (res.statusCode !== 200) throw new Error(d.detail || '密码重置失败');
      this.setData({ saving: false, showPasswordReset: false, target: {}, newPassword: '', confirmPassword: '' });
      wx.showToast({ title: '密码已重置', icon: 'success' });
      this.refreshAll();
    }).catch((err) => {
      this.setData({ saving: false });
      wx.showToast({ title: err.message || '密码重置失败', icon: 'none' });
    });
  }
});
