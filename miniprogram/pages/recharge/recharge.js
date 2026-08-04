const api = require('../../utils/api.js');
const pricing = require('../../utils/pricing.js');

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

function requestVirtualPayment(params) {
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

const MEMBERSHIP_PACKAGE_ID = 'membership_experience';
const EXPERIENCE_RENEWAL_PACKAGE_ID = 'membership_experience_renewal';
const MEMBERSHIP_NAMES = { experience: '体验官', partner: '合伙人', initiator: '发起人' };

function membershipPackage(commerce) {
  const amount = commerce && commerce.membershipPriceYuan;
  const points = commerce && commerce.membershipBonusPoints;
  if (!amount || !points) return null;
  return { id: MEMBERSHIP_PACKAGE_ID, product_id: 'hq_member_exp_1y', title: '开通一年体验官', benefit: '赠 ' + points + ' 点', price_yuan: Number(amount).toFixed(2), amount, points };
}

function renewalPackage(commerce) {
  const amount = commerce && commerce.membershipPriceYuan;
  if (!amount) return null;
  return { id: EXPERIENCE_RENEWAL_PACKAGE_ID, product_type: EXPERIENCE_RENEWAL_PACKAGE_ID, order_type: EXPERIENCE_RENEWAL_PACKAGE_ID, title: '体验会员续费', benefit: '延长一年', price_yuan: Number(amount).toFixed(2), amount, points: 0, membership_renewal: true };
}

function isMembershipActive(user) {
  return !!(user && user.membership_status === 'active' && user.membership_active);
}

function buildRechargeConfig(user, virtualConfig, commerce) {
  const membershipActive = isMembershipActive(user);
  const config = virtualConfig || {};
  const discountBps = membershipActive ? Number(config.discount_bps || user.points_purchase_discount_bps || 10000) : 10000;
  const membershipName = membershipActive
    ? (user.membership_name || MEMBERSHIP_NAMES[config.membership_tier] || '会员')
    : '';
  const discountLabel = membershipActive
    ? (user.points_purchase_discount_label || ({ 7500: '7.5折', 5500: '5.5折' }[discountBps]) || '原价')
    : '';
  let packages = membershipActive ? (config.items || []).map(function (item) {
    const listPriceFen = Number(item.list_price_fen === undefined ? item.price_fen : item.list_price_fen);
    const priceFen = Number(item.price_fen === undefined ? listPriceFen : item.price_fen);
    return Object.assign({}, item, {
      list_price_yuan: (listPriceFen / 100).toFixed(2),
      price_yuan: item.price_yuan || (priceFen / 100).toFixed(2),
      show_discount: priceFen < listPriceFen
    });
  }) : [membershipPackage(commerce)].filter(Boolean);
  const tier = user.membership_tier || config.membership_tier;
  const experienceRenewal = membershipActive && tier === 'experience';
  if (experienceRenewal) packages = [renewalPackage(commerce)].filter(Boolean).concat(packages);
  return {
    membershipActive,
    membershipName,
    discountLabel,
    hasDiscount: discountBps < 10000,
    packages,
    experienceRenewal,
    contactAdmin: membershipActive && (tier === 'partner' || tier === 'initiator'),
    custom: membershipActive ? (config.custom || null) : null,
    configured: !!(commerce && commerce.membershipPriceYuan && commerce.membershipBonusPoints) && (membershipActive ? !!config.configured : true),
    environment: config.environment || 'production'
  };
}

function paymentMode(packageId) {
  return 'virtual';
}

function virtualPaymentPayload(packageId, amount, code) {
  const data = { package_id: packageId, wx_code: code };
  if (packageId === EXPERIENCE_RENEWAL_PACKAGE_ID) {
    data.product_type = EXPERIENCE_RENEWAL_PACKAGE_ID;
    data.order_type = EXPERIENCE_RENEWAL_PACKAGE_ID;
  }
  if (packageId === 'custom_points') data.custom_amount_yuan = amount;
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
    customPayAmount: '',
    customValid: false,
    orders: [],
    configured: true,
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
  },

  onShow() {
    if (api.getToken()) pricing.watch(this, (prices) => this.refresh(prices), () => {
      this.setData({ loading: false, configured: false, statusText: '价格读取失败，请稍后重试' });
    });
  },

  onHide() { pricing.stop(this); },
  onUnload() { pricing.stop(this); },

  refresh(prices) {
    this.setData({ loading: true, statusText: '' });
    return Promise.all([api.request('/api/auth/me', { method: 'GET' }), prices ? Promise.resolve(prices) : pricing.load()]).then(([me, prices]) => {
      const commerce = pricing.commerce(prices);
      const user = me.statusCode === 200 && me.data && me.data.user;
      if (user && (user.initial_password || user.must_change)) {
        this.setData({ loading: false, points: user.points });
        this.promptPasswordChange();
        return;
      }
      if (!isMembershipActive(user)) {
        const next = Object.assign({ loading: false }, buildRechargeConfig(user, null, commerce));
        if (user) next.points = user.points;
        this.setData(next);
        return this.refreshOrders(true);
      }
      return api.request('/api/auth/virtual-pay/packages', { method: 'GET' }).then((packs) => {
        const virtualConfig = packs.statusCode === 200 && packs.data ? packs.data : {};
        const next = Object.assign({ loading: false }, buildRechargeConfig(user, virtualConfig, commerce));
        next.points = user.points;
        if (!next.configured) {
          next.statusText = (packs.data && packs.data.detail) || '微信虚拟支付配置中，请稍后重试';
        }
        this.setData(next);
        return this.refreshOrders(true);
      });
    }).catch(() => {
      this.setData({ loading: false, statusText: '网络异常，请稍后重试' });
    });
  },

  promptPasswordChange() {
    if (this.passwordPromptOpen) return;
    this.passwordPromptOpen = true;
    wx.showModal({
      title: '充值前先修改初始密码',
      content: '为保护点数和会员权益，请回到微信名片编辑页设置新密码后再充值。',
      showCancel: false,
      confirmText: '去修改',
      success: () => wx.navigateTo({ url: '/pages/card-edit/card-edit?source=recharge' }),
      complete: () => { this.passwordPromptOpen = false; }
    });
  },

  refreshOrders(reconcilePending) {
    return api.request('/api/auth/virtual-pay/orders?limit=20', { method: 'GET' }).then((res) => {
      if (res.statusCode !== 200 || !res.data) return;
      const items = (res.data.items || []).map(this.formatOrder);
      this.setData({ orders: items });
      if (!reconcilePending) return items;
      const pending = items.filter((item) => item.status === 'created').slice(0, 3);
      return Promise.all(pending.map((item) => this.confirmVirtualOrder(item.order_id, true))).then(() => items);
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
    const labels = {
      pending: '待支付',
      approved: '已到账',
      rejected: '已关闭',
      created: '待支付确认',
      credited: '已到账',
      failed: '未完成'
    };
    return Object.assign({}, item, {
      amount_yuan: item.amount_fen === undefined
        ? Number(item.amount || 0).toFixed(2)
        : (Number(item.amount_fen || 0) / 100).toFixed(2),
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
      customPoints: valid ? amount * Number(config.points_per_yuan) : 0,
      customPayAmount: valid
        ? (amount * Number(config.price_fen_per_list_yuan || 100) / 100).toFixed(2)
        : ''
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
    return this.beginVirtualPayment(packageId, amount);
  },

  beginVirtualPayment(packageId, amount) {
    if (!this.data.configured || this.data.payingId || this.paymentInFlight) return;
    if (wx.canIUse && !wx.canIUse('requestVirtualPayment')) {
      wx.showModal({
        title: '请升级微信',
        content: '当前微信版本不支持小程序虚拟支付，请升级后在手机微信中重试。',
        showCancel: false
      });
      return;
    }
    this.paymentInFlight = true;
    this.setData({ payingId: packageId, statusText: '正在创建微信虚拟支付订单…' });
    let orderId = '';
    wxLogin()
      .then((code) => api.request('/api/auth/virtual-pay/order', {
        method: 'POST',
        data: virtualPaymentPayload(packageId, amount, code),
        timeout: 30000
      }))
      .then((res) => {
        if (res.statusCode !== 200 || !res.data || !res.data.payment) {
          throw new Error((res.data && res.data.detail) || '微信虚拟支付订单创建失败');
        }
        orderId = res.data.order && res.data.order.order_id;
        if (!orderId) throw new Error('微信虚拟支付订单创建失败');
        this.setData({ statusText: '请在微信收银台完成支付…' });
        return requestVirtualPayment(res.data.payment);
      })
      .then(() => {
        this.setData({ statusText: '支付完成，正在核对到账…' });
        return this.pollVirtualPaid(orderId, 8);
      })
      .then((result) => {
        const membershipPurchase = packageId === MEMBERSHIP_PACKAGE_ID || packageId === EXPERIENCE_RENEWAL_PACKAGE_ID;
        this.setData({
          payingId: '',
          points: result.points === null || result.points === undefined ? this.data.points : result.points,
          statusText: packageId === EXPERIENCE_RENEWAL_PACKAGE_ID ? '体验会员已延长一年' : (membershipPurchase ? '体验官开通成功，赠送点数已到账' : '充值成功，点数已到账')
        });
        this.paymentInFlight = false;
        wx.showToast({ title: packageId === EXPERIENCE_RENEWAL_PACKAGE_ID ? '续费成功' : (membershipPurchase ? '体验官已开通' : '点数已到账'), icon: 'success' });
        if (membershipPurchase) this.refresh();
        else this.refreshOrders(false);
      })
      .catch((err) => {
        this.paymentInFlight = false;
        const message = (err && (err.errMsg || err.message)) || '支付未完成';
        const cancelled = /cancel/i.test(message);
        this.setData({ payingId: '', statusText: cancelled ? '已取消支付' : message });
        if (!cancelled) this.showPaymentError(message);
        if (orderId) this.refreshOrders(true);
      });
  },

  pollVirtualPaid(orderId, attempts) {
    return this.confirmVirtualOrder(orderId, false).then((result) => {
      if (result && result.ok) return result;
      if (attempts <= 1) throw new Error('微信正在确认订单，稍后进入本页会自动补查到账');
      return new Promise((resolve) => {
        setTimeout(() => resolve(this.pollVirtualPaid(orderId, attempts - 1)), 1500);
      });
    });
  },

  confirmVirtualOrder(orderId, silent) {
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
      if (!silent && res.statusCode >= 400) {
        throw new Error((res.data && res.data.detail) || '支付结果确认失败');
      }
      return { ok: false };
    }).catch((err) => {
      if (!silent) throw err;
      return { ok: false };
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
  buildRechargeConfig, paymentMode, virtualPaymentPayload, isMiniProgramWxPayOrder,
  membershipPackage, renewalPackage, MEMBERSHIP_PACKAGE_ID, EXPERIENCE_RENEWAL_PACKAGE_ID, pageDefinition
};
