// 统一请求封装：拼接 API base、带上 Bearer token、401 自动跳登录
const TOKEN_KEY = 'hq_token';
const CARD_TOKEN_KEY = 'hq_card_token';
const LEGACY_CARD_BIND_INTENT_KEY = 'hq_card_bind_intent';
const LOGIN_PAGE = '/pages/login/login';
const LOGIN_REDIRECTS = {
  ip12: '/pages/ip12/ip12',
  'my-card': '/pages/my-card/my-card',
  'card-edit': '/pages/card-edit/card-edit'
};
let membershipPromptOpen = false;
let cardBindIntent = false;
let authRedirecting = false;

function getBase() {
  const app = getApp();
  return (app && app.globalData && app.globalData.apiBase) || 'https://huangquechuanmei.com';
}
function getToken() {
  return wx.getStorageSync(TOKEN_KEY) || '';
}
function setToken(t) {
  wx.setStorageSync(TOKEN_KEY, t || '');
  if (t) authRedirecting = false;
}
function clearToken() {
  wx.removeStorageSync(TOKEN_KEY);
  wx.removeStorageSync(LEGACY_CARD_BIND_INTENT_KEY);
  cardBindIntent = false;
}
function getCardToken() {
  return wx.getStorageSync(CARD_TOKEN_KEY) || '';
}
function setCardToken(t) {
  wx.setStorageSync(CARD_TOKEN_KEY, t || '');
}
function clearCardToken() {
  wx.removeStorageSync(CARD_TOKEN_KEY);
}
function markCardBindIntent() {
  cardBindIntent = true;
}
function hasCardBindIntent() {
  return cardBindIntent;
}
function clearCardBindIntent() {
  cardBindIntent = false;
  wx.removeStorageSync(LEGACY_CARD_BIND_INTENT_KEY);
}

// 登录回跳只接受明确登记的小程序内部页面，避免把启动参数当成任意导航地址。
function loginRedirect(value) {
  value = String(value || '');
  if (value === 'ip12' || value === '/pages/ip12/ip12' || value === 'pages/ip12/ip12') return 'ip12';
  if (value === 'my-card' || value === '/pages/my-card/my-card' || value === 'pages/my-card/my-card') return 'my-card';
  if (value === 'card-edit' || value === '/pages/card-edit/card-edit' || value === 'pages/card-edit/card-edit') return 'card-edit';
  return '';
}

function loginUrl(value) {
  const redirect = loginRedirect(value);
  return LOGIN_PAGE + (redirect ? '?redirect=' + redirect : '');
}

function navigateAfterLogin(value, fallback) {
  const target = LOGIN_REDIRECTS[loginRedirect(value)];
  if (target) {
    if (target === '/pages/my-card/my-card') { markCardBindIntent(); wx.switchTab({ url: target }); }
    else wx.redirectTo({ url: target });
    return;
  }
  const destination = fallback || '/pages/home/home';
  if (destination === '/pages/my-card/my-card') markCardBindIntent();
  wx.switchTab({ url: destination });
}

function isMembershipRequired(res) {
  return !!(
    res && res.statusCode === 403 && res.data &&
    res.data.code === 'membership_required'
  );
}

function showMembershipRequired(detail) {
  if (membershipPromptOpen || !wx.showModal) return;
  membershipPromptOpen = true;
  wx.showModal({
    title: '需要有效会员',
    content: detail || '请先开通或续费会员后再使用生成能力。',
    confirmText: '查看会员',
    cancelText: '稍后处理',
    confirmColor: '#b048c8',
    success: function (result) {
      if (result.confirm) wx.navigateTo({ url: '/pages/recharge/recharge' });
    },
    complete: function () {
      membershipPromptOpen = false;
    }
  });
}

function request(path, options) {
  options = options || {};
  return new Promise(function (resolve, reject) {
    const header = { 'Content-Type': 'application/json' };
    const token = getToken();
    const cardToken = options.cardAuth ? getCardToken() : '';
    if (cardToken) header['X-HQ-Card-Token'] = cardToken;
    else if (token && options.auth !== false) header['Authorization'] = 'Bearer ' + token;
    if (options.idempotencyKey) header['Idempotency-Key'] = String(options.idempotencyKey);

    wx.request({
      url: getBase() + path,
      method: options.method || 'GET',
      data: options.data || {},
      header: header,
      timeout: options.timeout || 60000,
      success: function (res) {
        if (res.statusCode === 401 && cardToken) {
          clearCardToken();
        } else if (res.statusCode === 401 && options.auth !== false) {
          clearToken();
          const pages = getCurrentPages();
          const cur = pages.length ? pages[pages.length - 1].route : '';
          if (!authRedirecting && cur.indexOf('pages/login/login') === -1) {
            authRedirecting = true;
            const url = cur === 'pages/my-card/my-card' || cur === 'pages/card-edit/card-edit'
              ? '/pages/my-card/my-card'
              : loginUrl(cur);
            wx.reLaunch({ url, fail: () => { authRedirecting = false; } });
          }
        }
        if (isMembershipRequired(res)) {
          showMembershipRequired(res.data.detail);
        }
        resolve(res);
      },
      fail: function (err) { reject(err); }
    });
  });
}

// 相对路径（/api/gen/file/...）补全成绝对 URL；已是 http(s) 的原样返回
function absUrl(u) {
  u = String(u || '');
  if (!u) return '';
  if (u.indexOf('http') === 0) return u;
  if (u.charAt(0) === '/') return getBase() + u;
  return u;
}

// 受保护文件（/api/gen/file/ 下的视频、封面等）需要带 Bearer 才能取。
// <image>/<video>/previewMedia 都带不了请求头，所以用 downloadFile（支持 header）
// 先下到本地临时文件，再用 tempFilePath 播放/显示。带内存缓存避免重复下载。
const _dlCache = {};
function downloadProtected(url) {
  url = absUrl(url);
  const cacheable = !/\.pdf(?:[?#]|$)/i.test(url);
  if (cacheable && _dlCache[url]) return Promise.resolve(_dlCache[url]);
  return new Promise(function (resolve, reject) {
    const header = {};
    const token = getToken();
    if (token) header['Authorization'] = 'Bearer ' + token;
    wx.downloadFile({
      url: url, header: header,
      success: function (res) {
        if (res.statusCode === 200 && res.tempFilePath) {
          if (cacheable) _dlCache[url] = res.tempFilePath;
          resolve(res.tempFilePath);
        } else {
          const error = new Error('download ' + res.statusCode);
          error.statusCode = res.statusCode;
          reject(error);
        }
      },
      fail: reject
    });
  });
}

module.exports = {
  request, getToken, setToken, clearToken, getCardToken, setCardToken, clearCardToken, markCardBindIntent, hasCardBindIntent, clearCardBindIntent, getBase, absUrl, downloadProtected,
  isMembershipRequired, showMembershipRequired, loginRedirect, loginUrl, navigateAfterLogin
};
