const api = require('../../utils/api.js');
const promptTemplates = require('../../utils/prompt_templates.js');

// ===== 创作模式 =====
// 2026-07-13 交接调整：老「动作模仿」后端已下线（VALID_VIDEO_MODES 只剩 text/audio），代码已删。
// 2026-07-13 二次调整：后端 7-13 上线电影化身 duo/open、口播批量、果肉 xAI 官方线，
// 「AI 视频生成」「数字化 IP」入口放开（stable:true）；换装仍藏（SHOW_UNSTABLE）。
const SHOW_UNSTABLE = false;
const MODES_ALL = [
  { key: 'cinematic', name: '电影化身', desc: '动作模仿 / 开放式生成', ready: true, stable: true },
  { key: 'generate', name: 'AI 视频生成', desc: '文生 / 图生视频', ready: true, stable: true },
  { key: 'talking', name: '数字化 IP', desc: '形象 + 文案 + 音色', ready: true, stable: true },
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

// ===== AI 视频生成引擎（走 /api/gen/xiaole_video）=====
const ENGINES = [
  // 欧米连续多轮不可用，体验版先只开放当前稳定的果肉官方线。
  { key: 'grok', name: '果肉视频', desc: '文生/图生·写实', ref: true }
];
// 价格集中配置（后端返回 points_left/cost 为准，不散落魔法数字）
const ENGINE_COST = { micro: 30, omni: 30 }; // 豆姐/欧米固定 30；果肉走 xAI 动态计价见 _grokEstimate
// 果肉官方线：模型 × 分辨率 × 时长动态计价；参考图不额外收点。
const GROK_MODELS = [
  { k: 'grok-imagine-video', name: '标准 1.0', desc: '480p/720p' },
  { k: 'grok-imagine-video-1.5', name: '高清 1.5', desc: '最高 1080p' }
];
const GROK_PRICE = {
  'grok-imagine-video': { '480p': 10, '720p': 12 },
  'grok-imagine-video-1.5': { '480p': 15, '720p': 25, '1080p': 44 }
};
const GROK_DURATIONS = [5, 8, 10, 12, 15];  // 后端 1~15 秒任意整数，取常用档
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
  generate: '文生 / 图生视频，耗时约 1-6 分钟 · 点数以服务端返回为准，失败任务按服务端规则处理',
  talking: '数字化 IP，耗时约 3-9 分钟 · 批量最多 5 个形象共用一段文案 · 点数以服务端返回为准',
  tryon: '换装 / 换背景，耗时约数分钟 · 点数以服务端返回为准，失败任务按服务端规则处理'
};

const POLL_INTERVAL = 4000;
const POLL_TIMEOUT_SEC = 480; // 8 分钟：仅表示前端停止等待，不代表任务失败
const PHASE_LABEL = {
  queued: '排队中', xiaole_running: '生成中', running: '生成中', downloading: '下载中',
  files_saved: '已上传·排队中', motion_parameters_ready: '生成中', burning_subtitle: '合成字幕中', done: '完成'
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
    videoPromptTemplates: promptTemplates.VIDEO_TEMPLATES,
    videoPromptTemplateKey: 'product',
    videoTplSubject: '黄雀 AI 视觉服务',
    videoTplScene: '紫粉霓虹的未来空间',
    videoTplAction: '缓慢旋转展示核心亮点',
    videoTplStyle: '高级、真实、细腻的电影光影',
    promptUndo: '',
    canUndoPrompt: false,
    prompt: '',
    refImgs: [],       // data URL 数组（后端 reference_images 字符串数组，果肉最多 7 张）
    refPreviews: [],
    // 果肉官方线（xAI）参数：模型 / 分辨率 / 时长，动态计价
    grokModels: GROK_MODELS,
    grokModel: 'grok-imagine-video',
    grokResList: ['480p', '720p'],   // 1.5 另加 1080p（selectGrokModel 里切换）
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
    talkText: '',
    voices: [],
    voiceKey: '',
    voiceName: '',
    talkAudio: '',           // data URL 音频（audio 模式）
    talkAudioName: '',
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
    videoUrl: ''
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
    this._setMode(mode);
  },

  // base64 媒体的实例存储（不响应式）。数组与 data 里的预览数组下标一一对应。
  _resetB64() { this._b64 = { talkImg: '', talkAudio: '', editVideo: '', cineVideo: '', refImgs: [], cineRefVideos: [], cineRefImgs: [] }; },

  onShow() {
    if (!api.getToken()) { wx.reLaunch({ url: '/pages/login/login' }); return; }
    this.refreshPoints();
  },

  onUnload() {
    this.stopPolling();
    if (this._vp) { this._vp.destroy(); this._vp = null; }
  },

  // ===== 模式切换（停旧轮询、清结果、清表单，防污染）=====
  _setMode(mode) {
    this.stopPolling();
    const m = MODES.find((x) => x.key === mode) || MODES[0];
    const cost = mode === 'cinematic' ? 0
      : (mode === 'generate' ? this._genCost() : (mode === 'tryon' ? TRYON_COST_SINGLE : VIDEO_COST));
    const ratios = mode === 'cinematic' ? RATIOS_CINE : (mode === 'generate' ? RATIOS_GEN : RATIOS_VIDEO);
    this.setData({
      mode: m.key, modeReady: m.ready, modeName: m.name,
      ratios, ratio: '9:16',
      busy: false, note: '', noteColor: C_MUTED, defaultHint: HINTS[m.key] || '', videoUrl: '', cost,
      // 清各模式上传/输入，避免跨模式串数据
      prompt: '', promptUndo: '', canUndoPrompt: false, refImgs: [], refPreviews: [],
      cineVideo: '', cineVideoName: '', cineVideoDur: 0,
      cinePrompt: '', cineRefVideos: [], cineRefImgs: [], cineRefPreviews: [], cineEst: 30,
      talkImg: '', talkImgPreview: '', talkText: '', talkAudio: '', talkAudioName: '',
      talkBatch: false, batchItems: [], batchSelMap: {}, batchJobs: [],
      tryonPersonVideo: '', tryonPersonVideoName: '',
      tryonClothes: '', tryonClothesPreview: '', tryonBg: '', tryonBgPreview: ''
    });
    this._resetB64(); // 跨模式清 base64（含 batch_* 键），与上面清表单的 setData 同步
    if (mode === 'talking' && !this._voicesLoaded) this.fetchVoices();
    // 口播批量也要选形象，进口播模式同样拉形象列表
    if ((mode === 'cinematic' || mode === 'talking') && !this._avatarsLoaded) this.fetchAvatars();
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
  _genCost() {
    const d = this.data;
    if (d.engine !== 'grok') return ENGINE_COST[d.engine] || 30;
    return this._grokEstimate(d.grokModel, d.grokRes, d.grokDur, d.refPreviews.length > 0);
  },
  selectEngine(e) {
    const engine = e.currentTarget.dataset.k;
    const eng = ENGINES.find((x) => x.key === engine) || ENGINES[0];
    const patch = { engine, engineRef: eng.ref };
    if (!eng.ref) { this._b64.refImgs = []; patch.refPreviews = []; }
    this.setData(patch);
    this.setData({ cost: this._genCost() });
  },
  selectGrokModel(e) {
    const model = e.currentTarget.dataset.k;
    const resList = model === 'grok-imagine-video-1.5' ? ['480p', '720p', '1080p'] : ['480p', '720p'];
    const patch = { grokModel: model, grokResList: resList };
    // 1080p 只有 1.5 支持，切回 1.0 时收敛到 720p，避免 400
    if (resList.indexOf(this.data.grokRes) < 0) patch.grokRes = '720p';
    this.setData(patch);
    this.setData({ cost: this._genCost() });
  },
  selectGrokRes(e) {
    this.setData({ grokRes: e.currentTarget.dataset.v });
    this.setData({ cost: this._genCost() });
  },
  selectGrokDur(e) {
    this.setData({ grokDur: +e.currentTarget.dataset.v });
    this.setData({ cost: this._genCost() });
  },
  onPrompt(e) { this.setData({ prompt: e.detail.value }); },
  selectVideoPromptTemplate(e) { this.setData({ videoPromptTemplateKey: e.currentTarget.dataset.k }); },
  onVideoTemplateField(e) {
    const key = e.currentTarget.dataset.key;
    if (['videoTplSubject', 'videoTplScene', 'videoTplAction', 'videoTplStyle'].indexOf(key) < 0) return;
    const patch = {}; patch[key] = e.detail.value;
    this.setData(patch);
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
  },
  undoVideoPromptTemplate() {
    if (!this.data.canUndoPrompt) return;
    this.setData({ prompt: this.data.promptUndo, promptUndo: '', canUndoPrompt: false });
    this.setNote('已恢复套用前的画面描述', C_MUTED);
  },
  selectRatio(e) { this.setData({ ratio: e.currentTarget.dataset.v }); },
  chooseRef() {
    // 果肉图生视频：最多 7 张参考图（后端 XIAOLE_MAX_REF）。
    // reference_images 要「字符串数组」（dataURL/URL），服务端转存 COS 后喂上游
    const left = GEN_MAX_REF - this.data.refPreviews.length;
    if (left <= 0) { this.setNote('参考图最多 ' + GEN_MAX_REF + ' 张', C_ERR); return; }
    wx.chooseMedia({
      count: left, mediaType: ['image'], sizeType: ['compressed'], sourceType: ['album', 'camera'],
      success: (res) => {
        (res.tempFiles || []).forEach((f) => {
          this._readDataURL(f.tempFilePath, 'image/jpeg', (url) => {
            if (this.data.refPreviews.length >= GEN_MAX_REF) return;
            this._b64.refImgs.push(url); // base64 存实例属性，与 refPreviews 平行
            this.setData({ refPreviews: this.data.refPreviews.concat([f.tempFilePath]) });
            this.setData({ cost: this._genCost() }); // 参考图影响果肉 image_input 计价
          });
        });
      }
    });
  },
  removeRef(e) {
    const i = +e.currentTarget.dataset.i;
    this._b64.refImgs.splice(i, 1);
    const prevs = this.data.refPreviews.slice(); prevs.splice(i, 1);
    this.setData({ refPreviews: prevs });
    this.setData({ cost: this._genCost() });
  },
  clearRef() {
    this._b64.refImgs = [];
    this.setData({ refPreviews: [] });
    this.setData({ cost: this._genCost() });
  },

  // ===== 果肉官方视频编辑（xAI）=====
  selectGrokOp(e) {
    if (e.currentTarget.dataset.v === 'edit') {
      wx.showToast({ title: '果肉视频编辑维护中', icon: 'none' });
      return;
    }
    this.setData({ grokOp: 'generate' });
  },
  chooseEditVideo() {
    wx.chooseMedia({
      count: 1, mediaType: ['video'], sourceType: ['album'], maxDuration: 9,
      success: (res) => {
        const f = res.tempFiles[0];
        const dur = f.duration || 0;
        if (dur > 8.7) { this.setNote('参考视频最长 8.7 秒，请剪短后再上传', C_ERR); return; }
        if (f.size && f.size > 30 * 1024 * 1024) { this.setNote('视频过大（>30MB），请压缩后再上传', C_ERR); return; }
        this._readDataURL(f.tempFilePath, 'video/mp4', (url) => {
          if (url.indexOf('data:video/mp4') !== 0) { this.setNote('仅支持 MP4 格式的视频', C_ERR); return; }
          // 计价公式与后端 points.py 编辑分支保持一致（扣点以服务端返回为准，这里仅展示）
          const d = Math.max(0.1, Math.min(8.7, dur));
          const cost = Math.max(1, Math.ceil(d * (0.01 + 0.07) * 7.3 * 1.2 * 10));
          this._b64.editVideo = url;
          this.setData({ editVideoName: '已选视频 · ' + dur.toFixed(1) + ' 秒', editDuration: dur, editCost: cost });
        });
      }
    });
  },
  clearEditVideo() { this._b64.editVideo = ''; this.setData({ editVideoName: '', editDuration: 0, editCost: 0 }); },

  submitGenerate() {
    if (this.data.busy) return;
    const prompt = (this.data.prompt || '').trim();
    if (!prompt) { this.setNote('请先输入画面描述', C_ERR); return; }
    const meaningfulLength = Array.from(prompt).filter((ch) => /[\u3400-\u9fffa-zA-Z0-9]/.test(ch)).length;
    if (meaningfulLength < 5) {
      this.setNote('画面描述太短，请至少输入 5 个有效文字，例如“让人物缓慢跑起来”', C_ERR);
      return;
    }
    if (this.data.engine === 'grok' && this.data.grokOp === 'edit') {
      if (!this._b64.editVideo) { this.setNote('请先上传 MP4 参考视频', C_ERR); return; }
      const editBody = {
        channel: 'grok', prompt: prompt, operation: 'edit', model: 'grok-imagine-video',
        reference_video_data: this._b64.editVideo, source_duration: this.data.editDuration
      };
      this.submitJob('/api/gen/xiaole_video', editBody, this.data.editCost || 1);
      return;
    }
    const body = { channel: this.data.engine, prompt: prompt, ratio: this.data.ratio };
    if (this.data.engine === 'grok') {
      // 果肉官方线（xAI）：模型/分辨率/时长全量传给后端，动态计价
      body.model = this.data.grokModel;
      body.resolution = this.data.grokRes;
      body.duration = this.data.grokDur;
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
      if (!this.data.voiceKey && voices.length) { patch.voiceKey = voices[0].key; patch.voiceName = voices[0].name; }
      this.setData(patch);
    }).catch(() => {});
  },
  selectTalkMode(e) { this.setData({ talkMode: e.currentTarget.dataset.k, note: '' }); },
  chooseTalkImg() { this._chooseImage('image/jpeg', (url, prev) => { this._b64.talkImg = url; this.setData({ talkImgPreview: prev }); }); },
  clearTalkImg() { this._b64.talkImg = ''; this.setData({ talkImgPreview: '' }); },
  onTalkText(e) {
    const text = e.detail.value || '';
    this.setData({ talkText: text, cost: this._talkEstimate(text) });
  },

  _talkEstimate(text) {
    const seconds = Math.max(1, String(text || '').trim().length / 4);
    return Math.max(30, Math.ceil(seconds / 30) * 30);
  },
  selectVoice(e) {
    const key = e.currentTarget.dataset.k;
    const v = this.data.voices.find((x) => x.key === key);
    this.setData({ voiceKey: key, voiceName: v ? v.name : '' });
  },
  playVoice(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) { wx.showToast({ title: '暂无试听', icon: 'none' }); return; }
    if (!this._vp) { this._vp = wx.createInnerAudioContext(); }
    this._vp.stop(); this._vp.src = url; this._vp.play();
  },
  selectTalkRes(e) { this.setData({ talkRes: e.currentTarget.dataset.v }); },
  chooseTalkAudio() {
    wx.chooseMessageFile({
      count: 1, type: 'file', extension: ['mp3', 'wav', 'm4a'],
      success: (res) => {
        const f = res.tempFiles[0];
        const mime = this._ext2mime(f.name || f.path) || 'audio/mpeg';
        if (f.size && f.size > 20 * 1024 * 1024) { this.setNote('音频过大（>20MB）', C_ERR); return; }
        wx.getFileSystemManager().readFile({
          filePath: f.path, encoding: 'base64',
          success: (r) => { this._b64.talkAudio = 'data:' + mime + ';base64,' + r.data; this.setData({ talkAudioName: f.name || '已选择音频' }); },
          fail: () => this.setNote('音频读取失败，请重试', C_ERR)
        });
      }
    });
  },
  submitTalking() {
    if (this.data.busy) return;
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
      if (!this._b64.talkAudio) { this.setNote('请先选择口播音频', C_ERR); return; }
      body.audio_data = this._b64.talkAudio;
    }
    this.submitJob('/api/gen/video', body, VIDEO_COST);
  },

  // ===== 口播批量：一段文案 × 多个形象（2~5 个，后端 /api/gen/video/batch）=====
  toggleTalkBatch(e) {
    const on = e.currentTarget.dataset.v === 'batch';
    if (on === this.data.talkBatch) return;
    // 批量仅支持「文案+音色」（后端限制 mode=text）
    this.setData({ talkBatch: on, talkMode: 'text', note: '', videoUrl: '', batchJobs: [] });
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
    if (i >= 0) { items.splice(i, 1); this._setBatchItems(items); return; }
    if (items.length >= VIDEO_BATCH_MAX) { this.setNote('批量最多 ' + VIDEO_BATCH_MAX + ' 个形象', C_ERR); return; }
    const a = this.data.avatars.find((x) => x.id === id) || {};
    items.push({ kind: 'avatar', id, data: '', preview: a.image || '', label: a.name || ('形象 ' + id) });
    this._setBatchItems(items);
  },
  addBatchImage() {
    const left = VIDEO_BATCH_MAX - this.data.batchItems.length;
    if (left <= 0) { this.setNote('批量最多 ' + VIDEO_BATCH_MAX + ' 个形象', C_ERR); return; }
    wx.chooseMedia({
      count: left, mediaType: ['image'], sizeType: ['compressed'], sourceType: ['album', 'camera'],
      success: (res) => {
        (res.tempFiles || []).forEach((f) => {
          this._readDataURL(f.tempFilePath, 'image/jpeg', (url) => {
            const items = this.data.batchItems.slice();
            if (items.length >= VIDEO_BATCH_MAX) return;
            // 照片 base64 不进 setData，存 this._b64 里以稳定自增 bid 索引
            const bid = ++this._batchBid;
            this._b64['batch_' + bid] = url;
            items.push({ kind: 'image', id: 0, bid, preview: f.tempFilePath, label: '照片形象 ' + (items.length + 1) });
            this._setBatchItems(items);
          });
        });
      }
    });
  },
  removeBatchItem(e) {
    const items = this.data.batchItems.slice();
    const removed = items.splice(+e.currentTarget.dataset.i, 1)[0];
    if (removed && removed.kind === 'image' && removed.bid != null) delete this._b64['batch_' + removed.bid];
    this._setBatchItems(items);
  },
  submitTalkingBatch() {
    if (this.data.busy) return;
    const items = this.data.batchItems;
    if (items.length < 2) { this.setNote('批量出片请至少选择 2 个形象（同一形象不能重复）', C_ERR); return; }
    const text = (this.data.talkText || '').trim();
    if (!text) { this.setNote('请先输入口播文案', C_ERR); return; }
    if (!this.data.voiceKey) { this.setNote('请先选择音色', C_ERR); return; }
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
    const token = ++this._pollToken;
    const t0 = Date.now();
    this.setData({ busy: true, videoUrl: '', batchJobs: [], cost: need });
    this.setNote('批量提交中…', C_INFO);
    api.request('/api/gen/video/batch', { method: 'POST', data: body, timeout: 120000 })
      .then((res) => {
        if (token !== this._pollToken) return;
        const d = res.data || {};
        if (res.statusCode === 402) { this.setData({ busy: false }); this.setNote('点数不足' + (d.need ? '（需 ' + d.need + ' 点）' : ''), C_ERR); return; }
        if (res.statusCode === 429) { this.setData({ busy: false }); this.setNote(d.detail || '任务位不足，请稍后再试', C_ERR); return; }
        if (res.statusCode === 400) { this.setData({ busy: false }); this.setNote('提交失败：' + (d.detail || '参数有误'), C_ERR); return; }
        if (res.statusCode === 503) { this.setData({ busy: false }); this.setNote(d.detail || '该功能暂未开放', C_ERR); return; }
        const jobs = d.jobs || [];
        if (!jobs.length) { this.setData({ busy: false }); this.setNote('提交失败：' + (d.detail || '未知错误'), C_ERR); return; }
        if (typeof d.cost === 'number') this.setData({ cost: d.cost });
        if (typeof d.points_left === 'number') this.setData({ points: d.points_left });
        this.setData({
          batchJobs: jobs.map((j) => ({ jobId: j.job_id, label: j.label || ('形象 ' + j.index), status: 'pending', phase: '', url: '', statusText: '排队中' }))
        });
        this.setNote('已提交 ' + jobs.length + ' 条任务（共 ' + (d.cost || need) + ' 点）', C_INFO);
        this.startBatchPolling(t0, token);
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
  fetchAvatars() {
    api.request('/api/gen/video/avatars', { method: 'GET' }).then((res) => {
      const items = ((res.data && res.data.items) || []).map((a) => {
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
      if (!this.data.avatarIds.length && items.length) this._setAvatarIds([items[0].id]);
      // 形象图多为受保护 /api/gen/file/（<image> 带不了 Authorization，直连 401）。
      // 与 assets 页同方案：带 token 下到本地临时文件再显示（downloadProtected 自带缓存）
      items.forEach((a, i) => {
        if (a.protectedImage) {
          api.downloadProtected(a.protectedImage).then((tmp) => {
            this.setData({ ['avatars[' + i + '].image']: tmp });
          }).catch(() => {});
        }
      });
    }).catch(() => {});
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
    if (mode === 'motion') { this._setAvatarIds([id]); return; }
    const max = mode === 'duo' ? 2 : CINE_MAX_AVATARS;
    let ids = this.data.avatarIds.slice();
    const i = ids.indexOf(id);
    if (i >= 0) ids.splice(i, 1);
    else if (ids.length >= max) {
      this.setNote((mode === 'duo' ? '双人动作模仿正好选 2 个形象' : '开放式生成最多选 ' + max + ' 个形象'), C_ERR);
      return;
    } else ids.push(id);
    this._setAvatarIds(ids);
  },
  selectCineMode(e) {
    const k = e.currentTarget.dataset.k;
    if (k === this.data.cineMode) return;
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
  },
  onCinePrompt(e) { this.setData({ cinePrompt: e.detail.value }); },
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
        this._readDataURL(f.tempFilePath, 'video/mp4', (url) => {
          // base64 url 进 this._b64（与 data 里的 {name,dur} 下标平行），data 里不放 url
          this._b64.cineRefVideos.push(url);
          this.setData({ cineRefVideos: this.data.cineRefVideos.concat([{ name: '参考视频 · ' + dur + ' 秒', dur }]) });
          this.setData({ cineEst: this._cineEstimate() });
        });
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
  },
  // open 玩法：参考图与形象共用 9 张图额度（后端 cinematic_ref_budget）
  chooseCineRefImg() {
    const budget = Math.max(0, CINE_MAX_MEDIA_IMAGES - this.data.avatarIds.length);
    const left = budget - this.data.cineRefPreviews.length;
    if (left <= 0) { this.setNote('参考图最多 ' + budget + ' 张（与形象共用 9 张图额度）', C_ERR); return; }
    wx.chooseMedia({
      count: Math.min(left, 9), mediaType: ['image'], sizeType: ['compressed'], sourceType: ['album', 'camera'],
      success: (res) => {
        (res.tempFiles || []).forEach((f) => {
          this._readDataURL(f.tempFilePath, 'image/jpeg', (url) => {
            const b = Math.max(0, CINE_MAX_MEDIA_IMAGES - this.data.avatarIds.length);
            if (this.data.cineRefPreviews.length >= b) return;
            this._b64.cineRefImgs.push(url); // base64 存实例属性，与 cineRefPreviews 平行
            this.setData({ cineRefPreviews: this.data.cineRefPreviews.concat([f.tempFilePath]) });
          });
        });
      }
    });
  },
  removeCineRefImg(e) {
    const i = +e.currentTarget.dataset.i;
    this._b64.cineRefImgs.splice(i, 1);
    const prevs = this.data.cineRefPreviews.slice(); prevs.splice(i, 1);
    this.setData({ cineRefPreviews: prevs });
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
        this._readDataURL(f.tempFilePath, 'video/mp4', (url) => {
          this._b64.cineVideo = url;
          this.setData({ cineVideoName: '已选视频 · ' + dur + ' 秒', cineVideoDur: dur });
          this.setData({ cineEst: this._cineEstimate() });
        });
      }
    });
  },
  clearCineVideo() {
    this._b64.cineVideo = '';
    this.setData({ cineVideoName: '', cineVideoDur: 0 });
    this.setData({ cineEst: this._cineEstimate() });
  },
  selectCineRes(e) { this.setData({ cineRes: e.currentTarget.dataset.v }); },
  selectCineDur(e) {
    const v = e.currentTarget.dataset.v;
    this.setData({ cineDur: v === 'auto' ? 'auto' : +v });
    this.setData({ cineEst: this._cineEstimate() });
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

  submitJob(endpoint, body, cost) {
    if (this.data.busy) return;
    const need = (typeof cost === 'number') ? cost : this.data.cost;
    if (this.data.points !== null && this.data.points < need) {
      this.setNote('点数不足（需 ' + need + ' 点，当前 ' + this.data.points + ' 点）', C_ERR);
      return;
    }
    const token = ++this._pollToken; // 使旧轮询失效
    const t0 = Date.now();
    this.setData({ busy: true, videoUrl: '', cost: need });
    this.setNote('提交中…', C_INFO);

    api.request(endpoint, { method: 'POST', data: body, timeout: 60000 })
      .then((res) => {
        if (token !== this._pollToken) return; // 已切模式
        const d = res.data || {};
        if (res.statusCode === 401) { this.setData({ busy: false }); return; }
        if (res.statusCode === 402) {
          this.setData({ busy: false });
          this.setNote('点数不足' + (d.need ? '（需 ' + d.need + ' 点）' : ''), C_ERR);
          return;
        }
        if (res.statusCode === 403) { this.setData({ busy: false }); this.setNote('请先在网页端修改初始密码后再使用', C_ERR); return; }
        if (res.statusCode === 429) { this.setData({ busy: false }); this.setNote(d.detail || '排队任务过多，请稍后再试', C_ERR); return; }
        if (res.statusCode === 400) { this.setData({ busy: false }); this.setNote('提交失败：' + (d.detail || '参数有误'), C_ERR); return; }
        if (res.statusCode === 503) { this.setData({ busy: false }); this.setNote(d.detail || '该功能暂未开放', C_ERR); return; }
        if (!d.job_id) { this.setData({ busy: false }); this.setNote('提交失败：' + (d.detail || '未知错误'), C_ERR); return; }
        // 服务端确认的真实成本 + 余额
        if (typeof d.cost === 'number') this.setData({ cost: d.cost });
        if (typeof d.points_left === 'number') this.setData({ points: d.points_left });
        this.startPolling(d.job_id, t0, token);
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
