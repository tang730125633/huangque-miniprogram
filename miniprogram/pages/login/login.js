const api = require('../../utils/api.js');

Page({
  data: {
    mode: 'login',
    username: '',
    password: '',
    loading: false,
    err: ''
  },
  onLoad() {
    // 已登录直接进主页
    if (api.getToken()) {
      wx.switchTab({ url: '/pages/home/home' });
    }
  },
  setMode(e) {
    this.setData({ mode: e.currentTarget.dataset.m, err: '' });
  },
  onUsername(e) { this.setData({ username: e.detail.value }); },
  onPassword(e) { this.setData({ password: e.detail.value }); },

  submit() {
    if (this.data.loading) return;
    const username = (this.data.username || '').trim();
    const password = this.data.password || '';
    if (!username || !password) {
      this.setData({ err: '请填写账号和密码' });
      return;
    }
    this.setData({ loading: true, err: '' });
    const path = this.data.mode === 'login' ? '/api/auth/miniprogram-login' : '/api/auth/miniprogram-register';

    api.request(path, { method: 'POST', data: { username: username, password: password } })
      .then((res) => {
        this.setData({ loading: false });
        const d = res.data || {};
        if (res.statusCode === 200) {
          const token = d.token || (d.user && d.user.token) || '';
          if (!token) {
            this.setData({ err: '登录成功，但后端未返回 token，请联系管理员。' });
            return;
          }
          api.setToken(token);
          const isRegister = this.data.mode === 'register';
          const isAdmin = d.user && d.user.role === 'admin';
          const points = (d.user && typeof d.user.points === 'number') ? d.user.points : null;
          if (isRegister) {
            // 注册成功 → 欢迎弹窗，点数读后端真实返回值（不写死）
            wx.showModal({
              title: '🎉 注册成功',
              content: points !== null
                ? ('已赠送 ' + points + ' 点新手体验额度，够免费作图约 ' + Math.max(1, Math.floor(points / 8)) + ' 次，快去试试吧！')
                : '已赠送新手体验额度，快去试试吧！',
              showCancel: false,
              confirmText: '开始作图',
              confirmColor: '#b048c8',
              success: () => { wx.switchTab({ url: '/pages/home/home' }); }
            });
          } else {
            // 管理员仍复用同一登录入口；登录成功后去「我的」展示管理中心入口。
            wx.switchTab({ url: isAdmin ? '/pages/profile/profile' : '/pages/home/home' });
          }
        } else {
          this.setData({ err: d.detail || ('请求失败（' + res.statusCode + '）') });
        }
      })
      .catch(() => {
        this.setData({ loading: false, err: '网络错误，请检查网络后重试' });
      });
  }
});
