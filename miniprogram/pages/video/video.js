const api = require('../../utils/api.js');
const promptTemplates = require('../../utils/prompt_templates.js');
const drafts = require('../../utils/drafts.js');
const imageMentions = require('../../utils/image_mentions.js');

const DRAFT_SAVE_DELAY = 300;

// ===== 创作模式 =====
// 2026-07-13 交接调整：老「动作模仿」后端已下线（VALID_VIDEO_MODES 只剩 text/audio），代码已删。
// 2026-07-13 二次调整：后端 7-13 上线电影化身 duo/open、口播批量、果肉 xAI 官方线，
// 「AI 视频生成」「数字化 IP」入口放开（stable:true）；换装仍藏（SHOW_UNSTABLE）。
const SHOW_UNSTABLE = false;
const MODES_ALL = [
  { key: 'cinematic', name: '电影化身', desc: '动作模仿 / 开放式生成', ready: true, stable: true },
  { key: 'generate', name: 'AI 视频生成', desc: '文生 / 图生视频', ready: true, stable: true },
  { key: 'talking', name: '数字人口播', desc: '形象 + 文案 + 音色', ready: true, stable: true },
  { key: 'tryon', name: '换装 / 换背景', desc: '图片 / 视频换装换背景', ready: true, stable: false }
];
const MODES = SHOW_UNSTABLE ? MODES_ALL : MODES_ALL.filter((m) => m.stable);
const VALID_MODES = MODES.map((m) => m.key);

// ===== 电影化身（cinematic）=====
// 三种玩法（后端 CINEMATIC_MODES）：
// - motion 单人动作模仿：正好 1 形象 + 1 参考视频，提示词后端写死，10 点/秒
// - duo    双人动作模仿：正好 2 形象 + 1 参考视频，提示词后端写死，5 点/秒
// - open   开放式生成：1~3 形象 + 自写提示词(≤2000字) + 可选参考视频/图，10 点/秒
// 2026-07-13 三次调整：双人动作模仿(duo)去掉——强哥明确该玩法上游无法生成。
// 仅从 UI 列表摘除；下方 duo 相关的 rate/avatars/分支为死代码，无害，留着不动。
const CINE_MODES = [
  { k: 'motion', name: '动作模仿', desc: '1 形象照着演 · 10点/秒' },
  { k: 'open', name: '开放式生成', desc: '自写提示词 · 10点/秒' }
];
const CINE_RATES = { motion: 10, duo: 30, open: 10 }; // 后端 CINEMATIC_RATE_PER_SEC
const CINE_NEED_AVATARS = { motion: 1, duo: 2 };   // 后端 CINEMATIC_MODE_AVATARS（「正好 N 个」）
const CINE_MAX_AVATARS = 3;                        // open 上限（后端 CINEMATIC_MAX_AVATARS）
const CINE_PROMPT_MAX = 2000;                      // 后端 CINEMATIC_PROMPT_MAX
const CINE_MAX_REF_VIDEOS = 3;                     // 后端 CINEMATIC_MAX_MEDIA_VIDEOS（仅 open 可多个）
const SUBSCRIPTION_EVENT = 'work_complete';
const TALK_AUDIO_CONSENT_VERSION = '2026-07-27-v1';
const CINE_MAX_MEDIA_IMAGES = 9;                   // 后端：形象数+参考图 ≤ 9
const AVATAR_COST = 2;                     // 建形象 2 点（后端 AVATAR_COST，失败自动退点）
const CINE_DURATIONS = [                   // motion/duo：后端仅支持 自适应 / 10 / 15
  { v: 'auto', name: '自适应' }, { v: 10, name: '10 秒' }, { v: 15, name: '15 秒' }
];
const CINE_DURATIONS_OPEN = [              // open：后端 4~15 秒任意整数或 auto，取常用档
  { v: 'auto', name: '自适应' }, { v: 5, name: '5 秒' }, { v: 8, name: '8 秒' },
  { v: 10, name: '10 秒' }, { v: 12, name: '12 秒' }, { v: 15, name: '15 秒' }
];
const RATIOS_CINE = ['9:16', '16:9', '1:1'];  // 后端 _HEYGEN_CINEMATIC_RATIOS
const RES_CINE = ['720p', '1080p'];

// ===== AI 视频生成引擎 =====
// 官方通道只在 /api/gen/health 明确开启后展示；健康请求失败时保守保留果肉线。
const ENGINES_ALL = [
  { key: 'grok', name: '果肉视频', desc: '文生/图生·写实', ref: true, maxRef: 7 },
  { key: 'micro', name: '黄豆视频', desc: '官方有声·4–15 秒', ref: true, maxRef: 9 },
  { key: 'omni', name: '欧米视频', desc: '官方有声·3–10 秒', ref: true, maxRef: 6 },
  { key: 'sora', name: 'Sora 2', desc: '限时测试·单图首帧', ref: true, maxRef: 1 }
];
const ENGINES = [ENGINES_ALL[0]];
const OFFICIAL_VIDEO = {
  micro: {
    name: '黄豆视频', model: 'doubao-seedance-2-0-260128',
    durations: [5, 8, 10, 15], ratios: ['9:16', '16:9', '1:1', '4:3', '3:4'],
    resolutions: ['720p', '1080p'], defaultRatio: '9:16', maxRef: 9
  },
  omni: {
    name: '欧米视频', model: 'gemini-omni-flash-preview',
    durations: [3, 5, 8, 10], ratios: ['9:16', '16:9'],
    resolutions: ['720p'], defaultRatio: '16:9', maxRef: 6
  }
};
const SORA_VIDEO = {
  models: [
    { k: 'sora-2', name: 'Sora 2', desc: '720p · 30 点/秒' },
    { k: 'sora-2-pro', name: 'Sora 2 Pro', desc: '最高 1080p' }
  ],
  durations: [4, 8, 12],
  ratios: ['9:16', '16:9'],
  resolutions: {
    'sora-2': ['720p'],
    'sora-2-pro': ['720p', '1024p', '1080p']
  },
  rates: {
    'sora-2:720p': 30,
    'sora-2-pro:720p': 90,
    'sora-2-pro:1024p': 150,
    'sora-2-pro:1080p': 210
  }
};
function soraResolutions(model) { return SORA_VIDEO.resolutions[model] || SORA_VIDEO.resolutions['sora-2']; }
function officialVideoRequestKey() {
  return 'mp-video-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}
// 果肉官方线：模型 × 分辨率 × 时长动态计价；参考图不额外收点。
const GROK_MODELS = [
  { k: 'grok-imagine-video', name: '标准 1.0', desc: '480p/720p' },
  { k: 'grok-imagine-video-1.5', name: '高清 1.5', desc: '参考图·720p' }
];
const GROK_PRICE = {
  'grok-imagine-video': { '480p': 10, '720p': 12 },
  'grok-imagine-video-1.5': { '720p': 25 }
};
const GROK_DURATIONS = [5, 8, 10];
const VIDEO_COST = 30;       // 口播最低一档：1~30 秒 30 点
const VIDEO_BATCH_MAX = 5;   // 口播批量：一段文案 × 最多 5 个形象（后端 VIDEO_BATCH_MAX）
const TRYON_COST_SINGLE = 25; // 换装/换背景单段：后端 cost_of('tryon') 单段25/两段40，以返回 cost 为准

// 比例按后端校验分两套：
// - 生成模式(xiaole_video)：果肉官方线(xAI)仅支持 1:1/16:9/9:16/4:3/3:4/3:2/2:3，取常用 5 种
// - 口播/动作(/api/gen/video)：后端 VALID_VIDEO_RATIOS = 9:16/16:9/1:1/4:5/5:4
const RATIOS_GEN = ['9:16', '16:9', '1:1', '4:3', '3:4'];
const RATIOS_VIDEO = ['9:16', '16:9', '1:1', '4:5', '5:4'];
const RES_FULL = ['720p', '1080p'];  // 后端 VALID_VIDEO_RESOLUTIONS 仅 720p/1080p
const GEN_MAX_REF = 7;               // 果肉图生视频参考图上限（后端 XIAOLE_MAX_REF，#626 从 1 升到 7）

// 换装子类型（生产 /api/gen/tryon 强制 person_video_data，故仅支持"视频换装/视频换背景"）
const TRYON_TYPES = [
  { key: 'video_clothes', name: '视频换装', desc: '人物视频 + 衣服图' },
  { key: 'video_bg', name: '视频换背景', desc: '人物视频 + 背景图' }
];

const HINTS = {
  cinematic: '动作模仿、开放式生成均为 10 点/秒 · 失败自动退点',
  generate: 'AI 视频价格随模型、清晰度与时长变化 · 失败自动退点',
  talking: '数字人口播 30 点/30 秒 · 不足 30 秒按 30 秒计 · 失败自动退点',
  tryon: '换装 / 换背景，耗时约数分钟 · 点数以服务端返回为准，失败任务按服务端规则处理'
};

const POLL_INTERVAL = 4000;
const POLL_TIMEOUT_SEC = 480; // 8 分钟：仅表示前端停止等待，不代表任务失败
const PHASE_LABEL = {
  queued: '排队中', xiaole_running: '生成中', running: '生成中', downloading: '下载中',
  files_saved: '已上传·排队中', motion_parameters_ready: '生成中', burning_subtitle: '合成字幕中', done: '完成',
  sora_submitting: '提交 Sora', sora_queued: 'Sora 排队中', sora_in_progress: 'Sora 生成中',
  sora_retrying: 'Sora 状态重试', sora_completed: 'Sora 已完成', sora_downloading: '下载 Sora 成品',
  sora_recovery_required: '需要人工核对，请勿重复提交'
};

// 语义色（深色主题）
const C_MUTED = '#948da8';
const C_INFO = '#4d8dff';
const C_OK = '#2bd576';
const C_ERR = '#ff5c8a';

Page({
  data: {
    modes: MODES,
    mode: 'cinematic',
    modeReady: true,
    modeName: '电影化身',

    // 通用选择器（按模式切换可选比例，见 _setMode）
    ratios: RATIOS_CINE,
    ratio: '9:16',

    // ===== 电影化身 cinematic =====
    cineModes: CINE_MODES,
    cineMode: 'motion',     // motion | duo | open
    avatars: [],            // 我的形象列表（/api/gen/video/avatars）
    avatarIds: [],          // 选中的形象 id（motion=1、duo=正好2、open=1~3）
    avatarSelMap: {},       // {id: true} WXML 高亮用
    avatarBusy: false,      // 建形象中
    avatarNote: '',
    cineVideo: '',          // 参考动作视频 data URL（motion/duo：正好 1 个）
    cineVideoName: '',
    cineVideoDur: 0,        // 参考视频时长（秒），自适应计价用
    cinePrompt: '',         // open 玩法自写提示词（≤2000 字）
    cineRefVideos: [],      // open 玩法参考视频 [{url,name,dur}]（≤3 个）
    cineRefImgs: [],        // open 玩法参考图 data URL 数组（与形象共用 9 张图额度）
    cineRefPreviews: [],
    cineResList: RES_CINE,
    // 生产后端对动作模仿强制 1080p + 自适应时长；开放式仍可选。
    cineRes: '1080p',
    cineDurs: CINE_DURATIONS,
    cineDur: 'auto',
    cineEst: 30,            // 预估点数（_cineEstimate 同步，实扣以服务端为准）

    // ===== 视频生成模式 =====
    engines: ENGINES,
    engine: 'grok',
    engineRef: true,
    engineRefMax: 7,
    engineRefHint: '（可选 · 最多 7 张）',
    officialDurations: [],
    officialDuration: 5,
    officialResolutions: [],
    officialResolution: '720p',
    soraModels: SORA_VIDEO.models,
    soraModel: 'sora-2',
    soraDurations: SORA_VIDEO.durations,
    soraDuration: 4,
    soraResolutions: SORA_VIDEO.resolutions['sora-2'],
    soraResolution: '720p',
    videoPromptTemplates: promptTemplates.VIDEO_TEMPLATES,
    videoPromptTemplateKey: 'product',
    videoTplSubject: '黄雀 AI 视觉服务',
    videoTplScene: '紫粉霓虹的未来空间',
    videoTplAction: '缓慢旋转展示核心亮点',
    videoTplStyle: '高级、真实、细腻的电影光影',
    promptUndo: '',
    canUndoPrompt: false,
    prompt: '',
    promptCursor: -1,
    promptMentionOpen: false,
    refImgs: [],       // data URL 数组；果肉两种模型最多 7 张
    refPreviews: [],
    // 果肉官方线（xAI）参数：模型 / 分辨率 / 时长，动态计价
    grokModels: GROK_MODELS,
    grokModel: 'grok-imagine-video',
    grokResList: ['480p', '720p'],
    grokRes: '720p',
    grokDurs: GROK_DURATIONS,
    grokDur: 10,
    // 果肉官方视频编辑（xAI）：上传 MP4 参考视频，输出继承原时长和比例
    grokOp: 'generate',      // generate | edit
    editVideo: '',           // data URL（video/mp4）
    editVideoName: '',
    editDuration: 0,
    editCost: 0,

    // ===== 数字化 IP talking =====
    talkMode: 'text',        // text | audio
    talkBatch: false,        // 批量出片：一段文案 × 多个形象（2~5 个）
    batchItems: [],          // [{kind:'avatar'|'image', id, data, preview, label}]
    batchSelMap: {},         // {avatarId: true} WXML 高亮已选形象用
    batchJobs: [],           // 批量任务进度 [{jobId,label,status,phase,url,statusText}]
    talkImg: '',             // data URL 人物图
    talkImgPreview: '',
    talkImgPath: '',
    talkText: '',
    voices: [],
    voiceKey: '',
    voiceName: '',
    talkAudio: '',           // data URL 音频（audio 模式）
    talkAudioName: '',
    talkAudioPath: '',
    talkAudioConsentVisible: false,
    talkAudioConsentChecked: false,
    talkAudioConsent: false,
    talkAudioConsentAt: '',
    resList: RES_FULL,
    talkRes: '1080p',

    // ===== 换装/换背景 tryon =====
    tryonTypes: TRYON_TYPES,
    tryonType: 'video_clothes',
    tryonPersonVideo: '', tryonPersonVideoName: '',
    tryonClothes: '', tryonClothesPreview: '',
    tryonBg: '', tryonBgPreview: '',

    // ===== 共享任务状态 =====
    points: null,
    busy: false,
    note: '',
    noteColor: C_MUTED,
    defaultHint: HINTS.generate,
    cost: 30,
    videoUrl: '',
    draftStatus: '',
    draftRestoring: false,
    cineVideoPath: '',
    editVideoPath: ''
  },

  onLoad(options) {
    let mode = (options && options.mode) || 'cinematic';
    if (VALID_MODES.indexOf(mode) < 0) mode = 'cinematic';
    this._pollToken = 0;
    this._voicesLoaded = false;
    this._avatarsLoaded = false;
    // base64 媒体一律不进 setData（微信单次 setData 上限 1MB，真机会报错）。
    // 存到普通实例属性 this._b64，只有小数据（预览路径/名称/时长/成本）进 setData。
    this._resetB64();
    this._batchBid = 0; // 批量照片 base64 的稳定自增键（this._b64['batch_'+bid]）
    this._subscriptionPending = false;
    this._subscriptionLoadPromise = null;
    this._workCompleteTemplateId = '';
    this._draftDirty = {};
    this._draftRevision = {};
    this._draftRestoreToken = 0;
    this._mediaTokens = {};
    this._lifecycleToken = 0;
    this._avatarFetchToken = 0;
    this._modeInitialized = false;
    this._setMode(mode);
  },

  // base64 媒体的实例存储（不响应式）。数组与 data 里的预览数组下标一一对应。
  _resetB64() { this._b64 = { talkImg: '', talkAudio: '', editVideo: '', cineVideo: '', refImgs: [], cineRefVideos: [], cineRefImgs: [] }; },

  _draftKey(mode) { return drafts.scopedKey('hq_draft_video_' + mode + '_v1', api.getToken()); },
  _draftFiles(mode, payload) {
    if (mode === 'cinematic') {
      return [payload.cineVideoPath]
        .concat((payload.cineRefVideos || []).map((item) => item && item.path), payload.cineRefImages || [])
        .filter(Boolean);
    }
    if (mode === 'talking') {
      return [payload.talkImgPath, payload.talkAudioPath]
        .concat((payload.batchItems || []).filter((item) => item && item.kind === 'image').map((item) => item.path))
        .filter(Boolean);
    }
    return [];
  },
  _filterDraftAvatars(mode, payload, keep) {
    if (mode === 'cinematic') {
      const before = (payload.avatarIds || []).map(Number).filter((id) => id > 0);
      const after = before.filter(keep);
      if (after.length === before.length) return false;
      payload.avatarIds = after;
      return true;
    }
    if (mode === 'talking') {
      const before = payload.batchItems || [];
      const after = before.filter((item) => !item || item.kind !== 'avatar' || keep(Number(item.id)));
      if (after.length === before.length) return false;
      payload.batchItems = after;
      return true;
    }
    return false;
  },
  _reconcileAvatarReferences(items, removedId) {
    const valid = new Set((items || []).map((item) => Number(item.id)).filter((id) => id > 0));
    const removed = Number(removedId) || 0;
    const keep = (id) => Number(id) !== removed && valid.has(Number(id));
    const avatarIds = (this.data.avatarIds || []).filter(keep);
    const batchItems = (this.data.batchItems || []).filter((item) => item.kind !== 'avatar' || keep(item.id));
    const idsChanged = avatarIds.length !== (this.data.avatarIds || []).length;
    const batchChanged = batchItems.length !== (this.data.batchItems || []).length;
    if (idsChanged) this._setAvatarIds(avatarIds);
    if (batchChanged) this._setBatchItems(batchItems);

    ['cinematic', 'talking'].forEach((mode) => {
      const stored = drafts.load(this._draftKey(mode));
      if (!stored || stored.mode !== mode) return;
      const payload = Object.assign({}, stored);
      if (this._filterDraftAvatars(mode, payload, keep)) drafts.save(this._draftKey(mode), payload, this._draftFiles(mode, payload));
    });

    const currentChanged = (this.data.mode === 'cinematic' && idsChanged)
      || (this.data.mode === 'talking' && batchChanged);
    if (!currentChanged) return;
    this._bumpDraftRevision(this.data.mode);
    this._draftDirty[this.data.mode] = true;
    if (!this.data.draftRestoring) this._saveCurrentDraft();
  },
  _readDataURLPromise(filePath, fallbackMime) {
    return new Promise((resolve, reject) => {
      const mime = this._ext2mime(filePath) || fallbackMime;
      wx.getFileSystemManager().readFile({
        filePath, encoding: 'base64',
        success: (res) => {
          if (!res || !res.data) { reject(new Error('empty persisted media')); return; }
          resolve('data:' + mime + ';base64,' + res.data);
        },
        fail: reject
      });
    });
  },
  _persistAndRead(filePath, fallbackMime) {
    let savedPath = '';
    return drafts.persistFile(filePath)
      .then((path) => {
        savedPath = path;
        return this._readDataURLPromise(path, fallbackMime);
      })
      .then((data) => ({ data, path: savedPath }))
      .catch((error) => {
        if (savedPath) drafts.discardFiles([savedPath]);
        throw error;
      });
  },
  _nextMediaToken(key) {
    if (!this._mediaTokens) this._mediaTokens = {};
    const token = (this._mediaTokens[key] || 0) + 1;
    this._mediaTokens[key] = token;
    return token;
  },
  _mediaIsCurrent(key, token, mode) {
    return this._mediaTokens[key] === token && this.data.mode === mode;
  },
  _discardPersisted(items) {
    drafts.discardFiles((items || []).map((item) => item && item.path).filter(Boolean));
  },
  _mediaDraftFailed(mode, key, token) {
    if (this.data.mode !== mode || (key && !this._mediaIsCurrent(key, token, mode))) return;
    this.setData({ draftStatus: '媒体自动保存失败，请重新选择' });
    this.setNote('媒体自动保存失败，请重新选择', C_ERR);
  },
  _cancelModeMedia(mode) {
    const keys = mode === 'generate' ? ['generate_refs', 'generate_edit']
      : (mode === 'cinematic' ? ['cine_ref_videos', 'cine_ref_images', 'cine_video']
        : (mode === 'talking' ? ['talk_image', 'talk_audio', 'talk_batch_images'] : []));
    keys.forEach((key) => this._nextMediaToken(key));
  },
  _draftRevisionValue(mode) {
    if (!this._draftRevision) this._draftRevision = {};
    return this._draftRevision[mode] || 0;
  },
  _bumpDraftRevision(mode) {
    if (!this._draftRevision) this._draftRevision = {};
    this._draftRevision[mode] = this._draftRevisionValue(mode) + 1;
    return this._draftRevision[mode];
  },
  _submissionDraftState(mode) {
    if (this._draftDirty && this._draftDirty[mode] && this.data.mode === mode) this._saveCurrentDraft();
    return {
      localRevision: this._draftRevisionValue(mode),
      storageRevision: drafts.getRevision(this._draftKey(mode))
    };
  },
  _draftSnapshot(mode) {
    const d = this.data;
    if (mode === 'cinematic') {
      const videos = (d.cineRefVideos || []).filter((item) => item && item.path).map((item) => ({
        path: item.path, name: item.name || '', dur: Number(item.dur) || 0
      }));
      const images = (d.cineRefPreviews || []).filter(Boolean);
      const files = [d.cineVideoPath].concat(videos.map((item) => item.path), images).filter(Boolean);
      return {
        payload: {
          mode, ratio: d.ratio, cineMode: d.cineMode,
          avatarIds: (d.avatarIds || []).slice(0, CINE_MAX_AVATARS),
          cineVideoPath: d.cineVideoPath || '', cineVideoName: d.cineVideoName || '', cineVideoDur: d.cineVideoDur || 0,
          cinePrompt: d.cinePrompt || '', cineRefVideos: videos, cineRefImages: images,
          cineRes: d.cineRes, cineDur: d.cineDur
        },
        files
      };
    }
    if (mode === 'generate') {
      const refs = (d.refPreviews || []).filter(Boolean);
      return {
        payload: {
          mode, engine: d.engine, ratio: d.ratio, prompt: d.prompt || '',
          refFiles: refs,
          grokModel: d.grokModel, grokRes: d.grokRes, grokDur: d.grokDur, grokOp: d.grokOp,
          editVideoPath: d.editVideoPath || '', editVideoName: d.editVideoName || '',
          editDuration: d.editDuration || 0, editCost: d.editCost || 0,
          officialDuration: d.officialDuration, officialResolution: d.officialResolution,
          soraModel: d.soraModel, soraDuration: d.soraDuration, soraResolution: d.soraResolution,
          videoPromptTemplateKey: d.videoPromptTemplateKey,
          videoTplSubject: d.videoTplSubject, videoTplScene: d.videoTplScene,
          videoTplAction: d.videoTplAction, videoTplStyle: d.videoTplStyle
        },
        files: refs.concat([d.editVideoPath]).filter(Boolean)
      };
    }
    if (mode === 'talking') {
      const items = (d.batchItems || []).slice(0, VIDEO_BATCH_MAX).map((item) => item.kind === 'avatar'
        ? { kind: 'avatar', id: Number(item.id), label: item.label || '' }
        : { kind: 'image', path: item.path || '', label: item.label || '' }).filter((item) => item.kind === 'avatar' || item.path);
      const files = [d.talkImgPath, d.talkAudioPath]
        .concat(items.filter((item) => item.kind === 'image').map((item) => item.path)).filter(Boolean);
      return {
        payload: {
          mode, ratio: d.ratio, talkMode: d.talkMode, talkBatch: !!d.talkBatch,
          talkImgPath: d.talkImgPath || '', talkText: d.talkText || '',
          voiceKey: d.voiceKey || '', voiceName: d.voiceName || '',
          talkAudioPath: d.talkAudioPath || '', talkAudioName: d.talkAudioName || '',
          talkRes: d.talkRes, batchItems: items
        },
        files
      };
    }
    return null;
  },
  _saveCurrentDraft() {
    const mode = this.data.mode;
    if (!this._modeInitialized || !this._draftDirty[mode]) return false;
    if (this._draftSaveTimer) { clearTimeout(this._draftSaveTimer); this._draftSaveTimer = null; }
    const snapshot = this._draftSnapshot(mode);
    if (!snapshot) return false;
    const ok = drafts.save(this._draftKey(mode), snapshot.payload, snapshot.files);
    if (ok) this._draftDirty[mode] = false;
    if (!ok) this._dropDraftMedia(mode);
    this.setData({ draftStatus: ok ? '已自动保存' : '媒体自动保存失败，请重新选择' });
    return ok;
  },
  _dropDraftMedia(mode) {
    if (mode === 'cinematic') {
      this._b64.cineVideo = ''; this._b64.cineRefVideos = []; this._b64.cineRefImgs = [];
      this.setData({ cineVideoPath: '', cineVideoName: '', cineVideoDur: 0, cineRefVideos: [], cineRefPreviews: [] });
    } else if (mode === 'generate') {
      this._b64.refImgs = []; this._b64.editVideo = '';
      this.setData({ refPreviews: [], editVideoPath: '', editVideoName: '', editDuration: 0, editCost: 0 });
    } else if (mode === 'talking') {
      this._b64.talkImg = ''; this._b64.talkAudio = '';
      const items = (this.data.batchItems || []).filter((item) => item.kind === 'avatar');
      Object.keys(this._b64).filter((key) => key.indexOf('batch_') === 0).forEach((key) => { delete this._b64[key]; });
      this.setData({ talkImgPath: '', talkImgPreview: '', talkAudioPath: '', talkAudioName: '' });
      this._setBatchItems(items);
    }
  },
  _draftChanged(immediate) {
    const mode = this.data.mode;
    if (!this._modeInitialized) return;
    this._bumpDraftRevision(mode);
    this._draftDirty[mode] = true;
    if (this._draftSaveTimer) clearTimeout(this._draftSaveTimer);
    if (immediate) { this._saveCurrentDraft(); return; }
    if (this.data.draftRestoring) return;
    this._draftSaveTimer = setTimeout(() => this._saveCurrentDraft(), DRAFT_SAVE_DELAY);
  },
  _restoreDraft(mode) {
    let payload = drafts.load(this._draftKey(mode));
    const token = ++this._draftRestoreToken;
    this._draftDirty[mode] = false;
    if (!payload || payload.mode !== mode) {
      this.setData({ draftStatus: '', draftRestoring: false });
      return;
    }
    if (this._avatarsLoaded && (mode === 'cinematic' || mode === 'talking')) {
      const valid = new Set((this.data.avatars || []).map((item) => Number(item.id)).filter((id) => id > 0));
      const cleaned = Object.assign({}, payload);
      if (this._filterDraftAvatars(mode, cleaned, (id) => valid.has(Number(id)))) {
        drafts.save(this._draftKey(mode), cleaned, this._draftFiles(mode, cleaned));
        payload = cleaned;
      }
    }
    const tasks = [];
    const read = (path, mime, apply) => {
      if (!path) return;
      tasks.push(this._readDataURLPromise(path, mime).then((data) => {
        if (token === this._draftRestoreToken && this.data.mode === mode) apply(data);
        return true;
      }).catch(() => false));
    };

    if (mode === 'cinematic') {
      const cineMode = ['motion', 'open'].indexOf(payload.cineMode) >= 0 ? payload.cineMode : 'motion';
      const videos = (payload.cineRefVideos || []).slice(0, CINE_MAX_REF_VIDEOS)
        .filter((item) => item && item.path).map((item) => ({ path: item.path, name: item.name || '参考视频', dur: Number(item.dur) || 0 }));
      const images = (payload.cineRefImages || []).slice(0, CINE_MAX_MEDIA_IMAGES).filter(Boolean);
      const avatarIds = (payload.avatarIds || []).map(Number).filter((id) => id > 0).slice(0, CINE_MAX_AVATARS);
      this._b64.cineRefVideos = new Array(videos.length);
      this._b64.cineRefImgs = new Array(images.length);
      this.setData({
        ratio: RATIOS_CINE.indexOf(payload.ratio) >= 0 ? payload.ratio : '9:16',
        cineMode, cineDurs: cineMode === 'open' ? CINE_DURATIONS_OPEN : CINE_DURATIONS,
        cineVideoPath: payload.cineVideoPath || '', cineVideoName: payload.cineVideoName || '', cineVideoDur: Number(payload.cineVideoDur) || 0,
        cinePrompt: String(payload.cinePrompt || '').slice(0, CINE_PROMPT_MAX),
        cineRefVideos: videos, cineRefPreviews: images,
        cineRes: RES_CINE.indexOf(payload.cineRes) >= 0 ? payload.cineRes : (cineMode === 'motion' ? '1080p' : '720p'),
        cineDur: payload.cineDur === 'auto' ? 'auto' : Number(payload.cineDur) || 'auto'
      });
      this._setAvatarIds(avatarIds);
      read(payload.cineVideoPath, 'video/mp4', (data) => { this._b64.cineVideo = data; });
      videos.forEach((item, index) => read(item.path, 'video/mp4', (data) => { this._b64.cineRefVideos[index] = data; }));
      images.forEach((path, index) => read(path, 'image/jpeg', (data) => { this._b64.cineRefImgs[index] = data; }));
      this.setData({ cineEst: this._cineEstimate() });
    } else if (mode === 'generate') {
      const engine = ENGINES_ALL.some((item) => item.key === payload.engine) ? payload.engine : 'grok';
      const grokModel = payload.grokModel === 'grok-imagine-video-1.5' ? payload.grokModel : 'grok-imagine-video';
      const engineDefaults = this._engineState(engine);
      const refMax = engine === 'grok' ? GEN_MAX_REF : engineDefaults.engineRefMax;
      const refs = (payload.refFiles || []).slice(0, refMax).filter(Boolean);
      const patch = Object.assign(this._engineState(engine), {
        prompt: String(payload.prompt || '').slice(0, 2000), refPreviews: refs,
        grokModel,
        grokRes: payload.grokRes || '720p', grokDur: GROK_DURATIONS.indexOf(Number(payload.grokDur)) >= 0 ? Number(payload.grokDur) : 10,
        grokOp: payload.grokOp === 'edit' ? 'edit' : 'generate',
        editVideoPath: payload.editVideoPath || '', editVideoName: payload.editVideoName || '',
        editDuration: Number(payload.editDuration) || 0, editCost: Number(payload.editCost) || 0,
        officialDuration: Number(payload.officialDuration) || engineDefaults.officialDuration || 5,
        officialResolution: payload.officialResolution || engineDefaults.officialResolution || '720p',
        soraModel: payload.soraModel === 'sora-2-pro' ? 'sora-2-pro' : 'sora-2',
        soraDuration: Number(payload.soraDuration) || 4, soraResolution: payload.soraResolution || '720p',
        videoPromptTemplateKey: payload.videoPromptTemplateKey || 'product',
        videoTplSubject: String(payload.videoTplSubject || ''), videoTplScene: String(payload.videoTplScene || ''),
        videoTplAction: String(payload.videoTplAction || ''), videoTplStyle: String(payload.videoTplStyle || '')
      });
      if (patch.grokModel === 'grok-imagine-video-1.5') {
        patch.grokResList = ['720p']; patch.engineRefMax = GEN_MAX_REF; patch.engineRefHint = '（必选 · 最多 ' + GEN_MAX_REF + ' 张）';
      } else {
        patch.grokResList = ['480p', '720p']; patch.engineRefMax = engine === 'grok' ? GEN_MAX_REF : patch.engineRefMax;
        if (engine === 'grok') patch.engineRefHint = '（可选 · 最多 ' + GEN_MAX_REF + ' 张）';
      }
      if (engine === 'grok' && refs.length) patch.grokRes = '720p';
      if (patch.grokResList.indexOf(patch.grokRes) < 0) patch.grokRes = '720p';
      if (engineDefaults.officialDurations && engineDefaults.officialDurations.length
        && engineDefaults.officialDurations.indexOf(patch.officialDuration) < 0) patch.officialDuration = engineDefaults.officialDuration;
      if (engineDefaults.officialResolutions && engineDefaults.officialResolutions.length
        && engineDefaults.officialResolutions.indexOf(patch.officialResolution) < 0) patch.officialResolution = engineDefaults.officialResolution;
      patch.soraResolutions = soraResolutions(patch.soraModel);
      if (patch.soraResolutions.indexOf(patch.soraResolution) < 0) patch.soraResolution = patch.soraResolutions[0];
      if (SORA_VIDEO.durations.indexOf(patch.soraDuration) < 0) patch.soraDuration = SORA_VIDEO.durations[0];
      patch.ratio = (patch.ratios || RATIOS_GEN).indexOf(payload.ratio) >= 0 ? payload.ratio : patch.ratio;
      this._b64.refImgs = new Array(refs.length);
      this.setData(patch);
      refs.forEach((path, index) => read(path, 'image/jpeg', (data) => { this._b64.refImgs[index] = data; }));
      read(payload.editVideoPath, 'video/mp4', (data) => { this._b64.editVideo = data; });
      this._syncGenPricing();
    } else if (mode === 'talking') {
      const items = [];
      (payload.batchItems || []).slice(0, VIDEO_BATCH_MAX).forEach((item) => {
        if (item && item.kind === 'avatar' && Number(item.id) > 0) {
          items.push({ kind: 'avatar', id: Number(item.id), data: '', preview: '', label: item.label || ('形象 ' + item.id) });
        } else if (item && item.kind === 'image' && item.path) {
          const bid = ++this._batchBid;
          items.push({ kind: 'image', id: 0, bid, path: item.path, preview: item.path, label: item.label || '照片形象' });
          read(item.path, 'image/jpeg', (data) => { this._b64['batch_' + bid] = data; });
        }
      });
      this.setData({
        ratio: RATIOS_VIDEO.indexOf(payload.ratio) >= 0 ? payload.ratio : '9:16',
        talkMode: payload.talkMode === 'audio' ? 'audio' : 'text', talkBatch: !!payload.talkBatch,
        talkImgPath: payload.talkImgPath || '', talkImgPreview: payload.talkImgPath || '',
        talkText: String(payload.talkText || '').slice(0, 1000),
        voiceKey: payload.voiceKey || '', voiceName: payload.voiceName || '',
        talkAudioPath: payload.talkAudioPath || '', talkAudioName: payload.talkAudioName || '',
        talkRes: RES_FULL.indexOf(payload.talkRes) >= 0 ? payload.talkRes : '1080p',
        cost: this._talkEstimate(payload.talkText || '')
      });
      this._setBatchItems(items);
      read(payload.talkImgPath, 'image/jpeg', (data) => { this._b64.talkImg = data; });
      read(payload.talkAudioPath, 'audio/mpeg', (data) => { this._b64.talkAudio = data; });
    }

    this.setData({ draftStatus: tasks.length ? '正在恢复草稿…' : '已恢复草稿', draftRestoring: tasks.length > 0 });
    if (!tasks.length) return;
    Promise.all(tasks).then((results) => {
      if (token !== this._draftRestoreToken || this.data.mode !== mode) return;
      const complete = results.every(Boolean);
      this.setData({ draftRestoring: false });
      const pruned = complete ? false : this._pruneFailedRestoredMedia(mode);
      if (pruned) {
        this._bumpDraftRevision(mode);
        this._draftDirty[mode] = true;
      }
      const needsSave = !!(this._draftDirty && this._draftDirty[mode]);
      const saved = !needsSave || this._saveCurrentDraft();
      this.setData({
        draftStatus: !saved ? '媒体自动保存失败，请重新选择'
          : (pruned ? '草稿已恢复，失效媒体已移除，请重新选择'
            : (needsSave ? '已自动保存' : (complete ? '已恢复草稿' : '草稿已恢复，部分媒体需重选')))
      });
    });
  },
  _pruneFailedRestoredMedia(mode) {
    let changed = false;
    if (mode === 'generate') {
      const previews = [];
      const refs = [];
      (this.data.refPreviews || []).forEach((preview, index) => {
        if (this._b64.refImgs[index]) { previews.push(preview); refs.push(this._b64.refImgs[index]); }
        else changed = true;
      });
      const patch = {};
      if (previews.length !== (this.data.refPreviews || []).length) {
        this._b64.refImgs = refs;
        patch.refPreviews = previews;
      }
      if (this.data.editVideoPath && !this._b64.editVideo) {
        patch.editVideoPath = ''; patch.editVideoName = ''; patch.editDuration = 0; patch.editCost = 0;
        changed = true;
      }
      if (changed) this.setData(patch);
      return changed;
    }
    if (mode === 'cinematic') {
      const videos = [];
      const videoData = [];
      (this.data.cineRefVideos || []).forEach((item, index) => {
        if (this._b64.cineRefVideos[index]) { videos.push(item); videoData.push(this._b64.cineRefVideos[index]); }
        else changed = true;
      });
      const images = [];
      const imageData = [];
      (this.data.cineRefPreviews || []).forEach((preview, index) => {
        if (this._b64.cineRefImgs[index]) { images.push(preview); imageData.push(this._b64.cineRefImgs[index]); }
        else changed = true;
      });
      const patch = {};
      if (videos.length !== (this.data.cineRefVideos || []).length) {
        this._b64.cineRefVideos = videoData;
        patch.cineRefVideos = videos;
      }
      if (images.length !== (this.data.cineRefPreviews || []).length) {
        this._b64.cineRefImgs = imageData;
        patch.cineRefPreviews = images;
      }
      if (this.data.cineVideoPath && !this._b64.cineVideo) {
        patch.cineVideoPath = ''; patch.cineVideoName = ''; patch.cineVideoDur = 0;
        changed = true;
      }
      if (changed) {
        this.setData(patch);
        this.setData({ cineEst: this._cineEstimate() });
      }
      return changed;
    }
    if (mode === 'talking') {
      const patch = {};
      if (this.data.talkImgPath && !this._b64.talkImg) {
        patch.talkImgPath = ''; patch.talkImgPreview = '';
        changed = true;
      }
      if (this.data.talkAudioPath && !this._b64.talkAudio) {
        patch.talkAudioPath = ''; patch.talkAudioName = '';
        changed = true;
      }
      const items = (this.data.batchItems || []).filter((item) => {
        if (item.kind === 'avatar' || this._b64['batch_' + item.bid]) return true;
        changed = true;
        delete this._b64['batch_' + item.bid];
        return false;
      });
      if (Object.keys(patch).length) this.setData(patch);
      if (items.length !== (this.data.batchItems || []).length) this._setBatchItems(items);
      return changed;
    }
    return false;
  },
  _resetModeForm(mode) {
    if (mode === 'cinematic') {
      this._b64.cineVideo = ''; this._b64.cineRefVideos = []; this._b64.cineRefImgs = [];
      this.setData({
        ratio: '9:16', cineMode: 'motion', cineDurs: CINE_DURATIONS,
        avatarIds: [], avatarSelMap: {}, cineVideoPath: '', cineVideoName: '', cineVideoDur: 0,
        cinePrompt: '', cineRefVideos: [], cineRefPreviews: [], cineRes: '1080p', cineDur: 'auto', cineEst: 30
      });
    } else if (mode === 'generate') {
      this._b64.refImgs = []; this._b64.editVideo = '';
      this.setData(Object.assign(this._engineState('grok'), {
        engineRefMax: GEN_MAX_REF, engineRefHint: '（可选 · 最多 ' + GEN_MAX_REF + ' 张）',
        grokModel: 'grok-imagine-video', grokResList: ['480p', '720p'], grokRes: '720p', grokDur: 10, grokOp: 'generate',
        officialDuration: 5, officialResolution: '720p',
        soraModel: 'sora-2', soraDuration: 4, soraResolutions: soraResolutions('sora-2'), soraResolution: '720p',
        prompt: '', promptUndo: '', canUndoPrompt: false, refPreviews: [], editVideoPath: '', editVideoName: '', editDuration: 0, editCost: 0,
        videoPromptTemplateKey: 'product', videoTplSubject: '黄雀 AI 视觉服务', videoTplScene: '紫粉霓虹的未来空间',
        videoTplAction: '缓慢旋转展示核心亮点', videoTplStyle: '高级、真实、细腻的电影光影'
      }));
      this._syncGenPricing();
    } else if (mode === 'talking') {
      this._b64.talkImg = ''; this._b64.talkAudio = '';
      Object.keys(this._b64).filter((key) => key.indexOf('batch_') === 0).forEach((key) => { delete this._b64[key]; });
      const firstVoice = (this.data.voices || [])[0] || {};
      this.setData({
        ratio: '9:16', talkMode: 'text', talkBatch: false, batchItems: [], batchSelMap: {},
        talkImgPath: '', talkImgPreview: '', talkText: '',
        voiceKey: firstVoice.key || '', voiceName: firstVoice.name || '',
        talkAudioPath: '', talkAudioName: '', talkRes: '1080p', cost: VIDEO_COST
      });
    }
  },
  clearCurrentDraft() {
    if (this.data.busy) { wx.showToast({ title: '任务处理中，暂不能清空', icon: 'none' }); return; }
    wx.showModal({
      title: '清空当前草稿', content: '只清空当前创作模式里尚未提交的内容。',
      success: (res) => {
        if (!res.confirm) return;
        const mode = this.data.mode;
        this._draftRestoreToken += 1;
        this._cancelModeMedia(mode);
        drafts.clear(this._draftKey(mode));
        if (!this._draftDirty) this._draftDirty = {};
        this._draftDirty[mode] = false;
        this._bumpDraftRevision(mode);
        this._resetModeForm(mode);
        this.setData({ draftStatus: '已清空当前草稿', draftRestoring: false });
      }
    });
  },
  _clearAcceptedDraft(mode, expectedStorageRevision, submittedLocalRevision, updateUi) {
    if (this._draftRevisionValue(mode) !== submittedLocalRevision) {
      if (this.data.mode === mode && this._draftDirty && this._draftDirty[mode]) this._saveCurrentDraft();
      return false;
    }
    if (!drafts.clearIfRevision(this._draftKey(mode), expectedStorageRevision)) return false;
    this._cancelModeMedia(mode);
    if (!this._draftDirty) this._draftDirty = {};
    this._draftDirty[mode] = false;
    this._bumpDraftRevision(mode);
    if (updateUi !== false && this.data.mode === mode) {
      this._draftRestoreToken += 1;
      this._resetModeForm(mode);
      this.setData({ draftStatus: '任务已受理，当前草稿已清理', draftRestoring: false });
    }
    return true;
  },

  onShow() {
    if (!api.getToken()) { wx.reLaunch({ url: '/pages/login/login' }); return; }
    const ip12Script = wx.getStorageSync('hq_ip12_prefill_script');
    if (ip12Script && ip12Script.prompt) {
      wx.removeStorageSync('hq_ip12_prefill_script');
      if (this.data.mode !== 'talking') this._setMode('talking');
      this.setData({ talkText: ip12Script.prompt });
      this._draftChanged(true);
      wx.showToast({ title: '已带入 IP12 文案建议', icon: 'none' });
    }
    const ip12Prefill = wx.getStorageSync('hq_ip12_prefill_video');
    if (ip12Prefill && ip12Prefill.prompt) {
      wx.removeStorageSync('hq_ip12_prefill_video');
      if (this.data.mode !== 'generate') this._setMode('generate');
      this.setData({ prompt: ip12Prefill.prompt });
      this._draftChanged(true);
      wx.showToast({ title: '已带入 IP12 视频计划', icon: 'none' });
    }
    this._preloadSubscriptionTemplate();
    this.refreshPoints();
    this.refreshVideoChannels();
    if (this.data.mode === 'talking') this.fetchVoices();
  },

  onHide() {
    this._lifecycleToken += 1;
    this._subscriptionPending = false;
    this._saveCurrentDraft();
  },

  _preloadSubscriptionTemplate() {
    if (this._workCompleteTemplateId || this._subscriptionLoadPromise) return;
    this._subscriptionLoadPromise = api.request('/api/auth/subscription/status', { method: 'GET' })
      .then((res) => {
        const events = res && res.data && Array.isArray(res.data.events) ? res.data.events : [];
        const item = events.find((event) => event && event.event_type === SUBSCRIPTION_EVENT);
        this._workCompleteTemplateId = item && item.template_id ? String(item.template_id) : '';
      })
      .catch(() => {})
      .then(() => { this._subscriptionLoadPromise = null; });
  },

  _recordSubscriptionChoice(choice) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      // 订阅记录不是生成前提；网络卡住时最多等 3.5 秒。
      const timer = setTimeout(finish, 3500);
      try {
        wx.login({
          success: (login) => {
            const code = login && login.code;
            if (!code) { finish(); return; }
            try {
              api.request('/api/auth/subscription/choices', {
                method: 'POST',
                data: { choices: { [SUBSCRIPTION_EVENT]: choice }, wx_code: code }
              }).then(finish).catch(finish);
            } catch (err) {
              finish();
            }
          },
          fail: finish
        });
      } catch (err) {
        finish();
      }
    });
  },

  _requestWorkCompleteSubscription() {
    const templateId = this._workCompleteTemplateId;
    if (!templateId || !wx.requestSubscribeMessage) return Promise.resolve();
    return new Promise((resolve) => {
      const finish = (choice) => {
        if (['accept', 'reject', 'ban', 'filter'].indexOf(choice) < 0) { resolve(); return; }
        this._recordSubscriptionChoice(choice).then(resolve).catch(resolve);
      };
      try {
        wx.requestSubscribeMessage({
          tmplIds: [templateId],
          success: (result) => finish(result && result[templateId]),
          fail: resolve
        });
      } catch (err) {
        resolve();
      }
    });
  },

  onUnload() {
    this._lifecycleToken += 1;
    this._avatarFetchToken += 1;
    this._saveCurrentDraft();
    this._draftRestoreToken += 1;
    this._cancelModeMedia(this.data.mode);
    if (this._draftSaveTimer) { clearTimeout(this._draftSaveTimer); this._draftSaveTimer = null; }
    this.stopPolling();
    if (this._vp) { this._vp.destroy(); this._vp = null; }
  },

  // ===== 模式切换：保存旧模式，再重置并恢复目标模式草稿 =====
  _setMode(mode) {
    const previousMode = this.data.mode;
    if (this._modeInitialized) {
      this._saveCurrentDraft();
      this._cancelModeMedia(previousMode);
    }
    this.stopPolling();
    const m = MODES.find((x) => x.key === mode) || MODES[0];
    const cost = m.key === 'cinematic' ? 0 : (m.key === 'tryon' ? TRYON_COST_SINGLE : VIDEO_COST);
    const defaultHint = HINTS[m.key] || '';
    const ratios = m.key === 'cinematic' ? RATIOS_CINE : (m.key === 'generate' ? RATIOS_GEN : RATIOS_VIDEO);
    this._draftRestoreToken += 1;
    this._resetB64();
    this.setData({
      mode: m.key, modeReady: m.ready, modeName: m.name,
      ratios, ratio: '9:16',
      busy: false, note: '', noteColor: C_MUTED, defaultHint, videoUrl: '', cost,
      draftStatus: '', draftRestoring: false, batchJobs: []
    });
    this._resetModeForm(m.key);
    this._modeInitialized = true;
    this._restoreDraft(m.key);
    if (m.key === 'talking' && !this._voicesLoaded) this.fetchVoices();
    // 口播批量也要选形象，进口播模式同样拉形象列表
    if ((m.key === 'cinematic' || m.key === 'talking') && !this._avatarsLoaded) this.fetchAvatars();
  },
  selectMode(e) {
    const k = e.currentTarget.dataset.k;
    if (k !== this.data.mode) this._setMode(k);
  },

  // ===== 上传辅助：文件 → data URL =====
  _ext2mime(path) {
    const p = (path || '').toLowerCase();
    if (p.endsWith('.png')) return 'image/png';
    if (p.endsWith('.webp')) return 'image/webp';
    if (p.endsWith('.jpg') || p.endsWith('.jpeg')) return 'image/jpeg';
    if (p.endsWith('.mp4')) return 'video/mp4';
    if (p.endsWith('.mov')) return 'video/quicktime';
    if (p.endsWith('.webm')) return 'video/webm';
    if (p.endsWith('.mp3')) return 'audio/mpeg';
    if (p.endsWith('.wav')) return 'audio/wav';
    if (p.endsWith('.m4a')) return 'audio/mp4';
    return '';
  },
  _readDataURL(filePath, fallbackMime, cb) {
    const mime = this._ext2mime(filePath) || fallbackMime;
    wx.getFileSystemManager().readFile({
      filePath, encoding: 'base64',
      success: (r) => cb('data:' + mime + ';base64,' + r.data),
      fail: () => this.setNote('文件读取失败，请重试', C_ERR)
    });
  },
  _chooseImage(fallbackMime, cb) {
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sizeType: ['compressed'], sourceType: ['album', 'camera'],
      success: (res) => {
        const f = res.tempFiles[0];
        this._readDataURL(f.tempFilePath, fallbackMime || 'image/jpeg', (url) => cb(url, f.tempFilePath));
      }
    });
  },
  _chooseVideo(cb) {
    wx.chooseMedia({
      count: 1, mediaType: ['video'], sourceType: ['album', 'camera'], maxDuration: 15, camera: 'back',
      success: (res) => {
        const f = res.tempFiles[0];
        if (f.size && f.size > 30 * 1024 * 1024) { this.setNote('视频过大（>30MB），请选更短的片段', C_ERR); return; }
        this._readDataURL(f.tempFilePath, 'video/mp4', (url) => cb(url, f.tempFilePath));
      }
    });
  },

  // ===== 视频生成模式：交互 =====
  // 果肉预估价：与后端 points.py 公式逐字一致（仅展示，实扣以返回 cost 为准）
  _grokEstimate(model, res, dur, hasRefs) {
    const perSec = (GROK_PRICE[model] || {})[res];
    if (!perSec) return 0;
    return Math.max(1, dur * perSec);
  },
  _genPricingHint() {
    const d = this.data;
    if (d.engine === 'sora') {
      const rate = this._soraRate();
      return 'Sora 2 · ' + d.soraModel + ' · ' + d.soraResolution + ' · '
        + rate + ' 点/秒 × ' + d.soraDuration + ' 秒 = ' + (rate * d.soraDuration) + ' 点 · 失败自动退点';
    }
    if (d.engine !== 'grok') {
      const cfg = OFFICIAL_VIDEO[d.engine];
      const seconds = Number(d.officialDuration) || 5;
      return 'AI 视频 ' + cfg.name + ' · 30 点/秒 × ' + seconds + ' 秒 = '
        + (seconds * 30) + ' 点 · 失败自动退点';
    }
    const perSec = (GROK_PRICE[d.grokModel] || {})[d.grokRes] || 0;
    const modelName = d.grokModel === 'grok-imagine-video-1.5' ? '高清 1.5' : '标准 1.0';
    const total = this._grokEstimate(d.grokModel, d.grokRes, d.grokDur, d.refPreviews.length > 0);
    return 'AI 视频 ' + modelName + ' · ' + d.grokRes + ' · '
      + perSec + ' 点/秒 × ' + d.grokDur + ' 秒 = ' + total + ' 点 · 失败自动退点';
  },
  _syncGenPricing() {
    this.setData({
      cost: this._genCost(),
      defaultHint: this._genPricingHint(),
      note: '',
      noteColor: C_MUTED
    });
  },
  _genCost() {
    const d = this.data;
    if (d.engine === 'sora') return this._soraRate() * d.soraDuration;
    if (d.engine !== 'grok') return (Number(d.officialDuration) || 5) * 30;
    return this._grokEstimate(d.grokModel, d.grokRes, d.grokDur, d.refPreviews.length > 0);
  },
  _soraRate() { return SORA_VIDEO.rates[this.data.soraModel + ':' + this.data.soraResolution] || 0; },
  _engineState(engine) {
    const eng = ENGINES_ALL.find((x) => x.key === engine) || ENGINES_ALL[0];
    if (eng.key === 'sora') {
      const model = this.data.soraModel === 'sora-2-pro' ? 'sora-2-pro' : 'sora-2';
      const resolutions = soraResolutions(model);
      return {
        engine: 'sora', engineRef: true, engineRefMax: 1, engineRefHint: '（可选 · 1 张 · 不得含真人脸）',
        ratios: SORA_VIDEO.ratios, ratio: '9:16',
        soraModels: SORA_VIDEO.models, soraModel: model,
        soraDurations: SORA_VIDEO.durations, soraDuration: 4,
        soraResolutions: resolutions, soraResolution: resolutions[0]
      };
    }
    const cfg = OFFICIAL_VIDEO[eng.key];
    const maxRef = cfg ? cfg.maxRef : GEN_MAX_REF;
    return {
      engine: eng.key,
      engineRef: eng.ref,
      engineRefMax: maxRef,
      engineRefHint: eng.key === 'grok' && this.data.grokModel === 'grok-imagine-video-1.5'
        ? '（必选 · 最多 ' + maxRef + ' 张）' : '（可选 · 最多 ' + maxRef + ' 张）',
      ratios: cfg ? cfg.ratios : RATIOS_GEN,
      ratio: cfg ? cfg.defaultRatio : '9:16',
      officialDurations: cfg ? cfg.durations : [],
      officialDuration: cfg ? cfg.durations[0] : 5,
      officialResolutions: cfg ? cfg.resolutions : [],
      officialResolution: cfg ? cfg.resolutions[0] : '720p'
    };
  },
  refreshVideoChannels() {
    api.request('/api/gen/health', { method: 'GET' }).then((res) => {
      if (res.statusCode !== 200) return;
      const health = res.data || {};
      const engines = ENGINES_ALL.filter((item) => item.key === 'grok'
        || (item.key === 'micro' && health.seedance_video_enabled === true)
        || (item.key === 'omni' && health.omni_video_enabled === true)
        || (item.key === 'sora' && health.sora_video_enabled === true));
      this.setData({ engines });
      if (!engines.some((item) => item.key === this.data.engine)) {
        this._b64.refImgs = [];
        this.setData(Object.assign(this._engineState('grok'), { refPreviews: [] }));
        this._syncGenPricing();
      }
    }).catch(() => {});
  },
  selectEngine(e) {
    const engine = e.currentTarget.dataset.k;
    const next = this._engineState(engine);
    if (this.data.refPreviews.length > next.engineRefMax) {
      const mentionError = imageMentions.validate(this.data.prompt, next.engineRefMax);
      if (mentionError) { this.setNote(mentionError + '，请先修改提示词', C_ERR); return; }
      const removeCount = this.data.refPreviews.length - next.engineRefMax;
      wx.showModal({
        title: '切换会移除参考图',
        content: '该渠道最多支持 ' + next.engineRefMax + ' 张，将从当前草稿移除 ' + removeCount + ' 张参考图。是否继续？',
        confirmText: '继续切换',
        success: (res) => { if (res.confirm) this._applyEngineSelection(engine); }
      });
      return;
    }
    this._applyEngineSelection(engine);
  },
  _applyEngineSelection(engine) {
    this._nextMediaToken('generate_refs');
    this._nextMediaToken('generate_edit');
    const patch = this._engineState(engine);
    if (this.data.refPreviews.length > patch.engineRefMax) {
      this._b64.refImgs = this._b64.refImgs.slice(0, patch.engineRefMax);
      patch.refPreviews = this.data.refPreviews.slice(0, patch.engineRefMax);
      wx.showToast({ title: '该渠道最多保留 ' + patch.engineRefMax + ' 张参考图', icon: 'none' });
    }
    this.setData(patch);
    this._syncGenPricing();
    this._draftChanged(true);
  },
  selectGrokModel(e) {
    this._applyGrokModel(e.currentTarget.dataset.k);
  },
  _applyGrokModel(model) {
    this._nextMediaToken('generate_refs');
    const is15 = model === 'grok-imagine-video-1.5';
    const resList = is15 ? ['720p'] : ['480p', '720p'];
    const patch = {
      grokModel: model, grokResList: resList,
      engineRefMax: GEN_MAX_REF,
      engineRefHint: is15 ? '（必选 · 最多 7 张）' : '（可选 · 最多 7 张）'
    };
    if (is15 || this.data.refPreviews.length || resList.indexOf(this.data.grokRes) < 0) patch.grokRes = '720p';
    this.setData(patch);
    this._syncGenPricing();
    this._draftChanged(true);
  },
  selectGrokRes(e) {
    const resolution = e.currentTarget.dataset.v;
    if (this.data.refPreviews.length && resolution !== '720p') {
      this.setNote('使用参考图时仅支持 720p', C_ERR); return;
    }
    this.setData({ grokRes: resolution });
    this._syncGenPricing();
    this._draftChanged(true);
  },
  selectGrokDur(e) {
    this.setData({ grokDur: +e.currentTarget.dataset.v });
    this._syncGenPricing();
    this._draftChanged(true);
  },
  selectOfficialDuration(e) {
    this.setData({ officialDuration: +e.currentTarget.dataset.v });
    this._syncGenPricing();
    this._draftChanged(true);
  },
  selectOfficialResolution(e) {
    this.setData({ officialResolution: e.currentTarget.dataset.v });
    this._draftChanged(true);
  },
  selectSoraModel(e) {
    const model = e.currentTarget.dataset.k === 'sora-2-pro' ? 'sora-2-pro' : 'sora-2';
    const resolutions = soraResolutions(model);
    this.setData({ soraModel: model, soraResolutions: resolutions, soraResolution: resolutions[0] });
    this._syncGenPricing();
    this._draftChanged(true);
  },
  selectSoraDuration(e) {
    const seconds = +e.currentTarget.dataset.v;
    if (SORA_VIDEO.durations.indexOf(seconds) < 0) return;
    this.setData({ soraDuration: seconds });
    this._syncGenPricing();
    this._draftChanged(true);
  },
  selectSoraResolution(e) {
    const resolution = e.currentTarget.dataset.v;
    if (soraResolutions(this.data.soraModel).indexOf(resolution) < 0) return;
    this.setData({ soraResolution: resolution });
    this._syncGenPricing();
    this._draftChanged(true);
  },
  onPrompt(e) {
    const cursor = Number.isInteger(e.detail.cursor) ? e.detail.cursor : e.detail.value.length;
    this._promptMentionRange = imageMentions.trigger(e.detail.value, cursor);
    this.setData({ prompt: e.detail.value, promptCursor: cursor, promptMentionOpen: !!(this._promptMentionRange && this.data.refPreviews.length) });
    this._draftChanged(false);
  },
  selectPromptMention(e) {
    const index = +e.currentTarget.dataset.i + 1;
    const range = this._promptMentionRange;
    if (!range || index > this.data.refPreviews.length) return;
    const result = imageMentions.insert(this.data.prompt, index, range.start, range.end);
    this._promptMentionRange = null;
    this.setData({ prompt: result.value, promptCursor: result.cursor, promptMentionOpen: false });
    this._draftChanged(true);
  },
  selectVideoPromptTemplate(e) { this.setData({ videoPromptTemplateKey: e.currentTarget.dataset.k }); this._draftChanged(true); },
  onVideoTemplateField(e) {
    const key = e.currentTarget.dataset.key;
    if (['videoTplSubject', 'videoTplScene', 'videoTplAction', 'videoTplStyle'].indexOf(key) < 0) return;
    const patch = {}; patch[key] = e.detail.value;
    this.setData(patch);
    this._draftChanged(false);
  },
  applyVideoPromptTemplate() {
    const result = promptTemplates.buildVideoPrompt(this.data.videoPromptTemplateKey, {
      subject: this.data.videoTplSubject,
      scene: this.data.videoTplScene,
      action: this.data.videoTplAction,
      style: this.data.videoTplStyle
    });
    this.setData({
      promptUndo: this.data.prompt,
      canUndoPrompt: true,
      prompt: result.prompt,
      ratio: result.ratio
    });
    this.setNote('镜头模板已润色，可继续修改画面描述', C_INFO);
    wx.showToast({ title: '已套用镜头模板', icon: 'none' });
    this._draftChanged(true);
  },
  undoVideoPromptTemplate() {
    if (!this.data.canUndoPrompt) return;
    this.setData({ prompt: this.data.promptUndo, promptUndo: '', canUndoPrompt: false });
    this.setNote('已恢复套用前的画面描述', C_MUTED);
    this._draftChanged(true);
  },
  selectRatio(e) { this.setData({ ratio: e.currentTarget.dataset.v }); this._draftChanged(true); },
  chooseRef() {
    // reference_images 要「字符串数组」（dataURL/URL），服务端转存 COS 后喂上游
    const maxRef = this.data.engineRefMax;
    const left = maxRef - this.data.refPreviews.length;
    if (left <= 0) {
      this.setNote('参考图最多 ' + maxRef + ' 张', C_ERR);
      return;
    }
    wx.chooseMedia({
      count: Math.min(left, 9), mediaType: ['image'], sizeType: ['compressed'], sourceType: ['album', 'camera'],
      success: (res) => {
        const mode = this.data.mode;
        const token = this._nextMediaToken('generate_refs');
        const files = res.tempFiles || [];
        Promise.all(files.map((f) => this._persistAndRead(f.tempFilePath, 'image/jpeg').catch(() => null)))
          .then((results) => {
            const items = results.filter(Boolean);
            if (items.length !== files.length) { this._discardPersisted(items); this._mediaDraftFailed(mode, 'generate_refs', token); return; }
            if (!this._mediaIsCurrent('generate_refs', token, mode)) { this._discardPersisted(items); return; }
            const accepted = items.slice(0, Math.max(0, maxRef - this.data.refPreviews.length));
            this._discardPersisted(items.slice(accepted.length));
            this._b64.refImgs = this._b64.refImgs.concat(accepted.map((item) => item.data));
            const patch = { refPreviews: this.data.refPreviews.concat(accepted.map((item) => item.path)) };
            if (this.data.engine === 'grok') patch.grokRes = '720p';
            this.setData(patch);
            this._syncGenPricing();
            this._draftChanged(true);
          });
      }
    });
  },
  removeRef(e) {
    const i = +e.currentTarget.dataset.i;
    if (imageMentions.usesShiftedIndex(this.data.prompt, i + 1)) {
      this.setNote('提示词已引用图片 ' + (i + 1) + ' 或后续图片，请先删除对应 @图片N', C_ERR); return;
    }
    this._b64.refImgs.splice(i, 1);
    const prevs = this.data.refPreviews.slice(); prevs.splice(i, 1);
    this.setData({ refPreviews: prevs });
    this._syncGenPricing();
    this._draftChanged(true);
  },
  clearRef() {
    if (!this.data.refPreviews.length) return;
    if (imageMentions.usesShiftedIndex(this.data.prompt, 1)) {
      this.setNote('提示词仍有 @图片N，请先删除引用再清空图片', C_ERR); return;
    }
    wx.showModal({
      title: '清空参考图',
      content: '将从当前草稿移除全部参考图，是否继续？',
      confirmText: '确认清空',
      success: (res) => { if (res.confirm) this._clearRefConfirmed(); }
    });
  },
  _clearRefConfirmed() {
    this._nextMediaToken('generate_refs');
    this._b64.refImgs = [];
    this.setData({ refPreviews: [] });
    this._syncGenPricing();
    this._draftChanged(true);
  },
  insertGenerateRefMention(e) {
    const index = +e.currentTarget.dataset.i + 1;
    if (index < 1 || index > this.data.refPreviews.length) return;
    const cursor = this.data.promptCursor >= 0 ? this.data.promptCursor : this.data.prompt.length;
    const result = imageMentions.insert(this.data.prompt, index, cursor, cursor);
    this.setData({ prompt: result.value, promptCursor: result.cursor, promptMentionOpen: false });
    this._draftChanged(true);
  },

  // ===== 果肉官方视频编辑（xAI）=====
  selectGrokOp(e) {
    if (e.currentTarget.dataset.v === 'edit') {
      wx.showToast({ title: '果肉视频编辑维护中', icon: 'none' });
      return;
    }
    this.setData({ grokOp: 'generate' });
    this._draftChanged(true);
  },
  chooseEditVideo() {
    wx.chooseMedia({
      count: 1, mediaType: ['video'], sourceType: ['album'], maxDuration: 9,
      success: (res) => {
        const f = res.tempFiles[0];
        const dur = f.duration || 0;
        if (dur > 8.7) { this.setNote('参考视频最长 8.7 秒，请剪短后再上传', C_ERR); return; }
        if (f.size && f.size > 30 * 1024 * 1024) { this.setNote('视频过大（>30MB），请压缩后再上传', C_ERR); return; }
        const mode = this.data.mode;
        const token = this._nextMediaToken('generate_edit');
        this._persistAndRead(f.tempFilePath, 'video/mp4').then((item) => {
          if (!this._mediaIsCurrent('generate_edit', token, mode)) { this._discardPersisted([item]); return; }
          if (item.data.indexOf('data:video/mp4') !== 0) { this._discardPersisted([item]); this.setNote('仅支持 MP4 格式的视频', C_ERR); return; }
          // 计价公式与后端 points.py 编辑分支保持一致（扣点以服务端返回为准，这里仅展示）
          const d = Math.max(0.1, Math.min(8.7, dur));
          const cost = Math.max(1, Math.ceil(d * (0.01 + 0.07) * 7.3 * 1.2 * 10));
          this._b64.editVideo = item.data;
          this.setData({ editVideoPath: item.path, editVideoName: '已选视频 · ' + dur.toFixed(1) + ' 秒', editDuration: dur, editCost: cost });
          this._draftChanged(true);
        }).catch(() => this._mediaDraftFailed(mode, 'generate_edit', token));
      }
    });
  },
  clearEditVideo() {
    this._nextMediaToken('generate_edit');
    this._b64.editVideo = '';
    this.setData({ editVideoPath: '', editVideoName: '', editDuration: 0, editCost: 0 });
    this._draftChanged(true);
  },

  submitGenerate() {
    if (this.data.busy) return;
    if (this.data.draftRestoring) { this.setNote('草稿媒体恢复中，请稍候', C_INFO); return; }
    if (this.data.refPreviews.length !== this._b64.refImgs.filter(Boolean).length) {
      this.setNote('部分参考图已失效，请移除后重新选择', C_ERR); return;
    }
    const prompt = (this.data.prompt || '').trim();
    if (!prompt) { this.setNote('请先输入画面描述', C_ERR); return; }
    const meaningfulLength = Array.from(prompt).filter((ch) => /[\u3400-\u9fffa-zA-Z0-9]/.test(ch)).length;
    if (meaningfulLength < 5) {
      this.setNote('画面描述太短，请至少输入 5 个有效文字，例如“让人物缓慢跑起来”', C_ERR);
      return;
    }
    const mentionError = imageMentions.validate(prompt, this.data.refPreviews.length);
    if (mentionError) { this.setNote(mentionError, C_ERR); return; }
    if (this.data.engine === 'grok' && this.data.grokOp === 'edit') {
      if (!this._b64.editVideo) { this.setNote('请先上传 MP4 参考视频', C_ERR); return; }
      const editBody = {
        channel: 'grok', prompt: prompt, operation: 'edit', model: 'grok-imagine-video',
        reference_video_data: this._b64.editVideo, source_duration: this.data.editDuration
      };
      this.submitJob('/api/gen/xiaole_video', editBody, this.data.editCost || 1);
      return;
    }
    if (this.data.engine === 'sora') {
      const model = this.data.soraModel;
      const seconds = this.data.soraDuration;
      const resolution = this.data.soraResolution;
      if (!SORA_VIDEO.rates[model + ':' + resolution]
        || SORA_VIDEO.durations.indexOf(seconds) < 0
        || SORA_VIDEO.ratios.indexOf(this.data.ratio) < 0) {
        this.setNote('Sora 参数不支持，请重新选择模型、时长、清晰度和比例', C_ERR);
        return;
      }
      this.submitJob('/api/gen/sora_video', {
        model: model, prompt: prompt, seconds: seconds, ratio: this.data.ratio, resolution: resolution,
        reference_images: this.data.refPreviews.length ? this._b64.refImgs : []
      }, this._genCost());
      return;
    }
    const body = { channel: this.data.engine, prompt: prompt, ratio: this.data.ratio };
    if (this.data.engine === 'grok') {
      if (this.data.grokDur > 10) {
        this.setNote('果肉视频最长支持 10 秒', C_ERR);
        return;
      }
      if (this.data.grokModel === 'grok-imagine-video-1.5' && this.data.refPreviews.length < 1) {
        this.setNote('果肉高清 1.5 至少需要 1 张参考图', C_ERR);
        return;
      }
      if (this.data.refPreviews.length && this.data.grokRes !== '720p') {
        this.setNote('使用参考图时仅支持 720p', C_ERR); return;
      }
      // 果肉官方线（xAI）：模型/分辨率/时长全量传给后端，动态计价
      body.model = this.data.grokModel;
      body.resolution = this.data.grokRes;
      body.duration = this.data.grokDur;
    } else {
      const cfg = OFFICIAL_VIDEO[this.data.engine];
      body.model = cfg.model;
      body.duration = this.data.officialDuration;
      body.resolution = this.data.officialResolution;
      if (this.data.engine === 'micro') body.generate_audio = true;
    }
    if (this.data.engineRef && this.data.refPreviews.length) {
      // 后端期望字符串数组：dataURL / https URL（不要 {type,value} 对象），果肉最多 7 张
      body.reference_images = this._b64.refImgs;
    }
    this.submitJob('/api/gen/xiaole_video', body, this._genCost());
  },

  // ===== 数字化 IP talking =====
  fetchVoices() {
    api.request('/api/gen/audio/voices', { method: 'GET' }).then((res) => {
      const items = (res.data && res.data.items) || [];
      const voices = items.map((v) => ({
        key: v.voice_key, name: v.display_name || v.voice_key,
        scope: v.scope, preview: v.preview_url || ''
      })).filter((v) => v.key);
      this._voicesLoaded = true;
      const patch = { voices };
      if (!voices.some((voice) => voice.key === this.data.voiceKey)) {
        patch.voiceKey = voices.length ? voices[0].key : '';
        patch.voiceName = voices.length ? voices[0].name : '';
      }
      this.setData(patch);
    }).catch(() => {});
  },
  selectTalkMode(e) {
    this._nextMediaToken('talk_audio');
    this.setData({ talkMode: e.currentTarget.dataset.k, note: '' });
    this._draftChanged(true);
  },
  chooseTalkImg() {
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sizeType: ['compressed'], sourceType: ['album', 'camera'],
      success: (res) => {
        const file = (res.tempFiles || [])[0];
        if (!file) return;
        const mode = this.data.mode;
        const token = this._nextMediaToken('talk_image');
        this._persistAndRead(file.tempFilePath, 'image/jpeg').then((item) => {
          if (!this._mediaIsCurrent('talk_image', token, mode)) { this._discardPersisted([item]); return; }
          this._b64.talkImg = item.data;
          this.setData({ talkImgPath: item.path, talkImgPreview: item.path });
          this._draftChanged(true);
        }).catch(() => this._mediaDraftFailed(mode, 'talk_image', token));
      }
    });
  },
  clearTalkImg() {
    this._nextMediaToken('talk_image');
    this._b64.talkImg = '';
    this.setData({ talkImgPath: '', talkImgPreview: '' });
    this._draftChanged(true);
  },
  onTalkText(e) {
    const text = e.detail.value || '';
    this.setData({ talkText: text, cost: this._talkEstimate(text) });
    this._draftChanged(false);
  },

  _talkEstimate(text) {
    const seconds = Math.max(1, String(text || '').trim().length / 4);
    return Math.max(30, Math.ceil(seconds / 30) * 30);
  },
  selectVoice(e) {
    const key = e.currentTarget.dataset.k;
    const v = this.data.voices.find((x) => x.key === key);
    this.setData({ voiceKey: key, voiceName: v ? v.name : '' });
    this._draftChanged(true);
  },
  playVoice(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) { wx.showToast({ title: '暂无试听', icon: 'none' }); return; }
    if (!this._vp) { this._vp = wx.createInnerAudioContext(); }
    this._vp.stop(); this._vp.src = url; this._vp.play();
  },
  selectTalkRes(e) { this.setData({ talkRes: e.currentTarget.dataset.v }); this._draftChanged(true); },
  goClone() { wx.navigateTo({ url: '/pages/clone/clone' }); },
  chooseTalkAudio() {
    if (!this.data.talkAudioConsent) {
      this.setData({ talkAudioConsentVisible: true, talkAudioConsentChecked: false });
      return;
    }
    this._chooseTalkAudioFile();
  },
  onTalkAudioConsentChange(e) {
    const values = (e && e.detail && e.detail.value) || [];
    this.setData({ talkAudioConsentChecked: values.indexOf('agreed') >= 0 });
  },
  cancelTalkAudioConsent() {
    this.setData({ talkAudioConsentVisible: false, talkAudioConsentChecked: false });
  },
  confirmTalkAudioConsent() {
    if (!this.data.talkAudioConsentChecked) {
      wx.showToast({ title: '请先阅读并同意声纹授权协议', icon: 'none' });
      return;
    }
    this.setData({
      talkAudioConsentVisible: false,
      talkAudioConsentChecked: false,
      talkAudioConsent: true,
      talkAudioConsentAt: new Date().toISOString()
    }, () => this._chooseTalkAudioFile());
  },
  _chooseTalkAudioFile() {
    wx.chooseMessageFile({
      count: 1, type: 'file', extension: ['mp3', 'wav', 'm4a'],
      success: (res) => {
        const f = res.tempFiles[0];
        const mime = this._ext2mime(f.name || f.path) || 'audio/mpeg';
        if (f.size && f.size > 20 * 1024 * 1024) { this.setNote('音频过大（>20MB）', C_ERR); return; }
        const mode = this.data.mode;
        const token = this._nextMediaToken('talk_audio');
        this._persistAndRead(f.path, mime).then((item) => {
          if (!this._mediaIsCurrent('talk_audio', token, mode)) { this._discardPersisted([item]); return; }
          this._b64.talkAudio = item.data;
          this.setData({ talkAudioPath: item.path, talkAudioName: f.name || '已选择音频' });
          this._draftChanged(true);
        }).catch(() => this._mediaDraftFailed(mode, 'talk_audio', token));
      }
    });
  },
  submitTalking() {
    if (this.data.busy) return;
    if (this.data.draftRestoring) { this.setNote('草稿媒体恢复中，请稍候', C_INFO); return; }
    if (this.data.talkBatch) { this.submitTalkingBatch(); return; }
    if (!this._b64.talkImg) { this.setNote('请先上传人物形象照片', C_ERR); return; }
    const body = {
      mode: this.data.talkMode, image_data: this._b64.talkImg,
      resolution: this.data.talkRes, ratio: this.data.ratio, motion: 'medium'
    };
    if (this.data.talkMode === 'text') {
      const text = (this.data.talkText || '').trim();
      if (!text) { this.setNote('请先输入口播文案', C_ERR); return; }
      if (!this.data.voiceKey) { this.setNote('请先选择音色', C_ERR); return; }
      body.text = text; body.voice = this.data.voiceKey;
    } else {
      if (!this.data.talkAudioConsent) {
        this.setData({ talkAudioConsentVisible: true, talkAudioConsentChecked: false });
        this.setNote('请先阅读并单独同意《声纹授权协议》', C_ERR);
        return;
      }
      if (!this._b64.talkAudio) { this.setNote('请先选择口播音频', C_ERR); return; }
      body.audio_data = this._b64.talkAudio;
      body.voice_consent = true;
      body.voice_consent_scope = 'talking_audio';
      body.voice_consent_version = TALK_AUDIO_CONSENT_VERSION;
      body.voice_consent_at = this.data.talkAudioConsentAt;
    }
    this.submitJob('/api/gen/video', body, VIDEO_COST);
  },

  // ===== 口播批量：一段文案 × 多个形象（2~5 个，后端 /api/gen/video/batch）=====
  toggleTalkBatch(e) {
    const on = e.currentTarget.dataset.v === 'batch';
    if (on === this.data.talkBatch) return;
    this._cancelModeMedia('talking');
    // 批量仅支持「文案+音色」（后端限制 mode=text）
    this.setData({ talkBatch: on, talkMode: 'text', note: '', videoUrl: '', batchJobs: [] });
    this._draftChanged(true);
  },
  _setBatchItems(items) {
    const map = {};
    items.forEach((x) => { if (x.kind === 'avatar') map[x.id] = true; });
    this.setData({ batchItems: items, batchSelMap: map });
  },
  toggleBatchAvatar(e) {
    const id = +e.currentTarget.dataset.id;
    const items = this.data.batchItems.slice();
    const i = items.findIndex((x) => x.kind === 'avatar' && x.id === id);
    if (i >= 0) { items.splice(i, 1); this._setBatchItems(items); this._draftChanged(true); return; }
    if (items.length >= VIDEO_BATCH_MAX) { this.setNote('批量最多 ' + VIDEO_BATCH_MAX + ' 个形象', C_ERR); return; }
    const a = this.data.avatars.find((x) => x.id === id) || {};
    items.push({ kind: 'avatar', id, data: '', preview: a.image || '', label: a.name || ('形象 ' + id) });
    this._setBatchItems(items);
    this._draftChanged(true);
  },
  addBatchImage() {
    const left = VIDEO_BATCH_MAX - this.data.batchItems.length;
    if (left <= 0) { this.setNote('批量最多 ' + VIDEO_BATCH_MAX + ' 个形象', C_ERR); return; }
    wx.chooseMedia({
      count: left, mediaType: ['image'], sizeType: ['compressed'], sourceType: ['album', 'camera'],
      success: (res) => {
        const mode = this.data.mode;
        const token = this._nextMediaToken('talk_batch_images');
        const files = res.tempFiles || [];
        Promise.all(files.map((f) => this._persistAndRead(f.tempFilePath, 'image/jpeg').catch(() => null)))
          .then((results) => {
            const saved = results.filter(Boolean);
            if (saved.length !== files.length) { this._discardPersisted(saved); this._mediaDraftFailed(mode, 'talk_batch_images', token); return; }
            if (!this._mediaIsCurrent('talk_batch_images', token, mode)) { this._discardPersisted(saved); return; }
            const accepted = saved.slice(0, Math.max(0, VIDEO_BATCH_MAX - this.data.batchItems.length));
            this._discardPersisted(saved.slice(accepted.length));
            const items = this.data.batchItems.slice();
            accepted.forEach((item) => {
              const bid = ++this._batchBid;
              this._b64['batch_' + bid] = item.data;
              items.push({ kind: 'image', id: 0, bid, path: item.path, preview: item.path, label: '照片形象 ' + (items.length + 1) });
            });
            this._setBatchItems(items);
            this._draftChanged(true);
          });
      }
    });
  },
  removeBatchItem(e) {
    const items = this.data.batchItems.slice();
    const removed = items.splice(+e.currentTarget.dataset.i, 1)[0];
    if (removed && removed.kind === 'image' && removed.bid != null) delete this._b64['batch_' + removed.bid];
    this._setBatchItems(items);
    this._draftChanged(true);
  },
  submitTalkingBatch() {
    if (this.data.busy || this._subscriptionPending) return;
    if (this.data.draftRestoring) { this.setNote('草稿媒体恢复中，请稍候', C_INFO); return; }
    const items = this.data.batchItems;
    if (items.length < 2) { this.setNote('批量出片请至少选择 2 个形象（同一形象不能重复）', C_ERR); return; }
    const text = (this.data.talkText || '').trim();
    if (!text) { this.setNote('请先输入口播文案', C_ERR); return; }
    if (!this.data.voiceKey) { this.setNote('请先选择音色', C_ERR); return; }
    if (items.some((item) => item.kind === 'image' && !this._b64['batch_' + item.bid])) {
      this.setNote('部分人物照片已失效，请移除后重新选择', C_ERR); return;
    }
    const need = this._talkEstimate(text) * items.length;
    if (this.data.points !== null && this.data.points < need) {
      this.setNote('点数不足（约需 ' + need + ' 点，当前 ' + this.data.points + ' 点）', C_ERR);
      return;
    }
    const body = {
      mode: 'text', text, voice: this.data.voiceKey,
      resolution: this.data.talkRes, ratio: this.data.ratio, motion: 'medium',
      // 每项必须且只能提供 image_data 或 avatar_id 之一（后端 validate_video_batch_payload）
      avatars: items.map((x) => x.kind === 'avatar'
        ? { avatar_id: String(x.id), label: x.label }
        : { image_data: this._b64['batch_' + x.bid], label: x.label })
    };
    const submittedMode = this.data.mode;
    const submission = this._submissionDraftState(submittedMode);
    const lifecycleToken = this._lifecycleToken;
    this._subscriptionPending = true;
    this._requestWorkCompleteSubscription()
      .catch(() => {})
      .then(() => {
        if (lifecycleToken !== this._lifecycleToken) return;
        this._subscriptionPending = false;
        if (this.data.mode !== submittedMode) return;
        this._submitTalkingBatchRequest(body, need, submittedMode, submission.localRevision, submission.storageRevision);
      });
  },
  _submitTalkingBatchRequest(body, need, submittedMode, submittedLocalRevision, submittedStorageRevision) {
    const mode = submittedMode || 'talking';
    const localRevision = typeof submittedLocalRevision === 'number' ? submittedLocalRevision : this._draftRevisionValue(mode);
    const storageRevision = submittedStorageRevision !== undefined ? submittedStorageRevision : drafts.getRevision(this._draftKey(mode));
    const token = ++this._pollToken;
    const t0 = Date.now();
    this.setData({ busy: true, videoUrl: '', batchJobs: [], cost: need });
    this.setNote('批量提交中…', C_INFO);
    api.request('/api/gen/video/batch', { method: 'POST', data: body, timeout: 120000 })
      .then((res) => {
        const current = token === this._pollToken;
        const d = res.data || {};
        const rawJobs = Array.isArray(d.jobs) ? d.jobs : [];
        const jobs = rawJobs.filter((job) => job && this._validJobId(job.job_id));
        const accepted = Number(res.statusCode) >= 200 && Number(res.statusCode) < 300
          && jobs.length > 0 && jobs.length === rawJobs.length;
        if (accepted) {
          this._clearAcceptedDraft(mode, storageRevision, localRevision, current);
          if (!current) return;
          if (typeof d.cost === 'number') this.setData({ cost: d.cost });
          if (typeof d.points_left === 'number') this.setData({ points: d.points_left });
          this.setData({
            batchJobs: jobs.map((j) => ({ jobId: j.job_id, label: j.label || ('形象 ' + j.index), status: 'pending', phase: '', url: '', statusText: '排队中' }))
          });
          this.setNote('已提交 ' + jobs.length + ' 条任务（共 ' + (d.cost || need) + ' 点）', C_INFO);
          this.startBatchPolling(t0, token);
          return;
        }
        if (!current) return;
        if (res.statusCode === 402) { this.setData({ busy: false }); this.setNote('点数不足' + (d.need ? '（需 ' + d.need + ' 点）' : ''), C_ERR); return; }
        if (res.statusCode === 429) { this.setData({ busy: false }); this.setNote(d.detail || '任务位不足，请稍后再试', C_ERR); return; }
        if (res.statusCode === 400) { this.setData({ busy: false }); this.setNote('提交失败：' + (d.detail || '参数有误'), C_ERR); return; }
        if (res.statusCode === 503) { this.setData({ busy: false }); this.setNote(d.detail || '该功能暂未开放', C_ERR); return; }
        if (!(Number(res.statusCode) >= 200 && Number(res.statusCode) < 300)) {
          this.setData({ busy: false }); this.setNote('提交失败：' + (d.detail || '服务异常'), C_ERR); return;
        }
        if (!jobs.length || jobs.length !== rawJobs.length) {
          this.setData({ busy: false }); this.setNote('提交失败：' + (d.detail || '任务编号无效'), C_ERR); return;
        }
      })
      .catch(() => {
        if (token !== this._pollToken) return;
        this.setData({ busy: false });
        this.setNote('提交结果暂未确认，请先到「历史作品」查看，避免重复提交', C_INFO);
        this.refreshPoints();
      });
  },
  startBatchPolling(t0, token) {
    const tick = () => {
      if (token !== this._pollToken) return;
      const jobs = this.data.batchJobs;
      const pending = jobs.filter((j) => j.status !== 'done' && j.status !== 'failed');
      if (!pending.length) return;
      const sec = Math.round((Date.now() - t0) / 1000);
      if (sec > POLL_TIMEOUT_SEC) {
        this.setData({ busy: false });
        this.setNote('部分任务仍在处理，请稍后到「历史作品」查看（' + sec + 's）', C_INFO);
        return;
      }
      let remain = pending.length;
      pending.forEach((job) => {
        api.request('/api/gen/job/' + job.jobId, { method: 'GET' })
          .then((res) => {
            if (token !== this._pollToken) return;
            const d = res.data || {};
            const list = this.data.batchJobs.slice();
            const i = list.findIndex((x) => x.jobId === job.jobId);
            if (i < 0) return;
            if (d.status === 'done') {
              const url = api.absUrl(((d.result || {}).video_url) || ((d.result || {}).url) || '');
              list[i] = Object.assign({}, list[i], { status: 'done', statusText: '✅ 完成', url });
              this.setData({ batchJobs: list });
              // 受保护视频带 token 下到本地再播
              if (url && url.indexOf('/api/gen/file/') !== -1) {
                api.downloadProtected(url).then((tmp) => {
                  if (token !== this._pollToken) return;
                  const l2 = this.data.batchJobs.slice();
                  const k = l2.findIndex((x) => x.jobId === job.jobId);
                  if (k >= 0) { l2[k] = Object.assign({}, l2[k], { url: tmp }); this.setData({ batchJobs: l2 }); }
                }).catch(() => {});
              }
            } else if (d.status === 'error' || d.status === 'failed') {
              list[i] = Object.assign({}, list[i], { status: 'failed', statusText: '失败：' + (d.error || d.detail || 'error') });
              this.setData({ batchJobs: list });
            } else {
              const label = PHASE_LABEL[d.phase] || PHASE_LABEL[d.status] || '生成中';
              list[i] = Object.assign({}, list[i], { statusText: label + '（' + sec + 's）' });
              this.setData({ batchJobs: list });
            }
          })
          .catch(() => {})
          .then(() => {
            remain -= 1;
            if (remain > 0 || token !== this._pollToken) return;
            const now = this.data.batchJobs;
            const left = now.filter((j) => j.status !== 'done' && j.status !== 'failed').length;
            if (!left) {
              const ok = now.filter((j) => j.status === 'done').length;
              this.setData({ busy: false });
              this.setNote('批量完成：成功 ' + ok + ' / ' + now.length + ' 条', ok ? C_OK : C_ERR);
              this.refreshPoints();
            } else {
              this._pollTimer = setTimeout(tick, POLL_INTERVAL);
            }
          });
      });
    };
    this._pollTimer = setTimeout(tick, POLL_INTERVAL);
  },
  saveBatchVideo(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    wx.showLoading({ title: '保存中', mask: true });
    const save = (fp) => wx.saveVideoToPhotosAlbum({
      filePath: fp,
      success: () => { wx.hideLoading(); wx.showToast({ title: '已保存到相册' }); },
      fail: () => { wx.hideLoading(); wx.showToast({ title: '未授权或保存失败', icon: 'none' }); }
    });
    if (url.indexOf('http') !== 0) { save(url); return; }
    api.downloadProtected(url).then(save).catch(() => { wx.hideLoading(); wx.showToast({ title: '下载失败', icon: 'none' }); });
  },

  // ===== 电影化身 cinematic（motion/duo：形象照参考视频演；open：自写提示词）=====
  fetchAvatars(options) {
    const fetchToken = ++this._avatarFetchToken;
    return api.request('/api/gen/video/avatars', { method: 'GET' }).then((res) => {
      if (fetchToken !== this._avatarFetchToken) return [];
      if (Number(res.statusCode) !== 200 || !res.data || !Array.isArray(res.data.items)) throw new Error('形象列表加载失败');
      const items = res.data.items.map((a) => {
        const remoteImage = api.absUrl(a.image_url || '');
        const protectedImage = remoteImage.indexOf('/api/gen/file/') !== -1 ? remoteImage : '';
        return {
          id: a.id, name: a.name || ('形象 ' + a.id),
          // 私有文件不能先交给 <image> 直连，否则一定先产生一次无鉴权 401。
          image: protectedImage ? '' : remoteImage,
          protectedImage: protectedImage,
          status: a.status
        };
      });
      this._avatarsLoaded = true;
      const patch = { avatars: items };
      this.setData(patch);
      this._reconcileAvatarReferences(items);
      if ((!options || options.selectDefault !== false) && !this.data.avatarIds.length && items.length) this._setAvatarIds([items[0].id]);
      // 形象图多为受保护 /api/gen/file/（<image> 带不了 Authorization，直连 401）。
      // 与 assets 页同方案：带 token 下到本地临时文件再显示（downloadProtected 自带缓存）
      items.forEach((a, i) => {
        if (a.protectedImage) {
          api.downloadProtected(a.protectedImage).then((tmp) => {
            if (fetchToken !== this._avatarFetchToken
              || !this.data.avatars[i] || Number(this.data.avatars[i].id) !== Number(a.id)) return;
            this.setData({ ['avatars[' + i + '].image']: tmp });
          }).catch(() => {});
        }
      });
      return items;
    }).catch(() => []);
  },
  manageAvatar(e) {
    const id = Number(e.currentTarget.dataset.id);
    const avatar = this.data.avatars.find((item) => Number(item.id) === id);
    if (!avatar) return;
    wx.showActionSheet({
      itemList: ['重命名', '删除'],
      success: (res) => {
        if (res.tapIndex === 0) this._renameAvatar(avatar);
        else if (res.tapIndex === 1) this._deleteAvatar(avatar);
      }
    });
  },
  _renameAvatar(avatar) {
    wx.showModal({
      title: '重命名形象', editable: true, content: avatar.name || '', placeholderText: '输入形象名称',
      success: (res) => {
        if (!res.confirm) return;
        const name = String(res.content || '').trim();
        if (!name) { wx.showToast({ title: '名称不能为空', icon: 'none' }); return; }
        this._renameAvatarRequest(avatar.id, name);
      }
    });
  },
  _renameAvatarRequest(id, name) {
    return api.request('/api/gen/video/avatar-name', { method: 'POST', data: { id, name } }).then((res) => {
      const data = res.data || {};
      if (res.statusCode !== 200 || !data.ok) throw new Error(data.detail || '重命名失败');
      const batchItems = (this.data.batchItems || []).map((item) => item.kind === 'avatar' && Number(item.id) === Number(id)
        ? Object.assign({}, item, { label: name }) : item);
      this._setBatchItems(batchItems);
      this._avatarsLoaded = false;
      wx.showToast({ title: '已重命名' });
      return this.fetchAvatars().then(() => { this._draftChanged(true); return data; });
    }).catch((error) => {
      wx.showToast({ title: error.message || '重命名失败', icon: 'none' });
      return null;
    });
  },
  _deleteAvatar(avatar) {
    wx.showModal({
      title: '删除形象',
      content: '只会从“我的形象”列表移除，不影响已生成作品。替换形象可先新建，再删除旧形象。',
      confirmText: '删除', confirmColor: '#ff5c8a',
      success: (res) => { if (res.confirm) this._deleteAvatarRequest(avatar.id); }
    });
  },
  _deleteAvatarRequest(id) {
    return api.request('/api/gen/video/avatar-delete', { method: 'POST', data: { id } }).then((res) => {
      const data = res.data || {};
      if (res.statusCode !== 200 || !data.ok) throw new Error(data.detail || '删除失败');
      const avatars = (this.data.avatars || []).filter((item) => Number(item.id) !== Number(id));
      this.setData({ avatars });
      this._reconcileAvatarReferences(avatars, id);
      this._avatarsLoaded = false;
      wx.showToast({ title: '已从形象列表移除' });
      return this.fetchAvatars({ selectDefault: false }).then(() => data);
    }).catch((error) => {
      wx.showToast({ title: error.message || '删除失败', icon: 'none' });
      return null;
    });
  },
  _setAvatarIds(ids) {
    const map = {};
    ids.forEach((id) => { map[id] = true; });
    this.setData({ avatarIds: ids, avatarSelMap: map });
  },
  // 形象选择：motion 单选替换；duo/open 点选切换（duo 上限 2、open 上限 3）
  selectAvatar(e) {
    const id = +e.currentTarget.dataset.id;
    const mode = this.data.cineMode;
    if (mode === 'motion') { this._setAvatarIds([id]); this._draftChanged(true); return; }
    const max = mode === 'duo' ? 2 : CINE_MAX_AVATARS;
    let ids = this.data.avatarIds.slice();
    const i = ids.indexOf(id);
    if (i >= 0) ids.splice(i, 1);
    else if (ids.length >= max) {
      this.setNote((mode === 'duo' ? '双人动作模仿正好选 2 个形象' : '开放式生成最多选 ' + max + ' 个形象'), C_ERR);
      return;
    } else ids.push(id);
    if (mode === 'open' && ids.length + this.data.cineRefPreviews.length > CINE_MAX_MEDIA_IMAGES) {
      this.setNote('形象与参考图合计最多 ' + CINE_MAX_MEDIA_IMAGES + ' 张', C_ERR); return;
    }
    this._setAvatarIds(ids);
    this._draftChanged(true);
  },
  selectCineMode(e) {
    const k = e.currentTarget.dataset.k;
    if (k === this.data.cineMode) return;
    const hasOpenDraft = this.data.cineMode === 'open' && k !== 'open'
      && (!!String(this.data.cinePrompt || '').trim() || this.data.cineRefVideos.length || this.data.cineRefPreviews.length);
    if (hasOpenDraft) {
      wx.showModal({
        title: '切换会清空开放式内容',
        content: '开放式画面描述和参考媒体将从当前草稿移除，是否继续？',
        confirmText: '继续切换',
        success: (res) => { if (res.confirm) this._applyCineMode(k); }
      });
      return;
    }
    this._applyCineMode(k);
  },
  _applyCineMode(k) {
    this._nextMediaToken('cine_ref_videos');
    this._nextMediaToken('cine_ref_images');
    // 切玩法：时长档位跟着换；已选形象裁到该玩法上限；清 open 专属输入防串
    const max = k === 'duo' ? 2 : (k === 'motion' ? 1 : CINE_MAX_AVATARS);
    this._b64.cineRefVideos = []; this._b64.cineRefImgs = []; // 与下面清 open 输入的 setData 同步
    this.setData({
      cineMode: k,
      cineDurs: k === 'open' ? CINE_DURATIONS_OPEN : CINE_DURATIONS,
      cineRes: k === 'motion' ? '1080p' : '720p',
      cineDur: 'auto',
      cinePrompt: '', cineRefVideos: [], cineRefImgs: [], cineRefPreviews: [],
      note: '', noteColor: C_MUTED
    });
    this._setAvatarIds(this.data.avatarIds.slice(0, max));
    this.setData({ cineEst: this._cineEstimate() });
    this._draftChanged(true);
  },
  onCinePrompt(e) { this.setData({ cinePrompt: e.detail.value }); this._draftChanged(false); },
  // open 玩法：参考视频最多 3 个
  chooseCineRefVideo() {
    if (this.data.cineRefVideos.length >= CINE_MAX_REF_VIDEOS) {
      this.setNote('参考视频最多 ' + CINE_MAX_REF_VIDEOS + ' 个', C_ERR); return;
    }
    wx.chooseMedia({
      count: 1, mediaType: ['video'], sourceType: ['album', 'camera'], maxDuration: 60, camera: 'back',
      success: (res) => {
        const f = res.tempFiles[0];
        const dur = Math.round(f.duration || 0);
        if (dur > 120) { this.setNote('参考视频最长 120 秒，请剪短后再上传', C_ERR); return; }
        if (f.size && f.size > 60 * 1024 * 1024) { this.setNote('视频过大（>60MB），请压缩后再上传', C_ERR); return; }
        const mode = this.data.mode;
        const token = this._nextMediaToken('cine_ref_videos');
        this._persistAndRead(f.tempFilePath, 'video/mp4').then((item) => {
          if (!this._mediaIsCurrent('cine_ref_videos', token, mode)) { this._discardPersisted([item]); return; }
          if (this.data.cineRefVideos.length >= CINE_MAX_REF_VIDEOS) { this._discardPersisted([item]); return; }
          this._b64.cineRefVideos.push(item.data);
          this.setData({ cineRefVideos: this.data.cineRefVideos.concat([{ path: item.path, name: '参考视频 · ' + dur + ' 秒', dur }]) });
          this.setData({ cineEst: this._cineEstimate() });
          this._draftChanged(true);
        }).catch(() => this._mediaDraftFailed(mode, 'cine_ref_videos', token));
      }
    });
  },
  removeCineRefVideo(e) {
    const i = +e.currentTarget.dataset.i;
    this._b64.cineRefVideos.splice(i, 1);
    const vids = this.data.cineRefVideos.slice();
    vids.splice(i, 1);
    this.setData({ cineRefVideos: vids });
    this.setData({ cineEst: this._cineEstimate() });
    this._draftChanged(true);
  },
  // open 玩法：参考图与形象共用 9 张图额度（后端 cinematic_ref_budget）
  chooseCineRefImg() {
    const budget = Math.max(0, CINE_MAX_MEDIA_IMAGES - this.data.avatarIds.length);
    const left = budget - this.data.cineRefPreviews.length;
    if (left <= 0) { this.setNote('参考图最多 ' + budget + ' 张（与形象共用 9 张图额度）', C_ERR); return; }
    wx.chooseMedia({
      count: Math.min(left, 9), mediaType: ['image'], sizeType: ['compressed'], sourceType: ['album', 'camera'],
      success: (res) => {
        const mode = this.data.mode;
        const token = this._nextMediaToken('cine_ref_images');
        const files = res.tempFiles || [];
        Promise.all(files.map((f) => this._persistAndRead(f.tempFilePath, 'image/jpeg').catch(() => null)))
          .then((results) => {
            const items = results.filter(Boolean);
            if (items.length !== files.length) { this._discardPersisted(items); this._mediaDraftFailed(mode, 'cine_ref_images', token); return; }
            if (!this._mediaIsCurrent('cine_ref_images', token, mode)) { this._discardPersisted(items); return; }
            const b = Math.max(0, CINE_MAX_MEDIA_IMAGES - this.data.avatarIds.length);
            const accepted = items.slice(0, Math.max(0, b - this.data.cineRefPreviews.length));
            this._discardPersisted(items.slice(accepted.length));
            this._b64.cineRefImgs = this._b64.cineRefImgs.concat(accepted.map((item) => item.data));
            this.setData({ cineRefPreviews: this.data.cineRefPreviews.concat(accepted.map((item) => item.path)) });
            this._draftChanged(true);
          });
      }
    });
  },
  removeCineRefImg(e) {
    const i = +e.currentTarget.dataset.i;
    if (imageMentions.usesShiftedIndex(this.data.cinePrompt, i + 1)) {
      this.setNote('画面描述已引用图片 ' + (i + 1) + ' 或后续图片，请先删除对应 @图片N', C_ERR); return;
    }
    this._b64.cineRefImgs.splice(i, 1);
    const prevs = this.data.cineRefPreviews.slice(); prevs.splice(i, 1);
    this.setData({ cineRefPreviews: prevs });
    this._draftChanged(true);
  },
  insertCineRefMention(e) {
    const index = +e.currentTarget.dataset.i + 1;
    if (index < 1 || index > this.data.cineRefPreviews.length) return;
    this.setData({ cinePrompt: imageMentions.append(this.data.cinePrompt, index) });
    this._draftChanged(true);
  },

  // 建形象：选照片 → 提交 /api/gen/avatar（5点，约25秒）→ 轮询 → 刷新形象列表
  createAvatar() {
    if (this.data.avatarBusy) return;
    if (this.data.points !== null && this.data.points < AVATAR_COST) {
      this.setData({ avatarNote: '点数不足（建形象需 ' + AVATAR_COST + ' 点）' }); return;
    }
    this._chooseImage('image/jpeg', (url) => {
      this.setData({ avatarBusy: true, avatarNote: '建形象中，约 25 秒…' });
      api.request('/api/gen/avatar', { method: 'POST', data: { image_data: url }, timeout: 60000 })
        .then((res) => {
          const d = res.data || {};
          if (!d.job_id) {
            this.setData({ avatarBusy: false, avatarNote: '建形象失败：' + (d.detail || '未知错误') });
            return;
          }
          if (typeof d.points_left === 'number') this.setData({ points: d.points_left });
          this._pollAvatar(d.job_id, 0);
        })
        .catch(() => this.setData({ avatarBusy: false, avatarNote: '网络异常，请到「历史作品」确认后再试' }));
    });
  },
  _pollAvatar(jobId, n) {
    if (n > 30) { this.setData({ avatarBusy: false, avatarNote: '建形象超时，稍后下拉刷新形象列表' }); return; }
    setTimeout(() => {
      api.request('/api/gen/job/' + jobId, { method: 'GET' }).then((res) => {
        const d = res.data || {};
        if (d.status === 'done') {
          this.setData({ avatarBusy: false, avatarNote: '' });
          this._avatarsLoaded = false;
          this.fetchAvatars();
          wx.showToast({ title: '形象已创建' });
        } else if (d.status === 'error' || d.status === 'failed') {
          this.setData({ avatarBusy: false, avatarNote: '建形象失败：' + (d.error || '请换一张清晰正脸照') + ' · 已退点' });
          this.refreshPoints();
        } else {
          this._pollAvatar(jobId, n + 1);
        }
      }).catch(() => this._pollAvatar(jobId, n + 1));
    }, 3000);
  },

  chooseCineVideo() {
    wx.chooseMedia({
      count: 1, mediaType: ['video'], sourceType: ['album', 'camera'], maxDuration: 60, camera: 'back',
      success: (res) => {
        const f = res.tempFiles[0];
        const dur = Math.round(f.duration || 0);
        if (dur > 120) { this.setNote('参考视频最长 120 秒，请剪短后再上传', C_ERR); return; }
        if (f.size && f.size > 60 * 1024 * 1024) { this.setNote('视频过大（>60MB），请压缩后再上传', C_ERR); return; }
        const mode = this.data.mode;
        const token = this._nextMediaToken('cine_video');
        this._persistAndRead(f.tempFilePath, 'video/mp4').then((item) => {
          if (!this._mediaIsCurrent('cine_video', token, mode)) { this._discardPersisted([item]); return; }
          this._b64.cineVideo = item.data;
          this.setData({ cineVideoPath: item.path, cineVideoName: '已选视频 · ' + dur + ' 秒', cineVideoDur: dur });
          this.setData({ cineEst: this._cineEstimate() });
          this._draftChanged(true);
        }).catch(() => this._mediaDraftFailed(mode, 'cine_video', token));
      }
    });
  },
  clearCineVideo() {
    this._nextMediaToken('cine_video');
    this._b64.cineVideo = '';
    this.setData({ cineVideoPath: '', cineVideoName: '', cineVideoDur: 0 });
    this.setData({ cineEst: this._cineEstimate() });
    this._draftChanged(true);
  },
  selectCineRes(e) { this.setData({ cineRes: e.currentTarget.dataset.v }); this._draftChanged(true); },
  selectCineDur(e) {
    const v = e.currentTarget.dataset.v;
    this.setData({ cineDur: v === 'auto' ? 'auto' : +v });
    this.setData({ cineEst: this._cineEstimate() });
    this._draftChanged(true);
  },

  // 预估点数：秒数 × 玩法单价；自适应跟随第一个参考视频，
  // 无参考视频（open 纯提示词）回落 10 秒。实扣以服务端为准。
  _cineEstimate() {
    const mode = this.data.cineMode;
    const rate = CINE_RATES[mode] || 10;
    let refDur = 0;
    if (mode === 'open') refDur = this.data.cineRefVideos.length ? this.data.cineRefVideos[0].dur : 0;
    else refDur = this.data.cineVideoDur;
    const d = this.data.cineDur === 'auto'
      ? (refDur ? Math.min(Math.max(refDur, 4), 15) : 10)
      : this.data.cineDur;
    return Math.max(1, (d || 10) * rate);
  },
  submitCinematic() {
    if (this.data.busy) return;
    if (this.data.draftRestoring) { this.setNote('草稿媒体恢复中，请稍候', C_INFO); return; }
    const mode = this.data.cineMode;
    const ids = this.data.avatarIds;
    const need = CINE_NEED_AVATARS[mode]; // motion=1、duo=2（后端要求「正好 N 个」）
    if (need && ids.length !== need) {
      this.setNote(mode === 'duo' ? '双人动作模仿需要正好选 2 个形象' : '请先选择或创建一个形象', C_ERR);
      return;
    }
    if (mode === 'open' && !ids.length) { this.setNote('请至少选择一个形象', C_ERR); return; }
    const body = {
      cine_mode: mode,
      avatar_ids: ids,
      ratio: this.data.ratio,
      resolution: mode === 'motion' ? '1080p' : this.data.cineRes,
      duration: mode === 'motion' ? 'auto' : this.data.cineDur
    };
    if (mode === 'open') {
      const prompt = (this.data.cinePrompt || '').trim();
      if (!prompt) { this.setNote('开放式生成请填写画面描述', C_ERR); return; }
      if (prompt.length > CINE_PROMPT_MAX) { this.setNote('画面描述不能超过 ' + CINE_PROMPT_MAX + ' 字', C_ERR); return; }
      const mentionError = imageMentions.validate(prompt, this.data.cineRefPreviews.length);
      if (mentionError) { this.setNote(mentionError, C_ERR); return; }
      if (this.data.cineRefVideos.length !== this._b64.cineRefVideos.filter(Boolean).length
        || this.data.cineRefPreviews.length !== this._b64.cineRefImgs.filter(Boolean).length) {
        this.setNote('部分参考媒体已失效，请移除后重新选择', C_ERR); return;
      }
      body.prompt = prompt;
      if (this.data.cineRefVideos.length) body.reference_videos = this._b64.cineRefVideos;
      if (this.data.cineRefPreviews.length) body.reference_images = this._b64.cineRefImgs;
    } else {
      // motion/duo：提示词后端写死，正好 1 个参考视频、不收参考图
      if (!this._b64.cineVideo) { this.setNote('请先上传参考动作视频', C_ERR); return; }
      body.reference_videos = [this._b64.cineVideo];
    }
    this.submitJob('/api/gen/cinematic', body, this._cineEstimate());
  },

  // ===== 换装/换背景 tryon =====
  selectTryonType(e) {
    const k = e.currentTarget.dataset.k;
    if (k === this.data.tryonType) return;
    this.setData({
      tryonType: k, note: '', videoUrl: '',
      tryonPersonVideo: '', tryonPersonVideoName: '',
      tryonClothes: '', tryonClothesPreview: '', tryonBg: '', tryonBgPreview: ''
    });
  },
  chooseTryonPersonVideo() { this._chooseVideo((url) => this.setData({ tryonPersonVideo: url, tryonPersonVideoName: '人物视频已选择' })); },
  clearTryonPersonVideo() { this.setData({ tryonPersonVideo: '', tryonPersonVideoName: '' }); },
  chooseTryonClothes() { this._chooseImage('image/jpeg', (url, prev) => this.setData({ tryonClothes: url, tryonClothesPreview: prev })); },
  clearTryonClothes() { this.setData({ tryonClothes: '', tryonClothesPreview: '' }); },
  chooseTryonBg() { this._chooseImage('image/jpeg', (url, prev) => this.setData({ tryonBg: url, tryonBgPreview: prev })); },
  clearTryonBg() { this.setData({ tryonBg: '', tryonBgPreview: '' }); },
  submitTryon() {
    if (this.data.busy) return;
    const t = this.data.tryonType;
    let body;
    if (t === 'video_clothes') {
      if (!this.data.tryonPersonVideo) { this.setNote('请先上传人物视频', C_ERR); return; }
      if (!this.data.tryonClothes) { this.setNote('请先上传衣服图', C_ERR); return; }
      body = { person_video_data: this.data.tryonPersonVideo, clothes_data: this.data.tryonClothes };
    } else { // video_bg
      if (!this.data.tryonPersonVideo) { this.setNote('请先上传人物视频', C_ERR); return; }
      if (!this.data.tryonBg) { this.setNote('请先上传背景图', C_ERR); return; }
      body = { person_video_data: this.data.tryonPersonVideo, background_data: this.data.tryonBg };
    }
    this.submitJob('/api/gen/tryon', body, TRYON_COST_SINGLE);
  },

  // ===== 统一任务方法 =====
  setNote(t, c) { this.setData({ note: t, noteColor: c || C_MUTED }); },
  _validJobId(value) {
    if (typeof value === 'number') return Number.isFinite(value) && value > 0;
    return typeof value === 'string' && value.trim().length > 0;
  },

  submitJob(endpoint, body, cost) {
    if (this.data.busy || this._subscriptionPending) return;
    const need = (typeof cost === 'number') ? cost : this.data.cost;
    if (this.data.points !== null && this.data.points < need) {
      this.setNote('点数不足（需 ' + need + ' 点，当前 ' + this.data.points + ' 点）', C_ERR);
      return;
    }
    const submittedMode = this.data.mode;
    const submission = this._submissionDraftState(submittedMode);
    const lifecycleToken = this._lifecycleToken;
    this._subscriptionPending = true;
    this._requestWorkCompleteSubscription()
      .catch(() => {})
      .then(() => {
        if (lifecycleToken !== this._lifecycleToken) return;
        this._subscriptionPending = false;
        if (this.data.mode !== submittedMode) return;
        this._submitJobRequest(endpoint, body, cost, submittedMode, submission.localRevision, submission.storageRevision);
      });
  },

  _submitJobRequest(endpoint, body, cost, submittedMode, submittedLocalRevision, submittedStorageRevision) {
    if (this.data.busy) return;
    if (submittedMode && this.data.mode !== submittedMode) return;
    const mode = submittedMode || this.data.mode;
    const localRevision = typeof submittedLocalRevision === 'number' ? submittedLocalRevision : this._draftRevisionValue(mode);
    const storageRevision = submittedStorageRevision !== undefined ? submittedStorageRevision : drafts.getRevision(this._draftKey(mode));
    const need = (typeof cost === 'number') ? cost : this.data.cost;
    if (this.data.points !== null && this.data.points < need) {
      this.setNote('点数不足（需 ' + need + ' 点，当前 ' + this.data.points + ' 点）', C_ERR);
      return;
    }
    const token = ++this._pollToken; // 使旧轮询失效
    const t0 = Date.now();
    this.setData({ busy: true, videoUrl: '', cost: need });
    this.setNote('提交中…', C_INFO);

    const official = endpoint === '/api/gen/sora_video'
      || (endpoint === '/api/gen/xiaole_video' && (body.channel === 'micro' || body.channel === 'omni'));
    api.request(endpoint, {
      method: 'POST', data: body, timeout: 60000,
      idempotencyKey: official ? officialVideoRequestKey() : ''
    })
      .then((res) => {
        const current = token === this._pollToken;
        const d = res.data || {};
        const accepted = Number(res.statusCode) >= 200 && Number(res.statusCode) < 300
          && this._validJobId(d.job_id);
        if (accepted) {
          this._clearAcceptedDraft(mode, storageRevision, localRevision, current);
          if (!current) return;
          if (typeof d.cost === 'number') this.setData({ cost: d.cost });
          if (typeof d.points_left === 'number') this.setData({ points: d.points_left });
          this.startPolling(d.job_id, t0, token);
          return;
        }
        if (!current) return;
        if (res.statusCode === 401) { this.setData({ busy: false }); return; }
        if (api.isMembershipRequired(res)) { this.setData({ busy: false, note: '' }); return; }
        if (res.statusCode === 402) {
          this.setData({ busy: false });
          this.setNote('点数不足' + (d.need ? '（需 ' + d.need + ' 点）' : ''), C_ERR);
          return;
        }
        if (res.statusCode === 403) { this.setData({ busy: false }); this.setNote('请先在网页端修改初始密码后再使用', C_ERR); return; }
        if (res.statusCode === 429) { this.setData({ busy: false }); this.setNote(d.detail || '排队任务过多，请稍后再试', C_ERR); return; }
        if (res.statusCode === 400) { this.setData({ busy: false }); this.setNote('提交失败：' + (d.detail || '参数有误'), C_ERR); return; }
        if (res.statusCode === 503) { this.setData({ busy: false }); this.setNote(d.detail || '该功能暂未开放', C_ERR); return; }
        if (!(Number(res.statusCode) >= 200 && Number(res.statusCode) < 300)) {
          this.setData({ busy: false }); this.setNote('提交失败：' + (d.detail || '服务异常'), C_ERR); return;
        }
        if (!this._validJobId(d.job_id)) { this.setData({ busy: false }); this.setNote('提交失败：' + (d.detail || '任务编号无效'), C_ERR); return; }
      })
      .catch(() => {
        // POST 网络异常：服务端可能已建任务，绝不自动重试、不判失败、不承诺退款
        if (token !== this._pollToken) return;
        this.setData({ busy: false });
        this.setNote('提交结果暂未确认，请先到「历史作品」查看，避免重复提交', C_INFO);
        this.refreshPoints();
      });
  },

  startPolling(jobId, t0, token) {
    const tick = () => {
      if (token !== this._pollToken) return; // 过期轮询
      api.request('/api/gen/job/' + jobId, { method: 'GET' })
        .then((res) => {
          if (token !== this._pollToken) return;
          const d = res.data || {};
          const sec = Math.round((Date.now() - t0) / 1000);
          if (!d.status) { this.setData({ busy: false }); this.setNote('任务丢失，请重试', C_ERR); return; }
          if (d.status === 'done') { this.handleJobDone(d.result || {}, sec); }
          else if (d.status === 'error' || d.status === 'failed') { this.handleJobError(d); }
          else if (sec > POLL_TIMEOUT_SEC) {
            this.setData({ busy: false });
            this.setNote('仍在处理中，请稍后到「历史作品」查看（' + sec + 's）', C_INFO);
          } else {
            const label = PHASE_LABEL[d.phase] || PHASE_LABEL[d.status] || '生成中';
            this.setNote(label + '（' + sec + 's）· 视频较慢，请耐心等待', C_INFO);
            this._pollTimer = setTimeout(tick, POLL_INTERVAL);
          }
        })
        .catch(() => { if (token === this._pollToken) this._pollTimer = setTimeout(tick, POLL_INTERVAL); });
    };
    this._pollTimer = setTimeout(tick, POLL_INTERVAL);
  },

  handleJobDone(result, sec) {
    this.setNote('✅ 视频生成完成（' + sec + 's）', C_OK);
    this.refreshPoints();
    const url = api.absUrl(result.video_url || result.url || '');
    // /api/gen/file/ 受保护视频：<video> 带不了 Authorization，先带 token 下到本地再播
    if (url && url.indexOf('/api/gen/file/') !== -1) {
      api.downloadProtected(url)
        .then((tmp) => this.setData({ busy: false, videoUrl: tmp }))
        .catch(() => { this.setData({ busy: false, videoUrl: url }); this.setNote('视频加载失败，可稍后到「历史作品」查看', C_ERR); });
    } else {
      this.setData({ busy: false, videoUrl: url });
    }
  },
  handleJobError(d) {
    this.setData({ busy: false });
    // 只有后端给出明确退款证据才承诺"已退点"
    const refunded = d.refunded === true || d.refund === true ||
      (typeof d.points_refunded === 'number' && d.points_refunded > 0);
    const tail = refunded ? ' · 已退点' : ' · 点数状态请到「我的-点数明细」确认';
    this.setNote('失败：' + (d.error || d.detail || 'error') + tail, C_ERR);
    this.refreshPoints();
  },
  stopPolling() {
    if (this._pollTimer) { clearTimeout(this._pollTimer); this._pollTimer = null; }
    this._pollToken = (this._pollToken || 0) + 1; // 令任何在途轮询失效
  },

  saveVideo() {
    const u = this.data.videoUrl;
    if (!u) return;
    wx.showLoading({ title: '保存中', mask: true });
    const save = (fp) => wx.saveVideoToPhotosAlbum({
      filePath: fp,
      success: () => { wx.hideLoading(); wx.showToast({ title: '已保存到相册' }); },
      fail: () => { wx.hideLoading(); wx.showToast({ title: '未授权或保存失败', icon: 'none' }); }
    });
    // videoUrl 可能已是本地临时文件（受保护视频下载后），直接保存；远程的带 token 下载
    if (u.indexOf('http') !== 0) { save(u); return; }
    api.downloadProtected(u)
      .then(save)
      .catch(() => { wx.hideLoading(); wx.showToast({ title: '下载失败', icon: 'none' }); });
  },

  previewVideo() {
    if (this.data.videoUrl) wx.previewMedia({ sources: [{ url: this.data.videoUrl, type: 'video' }] });
  },

  refreshPoints() {
    api.request('/api/auth/me', { method: 'GET' }).then((res) => {
      if (res.statusCode === 200 && res.data && res.data.user) {
        this.setData({ points: res.data.user.points });
      }
    }).catch(() => {});
  }
});
