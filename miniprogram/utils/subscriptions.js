const api = require('./api.js');

const CACHE_KEY = 'hq_subscribe_config';

function cachedConfig() {
  const value = wx.getStorageSync(CACHE_KEY);
  return value && typeof value === 'object' ? value : { configured: false, events: [] };
}

function loadConfig() {
  if (!api.getToken()) return Promise.resolve(cachedConfig());
  return api.request('/api/auth/subscription/config', { method: 'GET' })
    .then(function (res) {
      if (res.statusCode !== 200 || !res.data) return cachedConfig();
      const config = {
        configured: !!res.data.configured,
        events: Array.isArray(res.data.events) ? res.data.events : []
      };
      wx.setStorageSync(CACHE_KEY, config);
      return config;
    })
    .catch(function () { return cachedConfig(); });
}

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

function requestEvents(eventTypes) {
  eventTypes = Array.isArray(eventTypes) ? eventTypes : [];
  const config = cachedConfig();
  const selected = (config.events || []).filter(function (item) {
    return eventTypes.indexOf(item.event_type) !== -1 && item.template_id;
  });
  if (!config.configured || !selected.length) {
    loadConfig();
    return Promise.resolve({ configured: false, accepted: [] });
  }
  if (!wx.requestSubscribeMessage) {
    return Promise.reject(new Error('当前微信版本不支持订阅消息'));
  }
  const ids = selected.map(function (item) { return item.template_id; });
  return new Promise(function (resolve, reject) {
    wx.requestSubscribeMessage({
      tmplIds: ids,
      success: resolve,
      fail: reject
    });
  }).then(function (result) {
    const choices = {};
    const accepted = [];
    selected.forEach(function (item) {
      const choice = result[item.template_id];
      if (choice) choices[item.event_type] = choice;
      if (choice === 'accept') accepted.push(item.event_type);
    });
    if (!Object.keys(choices).length) return { configured: true, accepted: [] };
    return wxLogin().then(function (code) {
      return api.request('/api/auth/subscription/consent', {
        method: 'POST',
        data: { wx_code: code, choices: choices },
        timeout: 30000
      });
    }).then(function (res) {
      if (res.statusCode !== 200) {
        throw new Error((res.data && res.data.detail) || '订阅状态保存失败');
      }
      const next = {
        configured: !!res.data.configured,
        events: Array.isArray(res.data.events) ? res.data.events : []
      };
      wx.setStorageSync(CACHE_KEY, next);
      return { configured: true, accepted: accepted, choices: choices };
    });
  });
}

module.exports = { cachedConfig, loadConfig, requestEvents };
