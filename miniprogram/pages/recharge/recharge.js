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
  { id: 'points_1000', title: '1000 点', price_yuan: '100.00', amount: 100, points: 1000 },
  { id: 'points_2000', title: '2000 点', price_yuan: '200.00', amount: 200, points: 2000 },
  { id: 'points_5000', title: '5000 点', price_yuan: '500.00', amount: 500, points: 5000, recommended: true }
];

const MEMBERSHIP_PACKAGE = { id: 'membership_experience', title: '开通一年体验官', benefit: '赠 1000 点', price_yuan: '499.00', amount: 499, points: 1000 };

const CUSTOM = { package_id: 'custom_points', min_amount_yuan: 10, max_amount_yuan: 5000, points_per_yuan: 10 };

function isMembershipActive(user) {
  return !!(user && user.membership_status === 'active' && user.membership_active);
}

function buildRechargeConfig(user) {
  const membershipActive = isMembershipActive(user);
  return {
    membershipActive,
    packages: membershipActive ? PACKAGES : [MEMBERSHIP_PACKAGE],
    custom: membershipActive ? CUSTOM : null,
    configured: true
  };
}

function paymentPayload(packageId, amount, code) {
  const data = { amount, js_code: code };
  if (packageId === MEMBERSHIP_PACKAGE.id) data.product_type = 'membership_experience';
  return data;
}

function isMiniProgramWxPayOrder(order) {
  return !!(order && order.status === 'pending' &&
    (order.note === '微信小程序充值' || order.note === '微信小程序开通体验官'));
}

const pageDefinition = {
  data: {
    points: null,
    packages: [],
    custom: null,
    membershipActive: false,
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
      const user = me.statusCode === 200 && me.data && me.data.user;
      const next = Object.assign({ loading: false }, buildRechargeConfig(user));
      if (user) next.points = user.points;
      this.setData(next);
      this.refreshOrders(true);
    }).catch(() => {
      this.setData({ loading: false, statusText: '网络异常，请稍后重试' });
    });
  },

  refreshOrders(reconcilePending) {
    return api.request('/api/auth/recharge/orders?limit=20', { method: 'GET' }).then((res) => {
      if (res.statusCode !== 200 || !res.data) return;
      const items = (res.data.items || []).map(this.formatOrder);
      this.setData({ orders: items });
      if (!reconcilePending) return items;
      const pending = items.filter(isMiniProgramWxPayOrder);
      return Promise.all(pending.map((item) => this.reconcileOrder(item.order_id).catch(() => null))).then((results) => {
        return results.some((result) => result && result.statusCode === 200) ? this.refreshOrders(false) : items;
      });
    }).catch(() => {});
  },

  reconcileOrder(orderId) {
    this.reconcilingOrderIds = this.reconcilingOrderIds || {};
    if (!orderId || this.reconcilingOrderIds[orderId]) return Promise.resolve(null);
    this.reconcilingOrderIds[orderId] = true;
    const done = (result) => {
      delete this.reconcilingOrderIds[orderId];
      return result;
    };
    return api.request('/api/auth/wxpay/reconcile', {
      method: 'POST',
      data: { order_id: orderId },
      timeout: 30000
    }).then(done, (error) => {
      delete this.reconcilingOrderIds[orderId];
      throw error;
    });
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
    if (!this.data.configured || this.data.payingId || this.paymentInFlight) return;
    this.paymentInFlight = true;
    const membershipPurchase = packageId === MEMBERSHIP_PACKAGE.id;
    this.setData({ payingId: packageId, statusText: '正在创建微信订单…' });
    let orderId = '';
    wxLogin()
      .then((code) => {
        return api.request('/api/auth/wxpay/jsapi', {
          method: 'POST',
          data: paymentPayload(packageId, amount, code),
          timeout: 30000
        });
      })
      .then((res) => {
        if (res.statusCode !== 200 || !res.data || !res.data.pay) {
          throw new Error((res.data && res.data.detail) || '微信订单创建失败');
        }
        orderId = res.data.order && res.data.order.order_id;
        if (!orderId) throw new Error('微信订单创建失败');
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
          statusText: membershipPurchase ? '会员开通成功，赠送点数已到账' : '充值成功，点数已到账'
        });
        this.paymentInFlight = false;
        wx.showToast({ title: membershipPurchase ? '会员已开通' : '点数已到账', icon: 'success' });
        this.refresh();
      })
      .catch((err) => {
        this.paymentInFlight = false;
        const message = (err && (err.errMsg || err.message)) || '支付未完成';
        const cancelled = /cancel/i.test(message);
        this.setData({ payingId: '', statusText: cancelled ? '已取消支付' : message });
        if (!cancelled) this.showPaymentError(message);
        if (orderId) this.refreshOrders();
      });
  },

  showPaymentError(message) {
    if (this.paymentErrorOpen) return;
    this.paymentErrorOpen = true;
    wx.showModal({
      title: '支付未完成',
      content: message,
      showCancel: false,
      complete: () => { this.paymentErrorOpen = false; }
    });
  },

  pollPaid(orderId, attempts) {
    return api.request('/api/auth/recharge/orders?limit=20', { method: 'GET' }).then((res) => {
      const items = (res.data && res.data.items) || [];
      const order = items.find((item) => item.order_id === orderId);
      if (order && order.status === 'approved') return order;
      if (attempts <= 1) {
        return this.reconcileOrder(orderId).then((result) => {
          if (result && result.statusCode === 200) return (result.data && result.data.order) || order;
          throw new Error('微信正在确认订单，稍后进入本页会自动补查到账');
        });
      }
      return new Promise((resolve) => {
        setTimeout(() => resolve(this.pollPaid(orderId, attempts - 1)), 1500);
      });
    });
  }
};

Page(pageDefinition);

if (typeof module !== 'undefined') module.exports = {
  buildRechargeConfig, paymentPayload, isMiniProgramWxPayOrder,
  MEMBERSHIP_PACKAGE, pageDefinition
};
