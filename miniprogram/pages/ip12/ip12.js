const api = require('../../utils/api.js');
const ip12 = require('../../utils/ip12.js');

function candidateList(value) {
  return (Array.isArray(value) ? value : []).map((item) => {
    if (typeof item === 'string') return { title: 'IP 候选', copy: item };
    return Object.assign({}, item, { copy: item.one_liner || item.description || item.summary || item.positioning || JSON.stringify(item) });
  });
}

Page({
  data: {
    project: null,
    projectId: '',
    revision: 0,
    status: '',
    answer: '',
    modules: ip12.modules(0),
    completedSteps: 0,
    progressPercent: 0,
    selectedFiles: [],
    consent: false,
    busy: false,
    note: '',
    analysis: null,
    candidates: [],
    sourceEvidence: [],
    gaps: [],
    conflicts: [],
    imagePlan: [],
    videoPlan: [],
    nextSteps: [],
    confirmed: null,
    canPrefill: false,
    imagePrompt: '',
    videoPrompt: ''
  },

  onLoad() { this._files = []; },
  onShow() {
    if (!api.getToken()) { wx.reLaunch({ url: api.loginUrl('/pages/ip12/ip12') }); return; }
    api.request('/api/auth/me', { method: 'GET' }).then((res) => {
      if (res.statusCode !== 200 || !res.data || !res.data.user) { this.setData({ note: '暂时无法核验账号权益，请稍后重试' }); return; }
      if (res.data.membership_enforcement_enabled && !res.data.user.membership_active) {
        api.showMembershipRequired('请先开通会员后再使用数字化 IP AI 分析。');
        this.setData({ note: '需要有效会员才能进入数字化 IP AI 分析。' });
        return;
      }
      this.loadProject();
    }).catch(() => this.setData({ note: '网络错误，暂时无法核验账号权益' }));
  },
  onPullDownRefresh() {
    this.loadProject().then(() => wx.stopPullDownRefresh());
  },

  loadProject() {
    return api.request('/api/gen/digital-ip/projects', { method: 'GET' }).then((res) => {
      if (res.statusCode === 401) return;
      if (res.statusCode !== 200) { this.setData({ note: (res.data && res.data.detail) || '成长档案加载失败，请重试' }); return; }
      const projects = ip12.projectList(res.data);
      if (projects.length) this.applyProject(projects[0]);
      else this.createProject();
    }).catch(() => this.setData({ note: '网络错误，暂时无法加载成长档案' }));
  },

  createProject() {
    return api.request('/api/gen/digital-ip/projects', { method: 'POST', data: { title: '我的数字化 IP' } }).then((res) => {
      if (res.statusCode === 401) return;
      if (res.statusCode === 200 || res.statusCode === 201) this.applyProject(res.data && (res.data.project || res.data));
      else this.setData({ note: (res.data && res.data.detail) || '创建成长档案失败，请重试' });
    }).catch(() => this.setData({ note: '网络错误，暂时无法创建成长档案' }));
  },

  applyProject(project) {
    if (!project || !project.id) { this.setData({ note: '服务返回的成长档案不完整' }); return; }
    const state = project.state || {};
    const questionnaire = state.questionnaire_state || {};
    const lastAnalysis = project.last_analysis || {};
    const answer = ip12.currentAnswer(questionnaire, lastAnalysis);
    const completed = ip12.confirmedStepCount(questionnaire, project.status);
    const analysis = ip12.analysisFromProject(project);
    const candidates = analysis && (analysis.positioning_candidates || analysis.candidates) || [];
    const confirmed = project.confirmed_profile || state.confirmed_profile || null;
    const canPrefill = project.status === 'confirmed' && !!confirmed;
    const plans = canPrefill ? (project.confirmed_plans || state.confirmed_plans || {}) : {};
    const image = ip12.planView(plans.image_plan || project.image_plan || state.image_plan || (analysis && analysis.image_plan), 'image');
    const video = ip12.planView(plans.video_plan || project.video_plan || state.video_plan || (analysis && analysis.video_plan), 'video');
    this._questionnaire = questionnaire;
    this.setData({
      project, projectId: project.id, revision: project.revision || 0, status: project.status || '', answer,
      completedSteps: completed, progressPercent: completed * 100 / 54, modules: ip12.modules(completed), analysis,
      candidates: candidates.length === 3 ? candidateList(candidates) : [],
      sourceEvidence: ip12.evidenceList(analysis && analysis.source_evidence), gaps: ip12.textList(analysis && analysis.gaps),
      conflicts: ip12.textList(analysis && analysis.conflicts), imagePlan: image.lines, videoPlan: video.lines,
      imagePrompt: image.prompt, videoPrompt: video.prompt, nextSteps: ip12.textList(analysis && analysis.next_steps),
      confirmed, canPrefill, note: candidates.length && candidates.length !== 3 ? '服务返回候选数量异常，暂不显示确认入口。' : ''
    });
  },

  onAnswer(e) {
    const answer = e.detail.value;
    const analyzed = this.data.project && this.data.project.last_analysis && this.data.project.last_analysis.input;
    const changed = analyzed && String(analyzed.answer || '').trim() !== String(answer || '').trim();
    this.setData(Object.assign({ answer }, changed ? { candidates: [], canPrefill: false, note: '回答已修改，请保存并重新分析后再确认。' } : {}));
  },
  onConsent(e) { this.setData({ consent: ((e.detail && e.detail.value) || []).indexOf('accepted') !== -1 }); },

  saveDraft() {
    if (!this.data.projectId || this.data.busy) return;
    const answer = (this.data.answer || '').trim();
    this.setData({ busy: true, note: '' });
    const state = Object.assign({}, (this.data.project && this.data.project.state) || {}, {
      questionnaire_state: ip12.mergeQuestionnaire(this._questionnaire, answer, false)
    });
    this.updateProject(state).then((project) => {
      if (project) { this.applyProject(project); this.setData({ note: '已保存到成长档案' }); }
    }).finally(() => this.setData({ busy: false }));
  },

  projectFromResponse(data, extraState) {
    if (data && data.project) {
      const project = data.project;
      if (project.last_analysis || !data.analysis) return project;
      return Object.assign({}, project, { last_analysis: { analysis: data.analysis, model: data.model, created_at: data.created_at } });
    }
    if (data && data.id) return data;
    const current = this.data.project || {};
    return Object.assign({}, current, {
      revision: (data && data.revision) || current.revision,
      state: Object.assign({}, current.state || {}, extraState || {}, data && data.state ? data.state : {})
    });
  },

  updateProject(state) {
    return api.request('/api/gen/digital-ip/projects/' + encodeURIComponent(this.data.projectId), {
      method: 'PATCH', data: { revision: this.data.revision, state }
    }).then((res) => {
      if (res.statusCode === 401) return null;
      if (res.statusCode === 409) { this.setData({ note: '档案已在其他位置更新，已重新加载最新内容。' }); this.loadProject(); return null; }
      if (res.statusCode !== 200) { this.setData({ note: (res.data && res.data.detail) || '保存失败，请重试' }); return null; }
      return res.data && (res.data.project || res.data);
    }).catch(() => { this.setData({ note: '网络错误，草稿仍保留在当前页面' }); return null; });
  },

  chooseFiles() {
    const remaining = ip12.MAX_FILES - this._files.length;
    if (remaining <= 0) { wx.showToast({ title: '最多选择 6 份资料', icon: 'none' }); return; }
    wx.chooseMessageFile({ count: remaining, type: 'all', extension: ip12.ALLOWED_EXTENSIONS, success: (result) => {
      const incoming = (result.tempFiles || []).filter(ip12.isAllowedFile);
      const total = this._files.reduce((sum, item) => sum + item.size, 0) + incoming.reduce((sum, item) => sum + Number(item.size || 0), 0);
      if (incoming.length !== (result.tempFiles || []).length) { wx.showToast({ title: '含不支持的文件类型', icon: 'none' }); return; }
      if (incoming.some((file) => !ip12.isWithinFileLimit(file))) { wx.showToast({ title: '每份资料不能超过 8 MiB', icon: 'none' }); return; }
      if (total > ip12.MAX_BYTES) { wx.showToast({ title: '资料总大小不能超过 20 MiB', icon: 'none' }); return; }
      this._files = this._files.concat(incoming);
      this.setData({ selectedFiles: this._files.map((file) => ({ name: file.name, sizeText: ip12.formatBytes(file.size) })) });
    } });
  },
  removeFile(e) {
    const index = Number(e.currentTarget.dataset.index);
    this._files.splice(index, 1);
    this.setData({ selectedFiles: this._files.map((file) => ({ name: file.name, sizeText: ip12.formatBytes(file.size) })) });
  },
  readFiles() {
    return Promise.all(this._files.map((file) => new Promise((resolve, reject) => {
      wx.getFileSystemManager().readFile({ filePath: file.path, encoding: 'base64', success: (result) => {
        const mime = ip12.mimeType(file.name);
        resolve({ name: file.name, type: mime, data_url: 'data:' + mime + ';base64,' + result.data });
      }, fail: reject });
    })));
  },

  analyze() {
    if (!this.data.projectId || this.data.busy) return;
    const answer = (this.data.answer || '').trim();
    if (!answer) { this.setData({ note: '请先完成模块 1 的第一题' }); return; }
    if (!this.data.consent) { this.setData({ note: '请先勾选同意将资料发送给 AI 分析' }); return; }
    this.setData({ busy: true, note: '' });
    const draftState = Object.assign({}, (this.data.project && this.data.project.state) || {}, {
      questionnaire_state: ip12.mergeQuestionnaire(this._questionnaire, answer, false)
    });
    this.updateProject(draftState).then((savedProject) => {
      if (!savedProject) throw new Error('草稿保存失败，请重试');
      this.applyProject(savedProject);
      return this.readFiles();
    }).then((files) => api.request('/api/gen/digital-ip/projects/' + encodeURIComponent(this.data.projectId) + '/analyze', {
      method: 'POST', timeout: 150000, data: {
        revision: this.data.revision, module_index: ip12.FIRST_MODULE_INDEX, step_index: ip12.FIRST_STEP_INDEX, answer,
        context: ip12.analysisContext(this._questionnaire), files, consent: true
      }
    })).then((res) => {
      if (!res || res.statusCode === 401) return;
      if (res.statusCode === 409) { this.setData({ note: '档案版本已更新，正在恢复最新内容。' }); this.loadProject(); return; }
      if (res.statusCode !== 200) { this.setData({ note: (res.data && res.data.detail) || 'AI 分析失败，草稿仍可继续保存' }); return; }
      this.applyProject(this.projectFromResponse(res.data, { last_analysis: res.data }));
      this.setData({ note: 'AI 分析已完成，请从 3 个候选中确认一个。' });
    }).catch(() => this.setData({ note: '网络错误，草稿仍显示；可稍后重新分析。' })).finally(() => {
      this._files = []; // base64 仅在请求期间存在，不进入 data 或本地存储。
      this.setData({ selectedFiles: [], busy: false });
    });
  },

  confirmCandidate(e) {
    if (this.data.busy) return;
    const candidateIndex = Number(e.currentTarget.dataset.index);
    const answer = (this.data.answer || '').trim();
    this.setData({ busy: true, note: '' });
    const draftState = Object.assign({}, (this.data.project && this.data.project.state) || {}, {
      questionnaire_state: ip12.mergeQuestionnaire(this._questionnaire, answer, false)
    });
    this.updateProject(draftState).then((savedProject) => {
      if (!savedProject) throw new Error('草稿保存失败，请重试');
      this.applyProject(savedProject);
      return api.request('/api/gen/digital-ip/projects/' + encodeURIComponent(this.data.projectId) + '/confirm', {
      method: 'POST', data: { revision: this.data.revision, candidate_index: candidateIndex }
      });
    }).then((res) => {
      if (!res) return;
      if (res.statusCode === 401) return;
      if (res.statusCode === 409) { this.setData({ note: '档案版本已更新，正在恢复最新内容。' }); this.loadProject(); return; }
      if (res.statusCode !== 200) { this.setData({ note: (res.data && res.data.detail) || '确认失败，请重试' }); return; }
      const confirmedProject = this.projectFromResponse(res.data, { confirmed_profile: res.data && (res.data.confirmed_profile || res.data.confirmed) });
      this.applyProject(confirmedProject);
      const state = Object.assign({}, confirmedProject.state || {}, {
        questionnaire_state: ip12.mergeQuestionnaire(this._questionnaire, this.data.answer, true, candidateIndex)
      });
      return this.updateProject(state).then((savedProject) => {
        if (savedProject) this.applyProject(savedProject);
        this.setData({ note: '已确认 IP 候选，可按下方行动计划继续创作。' });
      });
    }).catch((error) => this.setData({ note: (error && error.message) || '网络错误，请重试确认' })).finally(() => this.setData({ busy: false }));
  },

  goImage() {
    if (!this.data.canPrefill) { wx.showToast({ title: '请先确认当前 IP 候选', icon: 'none' }); return; }
    wx.setStorageSync('hq_ip12_prefill_image', { prompt: this.data.imagePrompt });
    wx.navigateTo({ url: '/pages/banana/banana' });
  },
  goVideo() {
    if (!this.data.canPrefill) { wx.showToast({ title: '请先确认当前 IP 候选', icon: 'none' }); return; }
    wx.setStorageSync('hq_ip12_prefill_video', { prompt: this.data.videoPrompt });
    wx.navigateTo({ url: '/pages/video/video?mode=generate' });
  }
});
