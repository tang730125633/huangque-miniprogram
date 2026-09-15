const api = require('./api');

const EVENT_TYPE = 'work_complete';
let current = { configured: false, templateId: '', remaining: 0 };
let loading = null;

function preload() {
  if (loading) return loading;
  loading = api.request('/api/auth/subscription/status').then((data) => {
    const events = Array.isArray(data && data.events) ? data.events : [];
    const item = events.find((event) => event && event.event_type === EVENT_TYPE) || {};
    current = {
      configured: Boolean(item.configured && item.template_id),
      templateId: String(item.template_id || ''),
      remaining: Math.max(0, Number(item.remaining || 0))
    };
    return current;
  }).catch(() => current).finally(() => { loading = null; });
  return loading;
}

function saveChoice(choice) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value || current);
    };
    const timer = setTimeout(() => finish(), 3500);
    wx.login({
      success(login) {
        if (!login || !login.code) return finish();
        api.request('/api/auth/subscription/choices', 'POST', {
          choices: { [EVENT_TYPE]: choice }, wx_code: login.code
        }).then((data) => {
          const events = Array.isArray(data && data.events) ? data.events : [];
          const item = events.find((event) => event && event.event_type === EVENT_TYPE) || {};
          current = Object.assign({}, current, { remaining: Math.max(0, Number(item.remaining || 0)) });
          finish(current);
        }).catch(() => finish());
      },
      fail: () => finish()
    });
  });
}

function request() {
  const templateId = current.templateId;
  if (!current.configured || !templateId || !wx.requestSubscribeMessage) {
    return Promise.resolve({ choice: 'unavailable', status: current });
  }
  return new Promise((resolve) => wx.requestSubscribeMessage({
    tmplIds: [templateId], success: resolve, fail: () => resolve({})
  })).then((result) => {
    const choice = result && result[templateId];
    if (!['accept', 'reject', 'ban', 'filter'].includes(choice)) {
      return { choice: 'cancel', status: current };
    }
    return saveChoice(choice).then((status) => ({ choice, status }));
  });
}

module.exports = { preload, request };
