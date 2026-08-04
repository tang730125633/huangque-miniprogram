const api = require('../../utils/api.js');
const device = require('../../utils/device.js');
const cardUtil = require('../../utils/card.js');
const warpTunnel = require('../../utils/warp-tunnel.js');

Page({
  data: {
    username: '',
    password: '',
    redirect: '',
    agreed: false,
    loading: false,
    cardLoading: false,
    err: ''
  },
  onLoad(options) {
    const redirect = api.loginRedirect(options && options.redirect);
    this.setData({ redirect });
  },
  onReady() { warpTunnel.mount(this, '#warpCanvas'); },
  onShow() { warpTunnel.resume(this); },
  onHide() { warpTunnel.pause(this); },
  onUnload() { warpTunnel.destroy(this); },
  onUsername(e) { this.setData({ username: e.detail.value }); },
  onPassword(e) { this.setData({ password: e.detail.value }); },
  openCardRegistration() { wx.switchTab({ url: '/pages/my-card/my-card' }); },
  close() {
    if (this.data && (this.data.loading || this.data.cardLoading)) return;
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.switchTab({ url: '/pages/my-card/my-card' });
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

  loginWithCard() {
    if (this.data.loading || this.data.cardLoading) return;
    if (!this.data.agreed) {
      this.setData({ err: '请先阅读并勾选《用户服务协议》和《隐私保护指引》' });
      return;
    }
    this.setData({ cardLoading: true, err: '' });
    cardUtil.loginCardAccount().then(() => {
      this.setData({ cardLoading: false });
      api.navigateAfterLogin(this.data.redirect, '/pages/home/home');
    }).catch((error) => this.setData({ cardLoading: false, err: error.message || '名片账号登录失败' }));
  },

  submit() {
    if (this.data.loading || this.data.cardLoading) return;
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
