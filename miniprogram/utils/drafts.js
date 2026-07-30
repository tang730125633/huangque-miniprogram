const VERSION = 1;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const INDEX_KEY = 'hq_draft_index_v1';
let revisionSequence = 0;

function newRevision() {
  revisionSequence += 1;
  return Date.now().toString(36) + ':' + revisionSequence.toString(36);
}

function raw(key) {
  try { return wx.getStorageSync(key) || null; } catch (e) { return null; }
}

function index() {
  const value = raw(INDEX_KEY);
  return Array.isArray(value) ? value : [];
}

function saveIndex(keys) {
  try {
    wx.setStorageSync(INDEX_KEY, Array.from(new Set(keys.filter(Boolean))));
    return true;
  } catch (e) { return false; }
}

function scopedKey(base, identity) {
  const value = String(identity || 'anonymous');
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return base + ':' + (hash >>> 0).toString(36);
}

function discardFiles(paths) {
  if (!wx.removeSavedFile) return;
  const list = Array.isArray(paths) ? paths : [];
  Array.from(new Set(list.filter(Boolean))).forEach((filePath) => {
    try { wx.removeSavedFile({ filePath, complete: () => {} }); } catch (e) {}
  });
}

function clear(key) {
  const item = raw(key);
  try { wx.removeStorageSync(key); } catch (e) {}
  discardFiles(item && item.files);
  saveIndex(index().filter((itemKey) => itemKey !== key));
}

function cleanupExpired() {
  const now = Date.now();
  const keep = [];
  index().forEach((key) => {
    const item = raw(key);
    if (!item || item.version !== VERSION || !item.payload || !item.updatedAt || now - item.updatedAt > MAX_AGE_MS) {
      try { wx.removeStorageSync(key); } catch (e) {}
      discardFiles(item && item.files);
    } else {
      keep.push(key);
    }
  });
  saveIndex(keep);
}

function load(key) {
  cleanupExpired();
  const item = raw(key);
  if (!item) return null;
  if (item.version !== VERSION || !item.payload) {
    clear(key);
    return null;
  }
  if (!item.updatedAt || Date.now() - item.updatedAt > MAX_AGE_MS) {
    clear(key);
    return null;
  }
  return item.payload;
}

function save(key, payload, files) {
  const previous = raw(key);
  const previousFiles = previous && Array.isArray(previous.files) ? previous.files : [];
  const nextFiles = Array.from(new Set((files || []).filter(Boolean)));
  const keys = index();
  const wasIndexed = keys.indexOf(key) >= 0;
  if (!wasIndexed && !saveIndex(keys.concat([key]))) {
    discardFiles(nextFiles.filter((filePath) => previousFiles.indexOf(filePath) < 0));
    return false;
  }
  try {
    wx.setStorageSync(key, {
      version: VERSION,
      revision: newRevision(),
      updatedAt: Date.now(),
      payload,
      files: nextFiles
    });
    discardFiles(previousFiles.filter((filePath) => nextFiles.indexOf(filePath) < 0));
    return true;
  } catch (e) {
    if (!wasIndexed && !previous) saveIndex(keys);
    discardFiles(nextFiles.filter((filePath) => previousFiles.indexOf(filePath) < 0));
    return false;
  }
}

function getRevision(key) {
  const item = raw(key);
  return item && item.version === VERSION && item.revision != null ? item.revision : null;
}

function clearIfRevision(key, expectedRevision) {
  if (getRevision(key) !== expectedRevision) return false;
  clear(key);
  return true;
}

function persistFile(filePath) {
  return new Promise((resolve, reject) => {
    if (!filePath || !wx.saveFile) { reject(new Error('saveFile unavailable')); return; }
    wx.saveFile({
      tempFilePath: filePath,
      success: (res) => resolve(res.savedFilePath),
      fail: reject
    });
  });
}

module.exports = {
  scopedKey, load, save, clear, clearIfRevision, getRevision,
  cleanupExpired, persistFile, discardFiles, MAX_AGE_MS
};
