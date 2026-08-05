const api = require('../../utils/api.js');
const device = require('../../utils/device.js');
const invite = require('../../utils/invite.js');
const inviteContext = require('../../utils/invite-context.js');

Page({
  data: {
    mode: 'login',
    username: '',
    password: '',
    redirect: '',
    inviteRequired: false,
    inviteValidating: false,
    inviteError: '',
    inviterName: '',
    agreed: false,
    loading: false,
    err: ''
  },
  onLoad(options) {
    options = options || {};
    const redirect = api.loginRedirect(options && options.redirect);
    this.setData({ redirect });
    const launchCode = invite.extractLaunchInvite({ query: options });
    const pending = inviteContext.current();
    if (api.getToken()) {
      if (launchCode || pending || options.source === 'card') {
        inviteContext.clear();
        wx.switchTab({ url: '/pages/home/home' });
      } else {
        api.navigateAfterLogin(redirect, '/pages/home/home');
      }
      return Promise.resolve();
    }
    if (launchCode) return this.validateLinkInvite(launchCode);
    if (pending) {
      this.setData({
        mode: 'register', inviteRequired: true, inviteValidating: false,
        inviteError: '', inviterName: pending.inviter.name || '黄雀用户'
      });
      return Promise.resolve();
    }
    if (options.mode === 'register') this.setData({ mode: 'register' });
    return Promise.resolve();
  },
  validateLinkInvite(code) {
    this.setData({
      mode: 'register', inviteRequired: true, inviteValidating: true,
      inviteError: '', inviterName: ''
    });
    return api.request('/api/auth/invite/validate?code=' + encodeURIComponent(code), {
      method: 'GET', auth: false
    }).then((res) => {
      const data = res.data || {};
      if (res.statusCode !== 200 || !data.inviter || !inviteContext.saveLink(data)) {
        throw new Error(data.detail || '邀请已失效，请重新打开分享链接');
      }
      this.setData({
        inviteValidating: false, inviteError: '',
        inviterName: data.inviter.name || '黄雀用户'
      });
    }).catch(() => {
      inviteContext.clear();
      this.setData({
        inviteValidating: false,
        inviteError: '邀请已失效，请重新打开分享链接',
        inviterName: ''
      });
    });
  },
  setMode(e) {
    const mode = e.currentTarget.dataset.mode === 'register' ? 'register' : 'login';
    this.setData({ mode, err: '' });
  },
  onUsername(e) { this.setData({ username: e.detail.value }); },
  onPassword(e) { this.setData({ password: e.detail.value }); },
  close() {
    if (this.data && this.data.loading) return;
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.switchTab({ url: '/pages/home/home' });
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
    if (this.data.loading || this.data.inviteValidating) return Promise.resolve();
    const username = (this.data.username || '').trim();
    const password = this.data.password || '';
    if (!username || !password) {
      this.setData({ err: '请填写账号和密码' });
      return Promise.resolve();
    }
    if (!this.data.agreed) {
      this.setData({ err: '请先阅读并勾选《用户服务协议》和《隐私保护指引》' });
      return Promise.resolve();
    }
    const isRegister = this.data.mode === 'register';
    const pending = inviteContext.current();
    if (isRegister && this.data.inviteRequired && (this.data.inviteError || !pending)) {
      this.setData({ err: '邀请已失效，请重新打开分享链接' });
      return Promise.resolve();
    }
    this.setData({ loading: true, err: '' });
    const path = isRegister ? '/api/auth/miniprogram-register' : '/api/auth/miniprogram-login';
    const payload = { username, password, device_id: device.getDeviceId() };
    if (isRegister && pending) Object.assign(payload, inviteContext.registrationPayload());
    return api.request(path, {
      method: 'POST', data: payload
    })
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
          if (isRegister) {
            const inviterName = (d.inviter && d.inviter.name) || (pending && pending.inviter.name) || '';
            inviteContext.clear();
            const content = d.invite_bound && inviterName
              ? '你已通过“' + inviterName + '”的邀请加入黄雀 AI。'
              : '账号已创建，欢迎加入黄雀 AI。';
            wx.showModal({
              title: '注册成功', content, showCancel: false,
              confirmText: '进入首页', confirmColor: '#b048c8',
              success: () => wx.switchTab({ url: '/pages/home/home' })
            });
          } else {
            const fromInvite = this.data.inviteRequired || !!pending;
            inviteContext.clear();
            if (fromInvite) wx.switchTab({ url: '/pages/home/home' });
            else api.navigateAfterLogin(this.data.redirect, '/pages/home/home');
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
