const api = require('../../utils/api.js');
const device = require('../../utils/device.js');
const invite = require('../../utils/invite.js');

Page({
  data: {
    mode: 'login',
    username: '',
    password: '',
    inviteCode: '',
    inviteHint: '',
    redirect: '',
    agreed: false,
    loading: false,
    err: ''
  },
  onLoad(options) {
    const redirect = api.loginRedirect(options && options.redirect);
    this.setData({ redirect });
    // 已登录直接进主页
    if (api.getToken()) {
      api.navigateAfterLogin(redirect);
      return;
    }
    const app = getApp();
    const launchCode = invite.extractLaunchInvite({ query: options || {} }) ||
      (app && app.globalData && app.globalData.pendingInviteCode) || '';
    if (launchCode) {
      this.setData({ mode: 'register', inviteCode: launchCode });
      this.validateInviteCode();
    }
  },
  setMode(e) {
    this.setData({ mode: e.currentTarget.dataset.m, err: '' });
  },
  onUsername(e) { this.setData({ username: e.detail.value }); },
  onPassword(e) { this.setData({ password: e.detail.value }); },
  onInviteCode(e) {
    this.setData({
      inviteCode: invite.normalizeInviteCode(e.detail.value),
      inviteHint: ''
    });
  },
  validateInviteCode() {
    const code = invite.normalizeInviteCode(this.data.inviteCode);
    if (!code) {
      this.setData({ inviteHint: '' });
      return Promise.resolve(true);
    }
    if (!invite.validInviteCode(code)) {
      this.setData({ inviteHint: '邀请码格式不正确' });
      return Promise.resolve(false);
    }
    return api.request('/api/auth/invite/validate?code=' + encodeURIComponent(code), {
      method: 'GET'
    }).then((res) => {
      const data = res.data || {};
      if (res.statusCode === 200 && data.inviter) {
        this.setData({
          inviteHint: '邀请人：' + (data.inviter.name || data.inviter.account_id || '黄雀用户')
        });
        return true;
      }
      this.setData({ inviteHint: data.detail || '邀请码当前不可用' });
      return false;
    }).catch(() => {
      this.setData({ inviteHint: '邀请码验证失败，请稍后重试' });
      return false;
    });
  },
  onAgreementChange(e) {
    const values = (e.detail && e.detail.value) || [];
    this.setData({ agreed: values.indexOf('accepted') !== -1, err: '' });
  },
  openPrivacyContract() {
    const fallback = () => wx.navigateTo({ url: '/pages/legal/legal?type=privacy' });
    if (!wx.openPrivacyContract) {
      fallback();
      return;
    }
    wx.openPrivacyContract({ fail: fallback });
  },

  submit() {
    if (this.data.loading) return;
    const username = (this.data.username || '').trim();
    const password = this.data.password || '';
    if (!username || !password) {
      this.setData({ err: '请填写账号和密码' });
      return;
    }
    if (!this.data.agreed) {
      this.setData({ err: '请先阅读并勾选《用户服务协议》和《隐私保护指引》' });
      return;
    }
    this.setData({ loading: true, err: '' });
    const path = this.data.mode === 'login' ? '/api/auth/miniprogram-login' : '/api/auth/miniprogram-register';

    const inviteCode = this.data.mode === 'register'
      ? invite.normalizeInviteCode(this.data.inviteCode) : '';
    if (inviteCode && !invite.validInviteCode(inviteCode)) {
      this.setData({ loading: false, err: '邀请码格式不正确' });
      return;
    }
    const payload = {
      username: username,
      password: password,
      device_id: device.getDeviceId()
    };
    if (inviteCode) payload.invite_code = inviteCode;
    api.request(path, { method: 'POST', data: payload })
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
            const app = getApp();
            if (app && app.globalData) app.globalData.pendingInviteCode = '';
            // 注册成功 → 欢迎弹窗，点数读后端真实返回值（不写死）
            wx.showModal({
              title: '🎉 注册成功',
              content: (d.invite_bound ? '邀请关系已绑定。' : '') + (points !== null
                ? ('已赠送 ' + points + ' 点新手体验额度，够免费作图约 ' + Math.max(1, Math.floor(points / 8)) + ' 次，快去试试吧！')
                : '已赠送新手体验额度，快去试试吧！'),
              showCancel: false,
              confirmText: '开始作图',
              confirmColor: '#b048c8',
              success: () => { api.navigateAfterLogin(this.data.redirect, '/pages/banana/banana'); }
            });
          } else {
            // 管理员仍复用同一登录入口；登录成功后去「我的」展示管理中心入口。
            api.navigateAfterLogin(this.data.redirect, isAdmin ? '/pages/profile/profile' : '/pages/home/home');
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
