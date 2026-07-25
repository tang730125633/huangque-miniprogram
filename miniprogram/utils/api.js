// 统一请求封装：拼接 API base、带上 Bearer token、401 自动跳登录
const TOKEN_KEY = 'hq_token';
let membershipPromptOpen = false;

function getBase() {
  const app = getApp();
  return (app && app.globalData && app.globalData.apiBase) || 'https://huangquechuanmei.com';
}
function getToken() {
  return wx.getStorageSync(TOKEN_KEY) || '';
}
function setToken(t) {
  wx.setStorageSync(TOKEN_KEY, t || '');
}
function clearToken() {
  wx.removeStorageSync(TOKEN_KEY);
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
      if (result.confirm) wx.switchTab({ url: '/pages/profile/profile' });
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
    if (token) header['Authorization'] = 'Bearer ' + token;

    wx.request({
      url: getBase() + path,
      method: options.method || 'GET',
      data: options.data || {},
      header: header,
      timeout: options.timeout || 60000,
      success: function (res) {
        if (res.statusCode === 401) {
          clearToken();
          const pages = getCurrentPages();
          const cur = pages.length ? pages[pages.length - 1].route : '';
          if (cur.indexOf('pages/login/login') === -1) {
            wx.reLaunch({ url: '/pages/login/login' });
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
  if (_dlCache[url]) return Promise.resolve(_dlCache[url]);
  return new Promise(function (resolve, reject) {
    const header = {};
    const token = getToken();
    if (token) header['Authorization'] = 'Bearer ' + token;
    wx.downloadFile({
      url: url, header: header,
      success: function (res) {
        if (res.statusCode === 200 && res.tempFilePath) {
          _dlCache[url] = res.tempFilePath;
          resolve(res.tempFilePath);
        } else {
          reject(new Error('download ' + res.statusCode));
        }
      },
      fail: reject
    });
  });
}

module.exports = {
  request, getToken, setToken, clearToken, getBase, absUrl, downloadProtected,
  isMembershipRequired, showMembershipRequired
};
