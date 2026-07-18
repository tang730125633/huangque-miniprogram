const api = require('../../utils/api.js');

function wxLogin() {
  return new Promise(function (resolve, reject) {
    wx.login({
      timeout: 10000,
      success: function (res) {
        if (res && res.code) resolve(res.code);
        else reject(new Error('未获取到微信登录凭证'));
      },
      fail: reject
    });
  });
}

function requestPayment(params) {
  return new Promise(function (resolve, reject) {
    wx.requestPayment({
      timeStamp: params.timeStamp,
      nonceStr: params.nonceStr,
      package: params.package,
      signType: params.signType || 'RSA',
      paySign: params.paySign,
      success: resolve,
      fail: reject
    });
  });
}

const PACKAGES = [
  { id: 'points_1000', title: '1000 点', price_yuan: '99.00', amount: 99, points: 1000 },
  { id: 'points_2000', title: '2000 点', price_yuan: '199.00', amount: 199, points: 2000 },
  { id: 'points_5000', title: '5000 点', price_yuan: '499.00', amount: 499, points: 5000, recommended: true }
];

const CUSTOM = { package_id: 'custom_points', min_amount_yuan: 10, max_amount_yuan: 5000, points_per_yuan: 10 };

Page({
  data: {
    points: null,
    packages: [],
    custom: null,
    customAmount: '',
    customPoints: 0,
    customValid: false,
    orders: [],
    configured: true,
    loading: true,
    payingId: '',
    statusText: ''
  },

  onLoad() {
    if (!api.getToken()) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    this.refresh();
  },

  onShow() {
    if (api.getToken() && !this.data.loading) this.refreshOrders(true);
  },

  refresh() {
    this.setData({ loading: true, statusText: '' });
    api.request('/api/auth/me', { method: 'GET' }).then((me) => {
      const next = { loading: false, packages: PACKAGES, custom: CUSTOM, configured: true };
      if (me.statusCode === 200 && me.data && me.data.user) next.points = me.data.user.points;
      this.setData(next);
      this.refreshOrders();
    }).catch(() => {
      this.setData({ loading: false, statusText: '网络异常，请稍后重试' });
    });
  },

  refreshOrders() {
    api.request('/api/auth/recharge/orders?limit=20', { method: 'GET' }).then((res) => {
      if (res.statusCode !== 200 || !res.data) return;
      const items = (res.data.items || []).map(this.formatOrder);
      this.setData({ orders: items });
    }).catch(() => {});
  },

  formatOrder(item) {
    const date = new Date(Number(item.created_at || 0) * 1000);
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    const labels = { pending: '待支付', approved: '已到账', rejected: '已关闭' };
    return Object.assign({}, item, {
      amount_yuan: Number(item.amount || 0).toFixed(2),
      time_label: date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()),
      status_label: labels[item.status] || item.status
    });
  },

  startPay(e) {
    this.beginPayment(e.currentTarget.dataset.id, Number(e.currentTarget.dataset.amount));
  },

  onCustomAmountInput(e) {
    const raw = String((e.detail && e.detail.value) || '').trim();
    const config = this.data.custom;
    const amount = /^\d+$/.test(raw) ? Number(raw) : 0;
    const valid = !!config && Number.isInteger(amount) &&
      amount >= Number(config.min_amount_yuan) &&
      amount <= Number(config.max_amount_yuan);
    this.setData({
      customAmount: raw,
      customValid: valid,
      customPoints: valid ? amount * Number(config.points_per_yuan) : 0
    });
  },

  startCustomPay() {
    const config = this.data.custom;
    if (!config || !this.data.customValid) {
      wx.showToast({ title: '请输入有效的整数金额', icon: 'none' });
      return;
    }
    this.beginPayment(config.package_id, Number(this.data.customAmount));
  },

  beginPayment(packageId, amount) {
    if (!this.data.configured || this.data.payingId) return;
    this.setData({ payingId: packageId, statusText: '正在创建微信订单…' });
    let orderId = '';
    wxLogin()
      .then((code) => {
        return api.request('/api/auth/wxpay/jsapi', {
          method: 'POST',
          data: { amount, js_code: code },
          timeout: 30000
        });
      })
      .then((res) => {
        if (res.statusCode !== 200 || !res.data || !res.data.pay) {
          throw new Error((res.data && res.data.detail) || '微信订单创建失败');
        }
        orderId = res.data.order.order_id;
        this.setData({ statusText: '请在微信收银台完成支付…' });
        return requestPayment(res.data.pay);
      })
      .then(() => {
        this.setData({ statusText: '支付完成，正在核对到账…' });
        return this.pollPaid(orderId, 8);
      })
      .then((result) => {
        this.setData({
          payingId: '',
          statusText: '充值成功，点数已到账'
        });
        wx.showToast({ title: '点数已到账', icon: 'success' });
        this.refresh();
      })
      .catch((err) => {
        const message = (err && (err.errMsg || err.message)) || '支付未完成';
        const cancelled = /cancel/i.test(message);
        this.setData({ payingId: '', statusText: cancelled ? '已取消支付' : message });
        if (!cancelled) wx.showModal({ title: '支付未完成', content: message, showCancel: false });
        if (orderId) this.refreshOrders();
      });
  },

  pollPaid(orderId, attempts) {
    return api.request('/api/auth/recharge/orders?limit=20', { method: 'GET' }).then((res) => {
      const items = (res.data && res.data.items) || [];
      const order = items.find((item) => item.order_id === orderId);
      if (order && order.status === 'approved') return order;
      if (attempts <= 1) throw new Error('微信正在确认订单，稍后进入本页会自动补查到账');
      return new Promise((resolve) => {
        setTimeout(() => resolve(this.pollPaid(orderId, attempts - 1)), 1500);
      });
    });
  }
});
