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

function virtualPay(params) {
  return new Promise(function (resolve, reject) {
    if (!wx.requestVirtualPayment) {
      reject(new Error('当前微信版本不支持小程序虚拟支付，请升级微信后在真机重试'));
      return;
    }
    wx.requestVirtualPayment({
      mode: params.mode,
      signData: params.signData,
      paySig: params.paySig,
      signature: params.signature,
      success: resolve,
      fail: reject
    });
  });
}

Page({
  data: {
    points: null,
    packages: [],
    custom: null,
    customAmount: '',
    customPoints: 0,
    customValid: false,
    orders: [],
    configured: false,
    environment: 'production',
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
    Promise.all([
      api.request('/api/auth/me', { method: 'GET' }),
      api.request('/api/auth/virtual-pay/packages', { method: 'GET' })
    ]).then((results) => {
      const me = results[0];
      const packs = results[1];
      const next = { loading: false };
      if (me.statusCode === 200 && me.data && me.data.user) next.points = me.data.user.points;
      if (packs.statusCode === 200 && packs.data) {
        next.packages = packs.data.items || [];
        next.custom = packs.data.custom || null;
        next.configured = !!packs.data.configured;
        next.environment = packs.data.environment || 'production';
      } else {
        next.statusText = (packs.data && packs.data.detail) || '充值配置读取失败，请稍后重试';
      }
      this.setData(next);
      this.refreshOrders(true);
    }).catch(() => {
      this.setData({ loading: false, statusText: '网络异常，请稍后重试' });
    });
  },

  refreshOrders(reconcile) {
    api.request('/api/auth/virtual-pay/orders?limit=20', { method: 'GET' }).then((res) => {
      if (res.statusCode !== 200 || !res.data) return;
      const items = (res.data.items || []).map(this.formatOrder);
      this.setData({ orders: items });
      if (!reconcile || !this.data.configured) return;
      const pending = items.filter((item) => item.status === 'created').slice(0, 3);
      pending.forEach((item) => this.confirmOrder(item.order_id, true));
    }).catch(() => {});
  },

  formatOrder(item) {
    const date = new Date(Number(item.created_at || 0) * 1000);
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    const labels = { created: '待支付确认', credited: '已到账', refunded: '已退款', failed: '未完成' };
    return Object.assign({}, item, {
      amount_yuan: (Number(item.amount_fen || 0) / 100).toFixed(2),
      time_label: date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()),
      status_label: labels[item.status] || item.status
    });
  },

  startPay(e) {
    const packageId = e.currentTarget.dataset.id;
    this.beginPayment(packageId);
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

  beginPayment(packageId, customAmountYuan) {
    if (!this.data.configured || this.data.payingId) return;
    if (wx.canIUse && !wx.canIUse('requestVirtualPayment')) {
      wx.showModal({ title: '请升级微信', content: '当前微信版本不支持小程序虚拟支付，请升级后在手机微信中重试。', showCancel: false });
      return;
    }
    this.setData({ payingId: packageId, statusText: '正在创建微信订单…' });
    let orderId = '';
    wxLogin()
      .then((code) => {
        const data = { package_id: packageId, wx_code: code };
        if (customAmountYuan !== undefined) data.custom_amount_yuan = customAmountYuan;
        return api.request('/api/auth/virtual-pay/order', {
          method: 'POST',
          data,
          timeout: 30000
        });
      })
      .then((res) => {
        if (res.statusCode !== 200 || !res.data || !res.data.payment) {
          throw new Error((res.data && res.data.detail) || '微信订单创建失败');
        }
        orderId = res.data.order.order_id;
        this.setData({ statusText: '请在微信收银台完成支付…' });
        return virtualPay(res.data.payment);
      })
      .then(() => {
        this.setData({ statusText: '支付完成，正在核对到账…' });
        return this.pollConfirm(orderId, 8);
      })
      .then((result) => {
        this.setData({
          payingId: '',
          points: result.points === null || result.points === undefined ? this.data.points : result.points,
          statusText: '充值成功，点数已到账'
        });
        wx.showToast({ title: '点数已到账', icon: 'success' });
        this.refreshOrders(false);
      })
      .catch((err) => {
        const message = (err && (err.errMsg || err.message)) || '支付未完成';
        const cancelled = /cancel/i.test(message);
        this.setData({ payingId: '', statusText: cancelled ? '已取消支付' : message });
        if (!cancelled) wx.showModal({ title: '支付未完成', content: message, showCancel: false });
        if (orderId) this.refreshOrders(true);
      });
  },

  pollConfirm(orderId, attempts) {
    return this.confirmOrder(orderId, false).then((result) => {
      if (result && result.ok) return result;
      if (attempts <= 1) throw new Error('微信正在确认订单，稍后进入本页会自动补查到账');
      return new Promise((resolve) => {
        setTimeout(() => resolve(this.pollConfirm(orderId, attempts - 1)), 1500);
      });
    });
  },

  confirmOrder(orderId, silent) {
    return api.request('/api/auth/virtual-pay/confirm', {
      method: 'POST',
      data: { order_id: orderId },
      timeout: 30000
    }).then((res) => {
      if (res.statusCode === 200 && res.data && res.data.ok) {
        if (silent) {
          this.setData({ points: res.data.points, statusText: '已自动补齐一笔充值到账' });
          this.refreshOrders(false);
        }
        return res.data;
      }
      if (res.statusCode === 202) return { ok: false, pending: true };
      if (!silent && res.statusCode >= 400) throw new Error((res.data && res.data.detail) || '支付结果确认失败');
      return { ok: false };
    }).catch((err) => {
      if (!silent) throw err;
      return { ok: false };
    });
  }
});
