const assert = require('assert');
const fs = require('fs');
const path = require('path');

const storage = {};
const removedFiles = [];
const navigations = [];
const toasts = [];
const modals = [];
const failedReads = new Set();
let failDraftStorage = false;

const PRICES = {
  'avatar.create': 2,
  'video.cinematic.motion': 10, 'video.cinematic.duo': 30, 'video.cinematic.open': 10,
  'video.talking.block': 30, 'video.tryon.single': 25, 'video.tryon.double': 40,
  'video.grok.v1.480p': 10, 'video.grok.v1.720p': 12, 'video.grok.v1_5.720p': 25,
  'video.seedance': 30, 'video.omni': 30,
  'video.sora.standard.720p': 30, 'video.sora.pro.720p': 90,
  'video.sora.pro.1024p': 150, 'video.sora.pro.1080p': 210
};

function savedPath(tempFilePath) {
  return 'wxfile://saved' + (String(tempFilePath).charAt(0) === '/' ? '' : '/') + tempFilePath;
}

global.getApp = () => ({ globalData: { apiBase: 'https://example.test' } });
global.getCurrentPages = () => [];
global.wx = {
  getStorageSync: (key) => storage[key],
  setStorageSync: (key, value) => {
    if (failDraftStorage && /^hq_draft_video_/.test(key)) throw new Error('storage full');
    storage[key] = value;
  },
  removeStorageSync: (key) => { delete storage[key]; },
  saveFile: ({ tempFilePath, success }) => success({ savedFilePath: savedPath(tempFilePath) }),
  removeSavedFile: ({ filePath, complete }) => {
    removedFiles.push(filePath);
    if (complete) complete();
  },
  getFileSystemManager: () => ({
    readFile: ({ filePath, success, fail }) => {
      if (failedReads.has(filePath)) { fail(new Error('missing saved file')); return; }
      success({ data: Buffer.from(String(filePath)).toString('base64') });
    }
  }),
  showToast: (options) => { toasts.push(options); },
  showModal: (options) => { modals.push(options); },
  showActionSheet: () => {},
  navigateTo: ({ url }) => { navigations.push(url); },
  reLaunch: () => {},
  requestSubscribeMessage: null
};

let videoPage;
global.Page = (definition) => { videoPage = definition; };
require('../miniprogram/pages/video/video.js');

const api = require('../miniprogram/utils/api.js');
const drafts = require('../miniprogram/utils/drafts.js');

function setByPath(target, key, value) {
  const parts = String(key).replace(/\[(\d+)\]/g, '.$1').split('.');
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (cursor[parts[i]] == null) cursor[parts[i]] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    cursor = cursor[parts[i]];
  }
  cursor[parts[parts.length - 1]] = value;
}

function makeContext() {
  const context = Object.assign({}, videoPage);
  context.data = JSON.parse(JSON.stringify(videoPage.data));
  context.setData = function setData(patch, callback) {
    Object.keys(patch || {}).forEach((key) => setByPath(this.data, key, patch[key]));
    if (callback) callback.call(this);
  };
  context._pollToken = 0;
  context._batchBid = 0;
  context._draftDirty = {};
  context._draftRevision = {};
  context._draftRestoreToken = 0;
  context._mediaTokens = {};
  context._lifecycleToken = 0;
  context._avatarFetchToken = 0;
  context._modeInitialized = true;
  context._voicesLoaded = true;
  context._avatarsLoaded = true;
  context._subscriptionPending = false;
  context._resetB64();
  context._applyPricing(PRICES);
  return context;
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function saveTextDraft(context, mode, text) {
  context.data.mode = mode;
  if (mode === 'generate') context.data.prompt = text;
  else context.data.talkText = text;
  context._draftDirty[mode] = true;
  assert.strictEqual(context._saveCurrentDraft(), true);
  return context._draftKey(mode);
}

(async function run() {
  storage.hq_token = 'account-a-token';

  // 大模式切换必须先保存旧模式，并从持久文件恢复 base64；storage 中不能出现 base64 正文。
  const modeContext = makeContext();
  modeContext.data.mode = 'generate';
  const ref = await modeContext._persistAndRead('/tmp/reference.jpg', 'image/jpeg');
  modeContext.data.prompt = '一只黄雀从霓虹城市上空飞过';
  modeContext.data.refPreviews = [ref.path];
  modeContext._b64.refImgs = [ref.data];
  modeContext._draftDirty.generate = true;
  const generateKey = modeContext._draftKey('generate');
  const pendingReferenceToken = modeContext._nextMediaToken('generate_refs');
  modeContext._setMode('talking');
  assert.strictEqual(modeContext._mediaIsCurrent('generate_refs', pendingReferenceToken, 'generate'), false,
    'switching modes must invalidate in-flight media work');

  assert.ok(storage[generateKey], 'switching mode should persist the source draft');
  assert.deepStrictEqual(storage[generateKey].files, [ref.path]);
  assert.ok(storage[generateKey].files.every((filePath) => filePath.indexOf('wxfile://saved') === 0));
  assert.ok(!/;base64,|data:image/.test(JSON.stringify(storage[generateKey])));

  const person = await modeContext._persistAndRead('/tmp/person.png', 'image/png');
  const audio = await modeContext._persistAndRead('/tmp/speech.mp3', 'audio/mpeg');
  modeContext.data.talkText = '这是数字人口播草稿';
  modeContext.data.talkImgPath = person.path;
  modeContext.data.talkImgPreview = person.path;
  modeContext.data.talkAudioPath = audio.path;
  modeContext.data.talkAudioName = 'speech.mp3';
  modeContext._b64.talkImg = person.data;
  modeContext._b64.talkAudio = audio.data;
  modeContext._draftDirty.talking = true;
  const talkingKey = modeContext._draftKey('talking');

  modeContext._setMode('generate');
  await flush();
  assert.strictEqual(modeContext.data.prompt, '一只黄雀从霓虹城市上空飞过');
  assert.deepStrictEqual(modeContext.data.refPreviews, [ref.path]);
  assert.match(modeContext._b64.refImgs[0], /^data:image\/jpeg;base64,/);
  assert.notStrictEqual(generateKey, talkingKey, 'each big mode needs an independent draft slot');

  modeContext._setMode('talking');
  await flush();
  assert.strictEqual(modeContext.data.talkText, '这是数字人口播草稿');
  assert.strictEqual(modeContext.data.talkImgPreview, person.path);
  assert.match(modeContext._b64.talkImg, /^data:image\/png;base64,/);
  assert.match(modeContext._b64.talkAudio, /^data:audio\/mpeg;base64,/);
  const accountAKey = modeContext._draftKey('talking');
  storage.hq_token = 'account-b-token';
  assert.notStrictEqual(accountAKey, modeContext._draftKey('talking'), 'draft keys must be account scoped');
  storage.hq_token = 'account-a-token';

  // 持久媒体缺失时要剔除坏路径、保留可读部分，并把清理结果写回三个可见模式草稿。
  storage.hq_token = 'restore-suite-token';
  const restoreGenerate = makeContext();
  restoreGenerate.data.mode = 'generate';
  const goodGenerateRef = 'wxfile://saved/restore-good.jpg';
  const badGenerateRef = 'wxfile://saved/restore-missing.jpg';
  const restoreGenerateKey = restoreGenerate._draftKey('generate');
  drafts.save(restoreGenerateKey, {
    mode: 'generate', engine: 'grok', ratio: '9:16', prompt: '恢复参考图',
    refFiles: [goodGenerateRef, badGenerateRef], grokModel: 'grok-imagine-video', grokRes: '720p', grokDur: 10
  }, [goodGenerateRef, badGenerateRef]);
  failedReads.add(badGenerateRef);
  restoreGenerate._restoreDraft('generate');
  await flush();
  assert.deepStrictEqual(restoreGenerate.data.refPreviews, [goodGenerateRef]);
  assert.strictEqual(restoreGenerate._b64.refImgs.length, 1);
  assert.deepStrictEqual(storage[restoreGenerateKey].payload.refFiles, [goodGenerateRef]);
  assert.deepStrictEqual(storage[restoreGenerateKey].files, [goodGenerateRef]);

  const restoreTalking = makeContext();
  restoreTalking.data.mode = 'talking';
  restoreTalking.data.avatars = [{ id: 4, name: '云形象' }];
  const goodTalkAudio = 'wxfile://saved/restore-good.mp3';
  const badTalkImage = 'wxfile://saved/restore-missing-person.jpg';
  const badBatchImage = 'wxfile://saved/restore-missing-batch.jpg';
  const restoreTalkingKey = restoreTalking._draftKey('talking');
  drafts.save(restoreTalkingKey, {
    mode: 'talking', ratio: '9:16', talkMode: 'audio', talkBatch: true,
    talkImgPath: badTalkImage, talkText: '恢复口播', talkAudioPath: goodTalkAudio, talkAudioName: 'good.mp3',
    talkRes: '1080p', batchItems: [{ kind: 'avatar', id: 4, label: '云形象' }, { kind: 'image', path: badBatchImage, label: '坏照片' }]
  }, [badTalkImage, goodTalkAudio, badBatchImage]);
  failedReads.add(badTalkImage); failedReads.add(badBatchImage);
  restoreTalking._restoreDraft('talking');
  await flush();
  assert.strictEqual(restoreTalking.data.talkImgPath, '');
  assert.match(restoreTalking._b64.talkAudio, /^data:audio\/mpeg;base64,/);
  assert.deepStrictEqual(restoreTalking.data.batchItems.map((item) => item.kind), ['avatar']);
  assert.strictEqual(storage[restoreTalkingKey].payload.talkImgPath, '');
  assert.deepStrictEqual(storage[restoreTalkingKey].payload.batchItems.map((item) => item.kind), ['avatar']);
  assert.deepStrictEqual(storage[restoreTalkingKey].files, [goodTalkAudio]);

  const restoreCinematic = makeContext();
  restoreCinematic.data.mode = 'cinematic';
  restoreCinematic.data.avatars = [{ id: 1, name: '电影形象' }];
  const goodCineVideo = 'wxfile://saved/restore-good.mp4';
  const badCineVideo = 'wxfile://saved/restore-missing-motion.mp4';
  const badCineImage = 'wxfile://saved/restore-missing-cine.jpg';
  const restoreCinematicKey = restoreCinematic._draftKey('cinematic');
  drafts.save(restoreCinematicKey, {
    mode: 'cinematic', ratio: '9:16', cineMode: 'open', avatarIds: [1],
    cineVideoPath: badCineVideo, cineVideoName: '坏动作视频', cinePrompt: '恢复电影化身',
    cineRefVideos: [{ path: goodCineVideo, name: '好参考视频', dur: 8 }], cineRefImages: [badCineImage],
    cineRes: '720p', cineDur: 8
  }, [badCineVideo, goodCineVideo, badCineImage]);
  failedReads.add(badCineVideo); failedReads.add(badCineImage);
  restoreCinematic._restoreDraft('cinematic');
  await flush();
  assert.strictEqual(restoreCinematic.data.cineVideoPath, '');
  assert.deepStrictEqual(restoreCinematic.data.cineRefVideos.map((item) => item.path), [goodCineVideo]);
  assert.deepStrictEqual(restoreCinematic.data.cineRefPreviews, []);
  assert.strictEqual(storage[restoreCinematicKey].payload.cineVideoPath, '');
  assert.deepStrictEqual(storage[restoreCinematicKey].files, [goodCineVideo]);
  failedReads.clear();

  // IP12 一次性带入的两类提示词也要立即进入各自草稿，退出页面不会丢。
  storage.hq_token = 'prefill-suite-token';
  storage.hq_ip12_prefill_script = { prompt: 'IP12 口播文案' };
  storage.hq_ip12_prefill_video = { prompt: 'IP12 视频计划' };
  const prefillContext = makeContext();
  prefillContext.data.mode = 'cinematic';
  prefillContext._preloadSubscriptionTemplate = () => {};
  prefillContext.refreshPoints = () => {};
  prefillContext.refreshVideoChannels = () => {};
  prefillContext.fetchVoices = () => {};
  prefillContext.onShow();
  assert.strictEqual(storage[prefillContext._draftKey('talking')].payload.talkText, 'IP12 口播文案');
  assert.strictEqual(storage[prefillContext._draftKey('generate')].payload.prompt, 'IP12 视频计划');
  assert.strictEqual(storage.hq_ip12_prefill_script, undefined);
  assert.strictEqual(storage.hq_ip12_prefill_video, undefined);

  // 会截断/清空参考图的动作必须先确认，取消时保留当前草稿和文件。
  storage.hq_token = 'confirm-suite-token';
  const confirmContext = makeContext();
  confirmContext.data.mode = 'generate';
  const confirmRefs = ['wxfile://saved/confirm-1.jpg', 'wxfile://saved/confirm-2.jpg', 'wxfile://saved/confirm-3.jpg'];
  confirmContext.data.refPreviews = confirmRefs.slice();
  confirmContext._b64.refImgs = confirmRefs.map((item) => 'data:image/jpeg;base64,' + Buffer.from(item).toString('base64'));
  confirmContext._draftDirty.generate = true;
  confirmContext._saveCurrentDraft();
  confirmContext.selectEngine({ currentTarget: { dataset: { k: 'sora' } } });
  let destructiveModal = modals[modals.length - 1];
  destructiveModal.success({ confirm: false });
  assert.deepStrictEqual(confirmContext.data.refPreviews, confirmRefs);
  assert.deepStrictEqual(storage[confirmContext._draftKey('generate')].files, confirmRefs);
  const modalCount = modals.length;
  confirmContext.selectGrokModel({ currentTarget: { dataset: { k: 'grok-imagine-video-1.5' } } });
  assert.strictEqual(modals.length, modalCount, '高清 1.5 支持多图，不应弹出删除确认');
  assert.strictEqual(confirmContext.data.engineRefMax, 7);
  assert.deepStrictEqual(confirmContext.data.grokResList, ['720p']);
  assert.deepStrictEqual(confirmContext.data.refPreviews, confirmRefs);
  confirmContext.clearRef();
  destructiveModal = modals[modals.length - 1];
  destructiveModal.success({ confirm: false });
  assert.deepStrictEqual(confirmContext.data.refPreviews, confirmRefs);
  confirmContext.clearRef();
  destructiveModal = modals[modals.length - 1];
  destructiveModal.success({ confirm: true });
  assert.deepStrictEqual(confirmContext.data.refPreviews, []);
  assert.deepStrictEqual(storage[confirmContext._draftKey('generate')].files, []);

  const cineConfirmContext = makeContext();
  cineConfirmContext.data.mode = 'cinematic';
  cineConfirmContext.data.cineMode = 'open';
  cineConfirmContext.data.cinePrompt = '不能静默丢失的开放式描述';
  cineConfirmContext.data.cineRefVideos = [{ path: 'wxfile://saved/open-ref.mp4', name: '开放式参考', dur: 8 }];
  cineConfirmContext.data.cineRefPreviews = ['wxfile://saved/open-ref.jpg'];
  cineConfirmContext._b64.cineRefVideos = ['data:video/mp4;base64,T1BFTg=='];
  cineConfirmContext._b64.cineRefImgs = ['data:image/jpeg;base64,T1BFTg=='];
  cineConfirmContext._draftDirty.cinematic = true;
  cineConfirmContext._saveCurrentDraft();
  cineConfirmContext.selectCineMode({ currentTarget: { dataset: { k: 'motion' } } });
  destructiveModal = modals[modals.length - 1];
  destructiveModal.success({ confirm: false });
  assert.strictEqual(cineConfirmContext.data.cineMode, 'open');
  assert.strictEqual(cineConfirmContext.data.cinePrompt, '不能静默丢失的开放式描述');
  assert.strictEqual(storage[cineConfirmContext._draftKey('cinematic')].payload.cinePrompt, '不能静默丢失的开放式描述');

  storage.hq_token = 'account-a-token';

  // 页面级保存失败时，不能留下无法恢复的假预览。
  const failureContext = makeContext();
  failureContext.data.mode = 'generate';
  failureContext.data.refPreviews = ['wxfile://saved/tmp/orphan.jpg'];
  failureContext._b64.refImgs = ['data:image/jpeg;base64,T1JQSEFO'];
  failureContext._draftDirty.generate = true;
  failDraftStorage = true;
  assert.strictEqual(failureContext._saveCurrentDraft(), false);
  failDraftStorage = false;
  assert.deepStrictEqual(failureContext.data.refPreviews, []);
  assert.deepStrictEqual(failureContext._b64.refImgs, []);
  assert.strictEqual(failureContext.data.draftStatus, '媒体自动保存失败，请重新选择');
  assert.ok(removedFiles.includes('wxfile://saved/tmp/orphan.jpg'));

  // 手动清空必须经过原生确认，取消时不得动存储。
  const clearContext = makeContext();
  clearContext.data.mode = 'generate';
  const clearKey = saveTextDraft(clearContext, 'generate', '等待用户确认清空');
  clearContext.clearCurrentDraft();
  const clearModal = modals[modals.length - 1];
  assert.strictEqual(clearModal.title, '清空当前草稿');
  assert.ok(storage[clearKey]);
  clearModal.success({ confirm: false });
  assert.ok(storage[clearKey]);
  clearModal.success({ confirm: true });
  assert.strictEqual(storage[clearKey], undefined);

  // 卸载也要让所有尚未完成的媒体选择失效。
  const unloadContext = makeContext();
  unloadContext.data.mode = 'generate';
  const unloadMediaToken = unloadContext._nextMediaToken('generate_edit');
  unloadContext.onUnload();
  assert.strictEqual(unloadContext._mediaIsCurrent('generate_edit', unloadMediaToken, 'generate'), false);

  // 删除成功后，同步清理电影化身和批量口播的选择映射，再刷新列表。
  const avatarContext = makeContext();
  avatarContext.data.mode = 'talking';
  avatarContext.data.avatars = [{ id: 7, name: '旧形象' }, { id: 8, name: '保留形象' }];
  avatarContext._setAvatarIds([7, 8]);
  const keptPhotoPath = 'wxfile://saved/kept-batch-person.jpg';
  avatarContext._b64.batch_19 = 'data:image/jpeg;base64,S0VFUA==';
  avatarContext._setBatchItems([
    { kind: 'avatar', id: 7, label: '旧形象' },
    { kind: 'avatar', id: 8, label: '保留形象' },
    { kind: 'image', id: 0, bid: 19, path: keptPhotoPath, preview: keptPhotoPath, label: '保留照片' }
  ]);
  const cinematicDraftPath = 'wxfile://saved/cinematic-reference.mp4';
  const cinematicDraftKey = avatarContext._draftKey('cinematic');
  drafts.save(cinematicDraftKey, {
    mode: 'cinematic', avatarIds: [7, 8], cineRefVideos: [{ path: cinematicDraftPath }], cineRefImages: []
  }, [cinematicDraftPath]);
  const avatarCalls = [];
  api.request = (endpoint, options) => {
    avatarCalls.push({ endpoint, options });
    if (endpoint === '/api/gen/video/avatar-delete') return Promise.resolve({ statusCode: 200, data: { ok: true } });
    if (endpoint === '/api/gen/video/avatar-name') return Promise.resolve({ statusCode: 200, data: { ok: true } });
    if (endpoint === '/api/gen/video/avatars') {
      return Promise.resolve({ statusCode: 200, data: { items: [{ id: 8, name: '新名字', image_url: '', status: 'ready' }] } });
    }
    throw new Error('unexpected endpoint ' + endpoint);
  };
  await avatarContext._deleteAvatarRequest(7);
  assert.deepStrictEqual(avatarContext.data.avatarIds, [8]);
  assert.strictEqual(avatarContext.data.avatarSelMap[7], undefined);
  assert.strictEqual(avatarContext.data.avatarSelMap[8], true);
  assert.deepStrictEqual(avatarContext.data.batchItems.map((item) => item.kind + ':' + (item.id || item.bid)), ['avatar:8', 'image:19']);
  assert.strictEqual(avatarContext.data.batchSelMap[7], undefined);
  assert.strictEqual(avatarContext.data.batchSelMap[8], true);
  assert.strictEqual(avatarContext._b64.batch_19, 'data:image/jpeg;base64,S0VFUA==');
  assert.ok(!removedFiles.includes(keptPhotoPath));
  assert.deepStrictEqual(storage[cinematicDraftKey].payload.avatarIds, [8]);
  assert.deepStrictEqual(storage[cinematicDraftKey].files, [cinematicDraftPath]);
  assert.ok(!removedFiles.includes(cinematicDraftPath));
  assert.deepStrictEqual(avatarCalls[0], {
    endpoint: '/api/gen/video/avatar-delete',
    options: { method: 'POST', data: { id: 7 } }
  });
  await avatarContext._renameAvatarRequest(8, '新名字');
  assert.ok(avatarCalls.some((call) => call.endpoint === '/api/gen/video/avatar-name'
    && call.options.method === 'POST' && call.options.data.id === 8 && call.options.data.name === '新名字'));

  // 删除已成功但列表刷新失败时，也必须立即从当前可见列表移除。
  const failedRefreshContext = makeContext();
  failedRefreshContext.data.mode = 'talking';
  failedRefreshContext.data.avatars = [{ id: 7, name: '旧形象' }, { id: 8, name: '保留形象' }];
  api.request = (endpoint) => endpoint === '/api/gen/video/avatar-delete'
    ? Promise.resolve({ statusCode: 200, data: { ok: true } })
    : Promise.reject(new Error('avatar refresh failed'));
  await failedRefreshContext._deleteAvatarRequest(7);
  assert.deepStrictEqual(failedRefreshContext.data.avatars.map((item) => item.id), [8]);

  // 临时 HTTP 错误不是权威空列表，不能清页面或跨模式草稿。
  const failedListContext = makeContext();
  failedListContext.data.avatars = [{ id: 7, name: '仍存在的形象' }];
  const failedCinematicKey = failedListContext._draftKey('cinematic');
  const failedTalkingKey = failedListContext._draftKey('talking');
  drafts.save(failedCinematicKey, { mode: 'cinematic', avatarIds: [7] }, []);
  drafts.save(failedTalkingKey, {
    mode: 'talking', batchItems: [{ kind: 'avatar', id: 7, label: '仍存在的形象' }]
  }, []);
  api.request = () => Promise.resolve({ statusCode: 500, data: { detail: 'temporary failure' } });
  await failedListContext.fetchAvatars({ selectDefault: false });
  assert.deepStrictEqual(failedListContext.data.avatars.map((item) => item.id), [7]);
  assert.deepStrictEqual(storage[failedCinematicKey].payload.avatarIds, [7]);
  assert.deepStrictEqual(storage[failedTalkingKey].payload.batchItems.map((item) => item.id), [7]);

  // 旧列表的受保护缩略图晚返回时，不能按旧下标污染刷新后的新人物卡片。
  const staleAvatarContext = makeContext();
  const firstAvatarList = deferred();
  const secondAvatarList = deferred();
  const staleThumbnail = deferred();
  let avatarListCall = 0;
  api.request = () => { avatarListCall += 1; return avatarListCall === 1 ? firstAvatarList.promise : secondAvatarList.promise; };
  api.downloadProtected = () => staleThumbnail.promise;
  const firstFetch = staleAvatarContext.fetchAvatars({ selectDefault: false });
  firstAvatarList.resolve({ statusCode: 200, data: { items: [{ id: 7, name: '已删除', image_url: '/api/gen/file/old.jpg' }] } });
  await flush();
  const secondFetch = staleAvatarContext.fetchAvatars({ selectDefault: false });
  secondAvatarList.resolve({ statusCode: 200, data: { items: [{ id: 8, name: '新人物', image_url: '' }] } });
  await secondFetch;
  staleThumbnail.resolve('wxfile://tmp/old-avatar.jpg');
  await firstFetch;
  await flush();
  assert.strictEqual(staleAvatarContext.data.avatars[0].id, 8);
  assert.strictEqual(staleAvatarContext.data.avatars[0].image, '');

  // 已知形象列表时，恢复旧草稿也不能重新选中列表中已不存在的人物。
  const prunedRestoreContext = makeContext();
  prunedRestoreContext.data.mode = 'cinematic';
  prunedRestoreContext.data.avatars = [{ id: 8, name: '保留形象' }];
  prunedRestoreContext._avatarsLoaded = true;
  const prunedRestoreKey = prunedRestoreContext._draftKey('cinematic');
  drafts.save(prunedRestoreKey, { mode: 'cinematic', avatarIds: [7, 8] }, []);
  prunedRestoreContext._restoreDraft('cinematic');
  assert.deepStrictEqual(prunedRestoreContext.data.avatarIds, [8]);
  assert.deepStrictEqual(storage[prunedRestoreKey].payload.avatarIds, [8]);

  // 只有拿到有效任务编号才清草稿；未知或无效返回必须保留，避免用户内容丢失。
  const submitContext = makeContext();
  const submittedJobs = [];
  submitContext.startPolling = (jobId) => { submittedJobs.push(jobId); };
  submitContext.startBatchPolling = () => {};
  submitContext.data.mode = 'generate';

  // 订阅授权尚未完成就卸载页面时，不得在后台发起新的付费 POST（单条与批量同样处理）。
  const preflightContext = makeContext();
  preflightContext.data.mode = 'generate';
  preflightContext.data.prompt = '卸载后不能提交';
  preflightContext._draftDirty.generate = true;
  const preflightSubscription = deferred();
  preflightContext._requestWorkCompleteSubscription = () => preflightSubscription.promise;
  let postAfterUnload = 0;
  api.request = (path) => {
    if (path === '/api/gen/pricing') {
      return Promise.resolve({ statusCode: 200, data: { items: Object.keys(PRICES).map((key) => ({ key, points: PRICES[key] })) } });
    }
    postAfterUnload += 1;
    return Promise.resolve({ statusCode: 200, data: { job_id: 'should-not-run' } });
  };
  preflightContext.submitJob('/api/gen/xiaole_video', {
    channel: 'grok', model: 'grok-imagine-video', resolution: '480p', duration: 1
  }, 10);
  preflightContext.onUnload();
  preflightSubscription.resolve();
  await flush();
  assert.strictEqual(postAfterUnload, 0);

  const batchPreflight = makeContext();
  batchPreflight.data.mode = 'talking';
  batchPreflight.data.talkText = '批量卸载测试';
  batchPreflight.data.voiceKey = 'voice';
  batchPreflight._setBatchItems([{ kind: 'avatar', id: 1, label: 'A' }, { kind: 'avatar', id: 2, label: 'B' }]);
  const batchSubscription = deferred();
  batchPreflight._requestWorkCompleteSubscription = () => batchSubscription.promise;
  batchPreflight.submitTalkingBatch();
  batchPreflight.onUnload();
  batchSubscription.resolve();
  await flush();
  assert.strictEqual(postAfterUnload, 0);

  // 订阅授权尚未完成就切到后台时不得提交；回到前台的新提交也不能被旧 Promise 干扰。
  const hiddenPreflight = makeContext();
  hiddenPreflight.data.mode = 'generate';
  hiddenPreflight.data.prompt = '前后台切换后的新提交';
  hiddenPreflight.startPolling = () => {};
  hiddenPreflight._preloadSubscriptionTemplate = () => {};
  hiddenPreflight.refreshPoints = () => {};
  hiddenPreflight.refreshVideoChannels = () => {};
  const hiddenSubscriptions = [deferred()];
  let hiddenSubscriptionIndex = 0;
  hiddenPreflight._requestWorkCompleteSubscription = () => hiddenSubscriptions[hiddenSubscriptionIndex++].promise;
  const hiddenPosts = [];
  api.request = (endpoint, options) => {
    if (endpoint === '/api/gen/pricing') {
      return Promise.resolve({ statusCode: 200, data: { items: Object.keys(PRICES).map((key) => ({ key, points: PRICES[key] })) } });
    }
    hiddenPosts.push({ endpoint, options });
    return Promise.resolve({ statusCode: 200, data: { job_id: 'foreground-job' } });
  };
  const hiddenBody = { channel: 'grok', model: 'grok-imagine-video', resolution: '480p', duration: 1 };
  hiddenPreflight.submitJob('/api/gen/xiaole_video', hiddenBody, 10);
  hiddenPreflight.onHide();
  hiddenPreflight.onShow();
  hiddenPreflight.submitJob('/api/gen/xiaole_video', hiddenBody, 10);
  await flush();
  assert.strictEqual(hiddenPreflight._subscriptionPending, true,
    'the foreground submit should wait for its subscription choice');
  assert.strictEqual(hiddenPosts.length, 0);
  hiddenSubscriptions[0].resolve();
  await flush();
  assert.deepStrictEqual(hiddenPosts.map((item) => item.endpoint), ['/api/gen/xiaole_video']);

  const hiddenBatchPreflight = makeContext();
  hiddenBatchPreflight.data.mode = 'talking';
  hiddenBatchPreflight.data.talkText = '批量前后台切换';
  hiddenBatchPreflight.data.voiceKey = 'voice';
  hiddenBatchPreflight._setBatchItems([{ kind: 'avatar', id: 1, label: 'A' }, { kind: 'avatar', id: 2, label: 'B' }]);
  hiddenBatchPreflight.startBatchPolling = () => {};
  hiddenBatchPreflight._preloadSubscriptionTemplate = () => {};
  hiddenBatchPreflight.refreshPoints = () => {};
  hiddenBatchPreflight.refreshVideoChannels = () => {};
  hiddenBatchPreflight.fetchVoices = () => {};
  const hiddenBatchSubscriptions = [deferred()];
  let hiddenBatchSubscriptionIndex = 0;
  hiddenBatchPreflight._requestWorkCompleteSubscription = () => hiddenBatchSubscriptions[hiddenBatchSubscriptionIndex++].promise;
  const hiddenBatchPosts = [];
  api.request = (endpoint, options) => {
    if (endpoint === '/api/gen/pricing') {
      return Promise.resolve({ statusCode: 200, data: { items: Object.keys(PRICES).map((key) => ({ key, points: PRICES[key] })) } });
    }
    hiddenBatchPosts.push({ endpoint, options });
    return Promise.resolve({ statusCode: 200, data: { jobs: [{ job_id: 'foreground-batch-job', label: 'A' }] } });
  };
  hiddenBatchPreflight.submitTalkingBatch();
  hiddenBatchPreflight.onHide();
  hiddenBatchPreflight.onShow();
  hiddenBatchPreflight.submitTalkingBatch();
  await flush();
  assert.strictEqual(hiddenBatchPreflight._subscriptionPending, true);
  assert.strictEqual(hiddenBatchPosts.length, 0);
  hiddenBatchSubscriptions[0].resolve();
  await flush();
  assert.deepStrictEqual(hiddenBatchPosts.map((item) => item.endpoint), ['/api/gen/video/batch']);

  let submitResponse = { statusCode: 200, data: { job_id: 'job-valid-1', cost: 10, points_left: 90 } };
  api.request = () => Promise.resolve(submitResponse);
  const acceptedKey = saveTextDraft(submitContext, 'generate', '有效任务提交前的草稿');
  submitContext._submitJobRequest('/api/gen/xiaole_video', { channel: 'grok' }, 10, 'generate');
  await flush();
  assert.strictEqual(storage[acceptedKey], undefined);
  assert.deepStrictEqual(submittedJobs, ['job-valid-1']);

  submitContext.setData({ busy: false });
  const retainedKey = saveTextDraft(submitContext, 'generate', '无任务编号时必须保留');
  submitResponse = { statusCode: 200, data: {} };
  submitContext._submitJobRequest('/api/gen/xiaole_video', { channel: 'grok' }, 10, 'generate');
  await flush();
  assert.ok(storage[retainedKey]);
  submitContext.setData({ busy: false });
  submitResponse = { statusCode: 500, data: { job_id: 'must-not-accept-on-500' } };
  submitContext._submitJobRequest('/api/gen/xiaole_video', { channel: 'grok' }, 10, 'generate');
  await flush();
  assert.ok(storage[retainedKey], 'a job id on a non-2xx response must not clear the draft');

  // 同页提交后的新编辑，以及另一页面写入的新草稿，都不能被旧响应清掉。
  const editedContext = makeContext();
  editedContext.data.mode = 'generate';
  editedContext.startPolling = () => {};
  const editedKey = saveTextDraft(editedContext, 'generate', '提交时的内容');
  const editedResponse = deferred();
  api.request = () => editedResponse.promise;
  editedContext._submitJobRequest('/api/gen/xiaole_video', {}, 10, 'generate');
  editedContext.onPrompt({ detail: { value: '提交后继续编辑的新内容' } });
  editedContext._saveCurrentDraft();
  editedResponse.resolve({ statusCode: 200, data: { job_id: 'late-job-after-edit' } });
  await flush();
  assert.strictEqual(storage[editedKey].payload.prompt, '提交后继续编辑的新内容');

  const oldPage = makeContext();
  oldPage.data.mode = 'generate';
  oldPage.startPolling = () => {};
  const sharedKey = saveTextDraft(oldPage, 'generate', '旧页面提交内容');
  const oldPageResponse = deferred();
  api.request = () => oldPageResponse.promise;
  oldPage._submitJobRequest('/api/gen/xiaole_video', {}, 10, 'generate');
  const newPage = makeContext();
  newPage.data.mode = 'generate';
  saveTextDraft(newPage, 'generate', '新页面刚写入的草稿');
  oldPageResponse.resolve({ statusCode: 200, data: { job_id: 'old-page-late-job' } });
  await flush();
  assert.strictEqual(storage[sharedKey].payload.prompt, '新页面刚写入的草稿');

  // POST 已经发出后即使卸载导致轮询 token 失效，有效 job 仍需按提交 revision 精确清草稿。
  const unloadedRequestContext = makeContext();
  unloadedRequestContext.data.mode = 'generate';
  unloadedRequestContext.startPolling = () => { throw new Error('unloaded page must not start polling'); };
  const unloadedKey = saveTextDraft(unloadedRequestContext, 'generate', '已发出请求的草稿');
  const unloadedResponse = deferred();
  api.request = () => unloadedResponse.promise;
  unloadedRequestContext._submitJobRequest('/api/gen/xiaole_video', {}, 10, 'generate');
  unloadedRequestContext.onUnload();
  unloadedResponse.resolve({ statusCode: 200, data: { job_id: 'accepted-after-unload' } });
  await flush();
  assert.strictEqual(storage[unloadedKey], undefined);

  // 旧模式请求回包只能清自己的草稿，不能打断当前模式正在进行的媒体恢复。
  const crossModeContext = makeContext();
  crossModeContext.data.mode = 'generate';
  const crossGenerateKey = saveTextDraft(crossModeContext, 'generate', '旧模式已提交');
  const crossGenerateRevision = crossModeContext._draftRevisionValue('generate');
  const crossGenerateStorageRevision = drafts.getRevision(crossGenerateKey);
  const crossTalkImage = 'wxfile://saved/cross-mode-person.jpg';
  drafts.save(crossModeContext._draftKey('talking'), {
    mode: 'talking', talkImgPath: crossTalkImage, batchItems: []
  }, [crossTalkImage]);
  const crossRestore = deferred();
  crossModeContext._readDataURLPromise = () => crossRestore.promise;
  crossModeContext.data.mode = 'talking';
  crossModeContext._restoreDraft('talking');
  const talkingRestoreToken = crossModeContext._draftRestoreToken;
  crossModeContext._clearAcceptedDraft('generate', crossGenerateStorageRevision, crossGenerateRevision, false);
  assert.strictEqual(crossModeContext._draftRestoreToken, talkingRestoreToken);
  crossRestore.resolve('data:image/jpeg;base64,Q1JPU1M=');
  await flush();
  assert.strictEqual(crossModeContext.data.draftRestoring, false);
  assert.strictEqual(crossModeContext._b64.talkImg, 'data:image/jpeg;base64,Q1JPU1M=');

  const hiddenPage = makeContext();
  hiddenPage.data.mode = 'generate';
  hiddenPage.startPolling = () => {};
  const hiddenKey = saveTextDraft(hiddenPage, 'generate', '离开页面时保留');
  const hiddenResponse = deferred();
  api.request = () => hiddenResponse.promise;
  hiddenPage._submitJobRequest('/api/gen/xiaole_video', {}, 10, 'generate');
  hiddenPage.onHide();
  hiddenResponse.resolve({ statusCode: 200, data: { job_id: 'hidden-page-job' } });
  await flush();
  assert.strictEqual(storage[hiddenKey], undefined,
    'an unchanged background draft must clear after a valid accepted job to avoid duplicate submission');

  api.request = () => Promise.resolve(submitResponse);
  submitContext.setData({ busy: false });
  const invalidBatchKey = saveTextDraft(submitContext, 'talking', '批量任务草稿');
  submitResponse = { statusCode: 200, data: { jobs: [{ label: '缺少任务编号' }] } };
  submitContext._submitTalkingBatchRequest({}, 30);
  await flush();
  assert.ok(storage[invalidBatchKey]);
  submitContext.setData({ busy: false });
  submitResponse = { statusCode: 500, data: { jobs: [{ job_id: 'must-not-accept-batch-on-500' }] } };
  submitContext._submitTalkingBatchRequest({}, 30);
  await flush();
  assert.ok(storage[invalidBatchKey], 'batch jobs on a non-2xx response must not clear the draft');

  submitContext.setData({ busy: false });
  submitContext._draftDirty.talking = true;
  assert.strictEqual(submitContext._saveCurrentDraft(), true);
  submitResponse = { statusCode: 200, data: { jobs: [{ job_id: 'batch-job-1', label: '形象 1', index: 1 }] } };
  submitContext._submitTalkingBatchRequest({}, 30);
  await flush();
  assert.strictEqual(storage[invalidBatchKey], undefined);

  const editedBatchContext = makeContext();
  editedBatchContext.data.mode = 'talking';
  editedBatchContext.startBatchPolling = () => {};
  const editedBatchKey = saveTextDraft(editedBatchContext, 'talking', '批量提交时文案');
  const editedBatchResponse = deferred();
  api.request = () => editedBatchResponse.promise;
  editedBatchContext._submitTalkingBatchRequest({}, 30, 'talking');
  editedBatchContext.onTalkText({ detail: { value: '批量提交后新文案' } });
  editedBatchContext._saveCurrentDraft();
  editedBatchResponse.resolve({ statusCode: 200, data: { jobs: [{ job_id: 'batch-after-edit', label: '形象 1', index: 1 }] } });
  await flush();
  assert.strictEqual(storage[editedBatchKey].payload.talkText, '批量提交后新文案');

  // 两个可见入口都走现有复刻音色页。
  videoPage.goClone.call({});
  let ip12Page;
  global.Page = (definition) => { ip12Page = definition; };
  require('../miniprogram/pages/ip12/ip12.js');
  ip12Page.goClone.call({});
  assert.deepStrictEqual(navigations.slice(-2), ['/pages/clone/clone', '/pages/clone/clone']);

  const videoView = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/video/video.wxml'), 'utf8');
  const ip12View = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/ip12/ip12.wxml'), 'utf8');
  assert.match(videoView, /catchtap="manageAvatar"/);
  assert.match(videoView, /bindtap="goClone">去复刻音色/);
  assert.match(ip12View, /bindtap="goClone">复刻音色/);
  assert.ok(toasts.some((toast) => toast.title === '已从形象列表移除'));

  console.log('video avatar, draft and clone dynamic checks passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
