const api = require('../../utils/api.js');
const device = require('../../utils/device.js');

Page({
  data: {
    username: '',
    password: '',
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
  },
  onUsername(e) { this.setData({ username: e.detail.value }); },
  onPassword(e) { this.setData({ password: e.detail.value }); },
  openCardRegistration() { wx.reLaunch({ url: '/pages/my-card/my-card' }); },
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
    api.request('/api/auth/miniprogram-login', {
      method: 'POST', data: { username: username, password: password, device_id: device.getDeviceId() }
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
          api.navigateAfterLogin(this.data.redirect, '/pages/my-card/my-card');
        } else {
          this.setData({ err: d.detail || ('请求失败（' + res.statusCode + '）') });
        }
      })
      .catch(() => {
        this.setData({ loading: false, err: '网络错误，请检查网络后重试' });
      });
  }
});
