const DEVICE_KEY = 'hq_device_id';

function createDeviceId() {
  return 'mp-' + Date.now().toString(36) + '-' +
    Math.random().toString(36).slice(2, 12);
}

function getDeviceId() {
  let value = String(wx.getStorageSync(DEVICE_KEY) || '').trim();
  if (!value) {
    value = createDeviceId();
    wx.setStorageSync(DEVICE_KEY, value);
  }
  return value;
}

module.exports = { getDeviceId };
