'use strict';

const api = require('../../utils/api.js');
const ip12 = require('../../utils/ip12.js');

const PRODUCT_NAMES = {
  image_studio: '图片生成', script_studio: '文案编导', voice_studio: '音频创作',
  video_studio: '视频创作', workflow_canvas: '创作画布'
};

const WEBSITE_FEATURE_URLS = {
  workflow_canvas: 'https://huangquechuanmei.com/workbench/canvas.html'
};

function neutralMessage(value, fallback) {
  return String(value || fallback || '')
    .replace(/OpenAI/gi, 'AI 服务')
    .replace(/GPT(?:-[A-Za-z0-9.]+)*(?:\s+\d[A-Za-z0-9.-]*)?/gi, 'AI 服务')
    .replace(/Structured(?: Outputs?)?/gi, 'AI 服务')
    .replace(/(?:Claude|Anthropic|Gemini|Seedance|Doubao|Grok|Sora)(?:[-\s][A-Za-z0-9.]+)*/gi, 'AI 服务');
}

function neutralList(value) { return ip12.textList(value).map((item) => neutralMessage(item)); }

function candidateList(value, selectedIndex) {
  return (Array.isArray(value) ? value : []).map((item, index) => {
    const source = typeof item === 'string' ? { title: 'IP 候选', one_liner: item } : (item || {});
    return {
      index,
      title: neutralMessage(source.name || source.title, '方案 ' + (index + 1)),
      copy: neutralMessage(source.one_liner || source.description || source.summary || source.positioning || JSON.stringify(source)),
      selected: index === selectedIndex
    };
  });
}

function emptyAnalysisView() {
  return { analysis: null, candidates: [], sourceEvidence: [], gaps: [], conflicts: [], analysisNote: '' };
}

function questionnaireView(questionnaire, project) {
  const current = ip12.cursor(questionnaire.moduleIndex, questionnaire.stepIndex);
  const module = ip12.MODULES[current.moduleIndex];
  const step = module.steps[current.stepIndex];
  const answer = questionnaire.answers[ip12.keyFor(current.moduleIndex, current.stepIndex)] || {};
  const progress = ip12.progress(questionnaire);
  const options = (step.options || []).map((option, index) => ({
    index, label: option,
    selected: Array.isArray(answer.choice) ? answer.choice.indexOf(option) !== -1 : answer.choice === option
  }));
  return {
    moduleIndex: current.moduleIndex,
    stepIndex: current.stepIndex,
    moduleId: module.id,
    moduleName: module.name,
    modulePhase: module.phase,
    moduleDescription: module.desc,
    moduleOutput: module.output,
    stepTitle: step.title,
    stepInstruction: step.instruction,
    stepWhy: step.why,
    stepLabel: step.label || '',
    stepType: step.type,
    isText: step.type === 'text',
    isSingle: step.type === 'single',
    isMulti: step.type === 'multi',
    isReview: step.type === 'review',
    answerText: String(answer.text || ''),
    answerSkipped: answer.skipped === true,
    answerConfirmed: answer.confirmed === true,
    reviewItems: step.preview || [],
    options,
    hasExample: !!(step.sample || step.sampleChoice || step.type === 'review'),
    currentStepText: (current.stepIndex + 1) + ' / ' + module.steps.length,
    previousDisabled: current.moduleIndex === 0 && current.stepIndex === 0,
    finalStep: current.moduleIndex === ip12.MODULES.length - 1 && current.stepIndex === module.steps.length - 1,
    modules: ip12.moduleCards(questionnaire, current.moduleIndex),
    completedSteps: progress.progressed,
    confirmedSteps: progress.confirmed,
    skippedSteps: progress.skipped,
    unresolvedSteps: progress.unresolved,
    progressPercent: Math.round(progress.progressed * 100 / progress.total),
    skippedItems: progress.skippedItems,
    canGenerateReport: progress.unresolved === 0 && !!(project && project.id)
  };
}

function analysisView(project, questionnaire) {
  const record = project && project.last_analysis || {};
  const input = record.input || {};
  if (input.module_index !== questionnaire.moduleIndex || input.step_index !== questionnaire.stepIndex) return emptyAnalysisView();
  const analysis = record.analysis || {};
  const answer = questionnaire.answers[ip12.keyFor(questionnaire.moduleIndex, questionnaire.stepIndex)] || {};
  return {
    analysis,
    candidates: candidateList(analysis.positioning_candidates || analysis.candidates, answer.aiChoice),
    sourceEvidence: ip12.evidenceList(analysis.source_evidence).map((item) => neutralMessage(item)),
    gaps: neutralList(analysis.gaps),
    conflicts: neutralList(analysis.conflicts),
    analysisNote: neutralMessage(analysis.summary)
  };
}

function reportView(payload) {
  const envelope = payload && payload.report || {};
  const content = envelope.content || {};
  return {
    reportVisible: !!(envelope.report_id || content.title),
    reportStale: !!(payload && payload.stale),
    reportTitle: neutralMessage(content.title, 'IP12 产品方案报告'),
    reportSummary: neutralMessage(content.executive_summary),
    reportProgressText: '确认 ' + Number(envelope.progress && envelope.progress.confirmed || 0) +
      ' · 跳过 ' + Number(envelope.progress && envelope.progress.skipped || 0) +
      ' · 共 ' + Number(envelope.progress && envelope.progress.total || ip12.TOTAL_STEPS),
    reportEvidence: (content.evidence || []).map((item) => ({
      id: item.evidence_id || '', claim: neutralMessage(item.claim), excerpt: neutralMessage(item.source_excerpt), source: neutralMessage(item.source_ref)
    })),
    reportPains: (content.industry_pains || []).map((item, painIndex) => ({
      painIndex, pain: neutralMessage(item.pain), why: neutralMessage(item.why_it_matters), evidenceIds: item.evidence_ids || [],
      productMatches: (item.product_matches || []).map((match, matchIndex) => {
        const action = ip12.productAction(match.product_id);
        return {
          painIndex, matchIndex, productId: match.product_id || '',
          productName: PRODUCT_NAMES[match.product_id] || match.product_id || '黄雀产品',
          fitReason: neutralMessage(match.fit_reason), steps: neutralList(match.execution_steps),
          canOpen: !!action.type, actionType: action.type, actionLabel: action.label
        };
      })
    })),
    reportExecution: (content.execution_plan || []).map((item) => ({
      phase: neutralMessage(item.phase), goal: neutralMessage(item.goal), steps: neutralList(item.steps)
    })),
    reportMetrics: (content.metrics || []).map((item) => ({
      name: neutralMessage(item.name), definition: neutralMessage(item.definition), baseline: neutralMessage(item.baseline),
      target: neutralMessage(item.target), reviewCycle: neutralMessage(item.review_cycle), evidenceIds: item.evidence_ids || []
    })),
    reportGaps: (content.material_gaps || []).map((item) => ({
      gap: neutralMessage(item.gap), why: neutralMessage(item.why_needed), collect: neutralMessage(item.how_to_collect), blocking: !!item.blocking
    })),
    reportDisclaimer: neutralMessage(content.disclaimer, '报告仅供规划参考，不构成经营效果保证。')
  };
}

Page({
  data: Object.assign({
    project: null,
    projectId: '',
    revision: 0,
    status: '',
    modules: ip12.moduleCards({}, 0),
    moduleIndex: 0,
    stepIndex: 0,
    selectedFiles: [],
    analysisConsent: false,
    reportConsent: false,
    busy: false,
    note: '',
    analysisNote: '',
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
    videoPrompt: '',
    reportVisible: false,
    reportStale: false,
    reportTitle: '',
    reportSummary: '',
    reportProgressText: '',
    reportEvidence: [],
    reportPains: [],
    reportExecution: [],
    reportMetrics: [],
    reportGaps: [],
    reportDisclaimer: ''
  }, questionnaireView(ip12.normalizeQuestionnaire({}), null), emptyAnalysisView()),

  onLoad() {
    this._files = [];
    this._questionnaire = ip12.normalizeQuestionnaire({});
    this._project = null;
  },

  onShow() {
    if (!api.getToken()) { wx.reLaunch({ url: api.loginUrl('/pages/ip12/ip12') }); return; }
    api.request('/api/auth/me', { method: 'GET' }).then((res) => {
      if (res.statusCode !== 200 || !res.data || !res.data.user) {
        this.setData({ note: '暂时无法核验账号权益，请稍后重试' });
        return;
      }
      if (res.data.membership_enforcement_enabled && !res.data.user.membership_active) {
        api.showMembershipRequired('请先开通会员后再使用数字化 IP AI 分析。');
        this.setData({ note: '需要有效会员才能进入数字化 IP AI 分析。' });
        return;
      }
      this.loadProject().then(() => this.loadReport());
    }).catch(() => this.setData({ note: '网络错误，暂时无法核验账号权益' }));
  },

  onPullDownRefresh() {
    this.loadProject().then(() => this.loadReport()).finally(() => wx.stopPullDownRefresh());
  },

  loadProject() {
    return api.request('/api/gen/digital-ip/projects', { method: 'GET' }).then((res) => {
      if (res.statusCode === 401) return null;
      if (res.statusCode !== 200) throw new Error(neutralMessage(res.data && res.data.detail, '成长档案加载失败，请重试'));
      const projects = ip12.projectList(res.data);
      return projects.length ? this.applyProject(projects[0]) : this.createProject();
    }).catch((error) => {
      this.setData({ note: neutralMessage(error.message, '网络错误，暂时无法加载成长档案') });
      return null;
    });
  },

  createProject() {
    return api.request('/api/gen/digital-ip/projects', { method: 'POST', data: { title: '我的数字化 IP' } }).then((res) => {
      if (res.statusCode === 401) return null;
      if (res.statusCode !== 200 && res.statusCode !== 201) throw new Error(neutralMessage(res.data && res.data.detail, '创建成长档案失败，请重试'));
      return this.applyProject(res.data && (res.data.project || res.data));
    });
  },

  applyProject(project) {
    if (!project || !project.id) { this.setData({ note: '服务返回的成长档案不完整' }); return null; }
    const reportStale = !!(this.data.reportVisible && this._project &&
      Number(this._project.revision || 0) !== Number(project.revision || 0));
    const questionnaire = ip12.normalizeQuestionnaire(project.state && project.state.questionnaire_state);
    const rawConfirmed = project.confirmed_profile || null;
    const confirmed = rawConfirmed ? Object.assign({}, rawConfirmed, {
      name: neutralMessage(rawConfirmed.name),
      title: neutralMessage(rawConfirmed.title),
      summary: neutralMessage(rawConfirmed.summary)
    }) : null;
    const plans = project.confirmed_plans || {};
    const image = ip12.planView(plans.image_plan, 'image');
    const video = ip12.planView(plans.video_plan, 'video');
    this._project = project;
    this._questionnaire = questionnaire;
    this.setData(Object.assign({
      project,
      projectId: project.id,
      revision: Number(project.revision || 0),
      status: project.status || 'draft',
      confirmed,
      canPrefill: project.status === 'confirmed' && !!confirmed,
      imagePlan: image.lines.map((item) => neutralMessage(item)),
      videoPlan: video.lines.map((item) => neutralMessage(item)),
      imagePrompt: image.prompt,
      videoPrompt: video.prompt,
      nextSteps: neutralList(plans.next_steps),
      reportStale: reportStale || this.data.reportStale,
      note: ''
    }, questionnaireView(questionnaire, project), analysisView(project, questionnaire)));
    return project;
  },

  refreshLocal(questionnaire, note) {
    this._questionnaire = ip12.normalizeQuestionnaire(questionnaire);
    const view = questionnaireView(this._questionnaire, this._project);
    const input = this._project && this._project.last_analysis && this._project.last_analysis.input || {};
    const currentText = ip12.answerTextForStep(ip12.stepAt(view.moduleIndex, view.stepIndex),
      this._questionnaire.answers[ip12.keyFor(view.moduleIndex, view.stepIndex)]);
    const stale = input.module_index === view.moduleIndex && input.step_index === view.stepIndex &&
      String(input.answer || '').trim() !== String(currentText || '').trim();
    this.setData(Object.assign({}, view, stale ? emptyAnalysisView() : analysisView(this._project, this._questionnaire), {
      note: note || '',
      canPrefill: stale ? false : this.data.canPrefill
    }));
  },

  patchQuestionnaire(questionnaire) {
    if (!this._project) return Promise.reject(new Error('账号档案尚未加载'));
    return api.request('/api/gen/digital-ip/projects/' + encodeURIComponent(this._project.id), {
      method: 'PATCH',
      data: { revision: this._project.revision, state: { questionnaire_state: questionnaire } }
    }).then((res) => {
      if (res.statusCode === 409) {
        return this.loadProject().then(() => { throw new Error('项目已在另一端更新，已恢复云端最新内容'); });
      }
      if (res.statusCode !== 200) throw new Error(neutralMessage(res.data && res.data.detail, '项目保存失败，请重试'));
      return res.data && (res.data.project || res.data);
    });
  },

  onTextInput(e) {
    const q = ip12.editAnswer(this._questionnaire, this.data.moduleIndex, this.data.stepIndex, { text: e.detail.value });
    this.refreshLocal(q, this.data.answerConfirmed ? '已确认答案发生修改，确认状态已撤销。' : '');
  },

  onChoice(e) {
    const index = Number(e.currentTarget.dataset.index);
    const step = ip12.stepAt(this.data.moduleIndex, this.data.stepIndex);
    const option = step.options[index];
    const current = this._questionnaire.answers[ip12.keyFor(this.data.moduleIndex, this.data.stepIndex)] || {};
    let choice = option;
    if (step.type === 'multi') {
      choice = Array.isArray(current.choice) ? current.choice.slice() : [];
      const found = choice.indexOf(option);
      if (found === -1) choice.push(option); else choice.splice(found, 1);
    }
    const q = ip12.editAnswer(this._questionnaire, this.data.moduleIndex, this.data.stepIndex, { choice });
    this.refreshLocal(q, this.data.answerConfirmed ? '已确认答案发生修改，确认状态已撤销。' : '');
  },

  useExample() {
    const step = ip12.stepAt(this.data.moduleIndex, this.data.stepIndex);
    let patch = {};
    if (step.type === 'text') patch = { text: step.sample || '' };
    else if (step.type === 'single') patch = { choice: step.sampleChoice || '' };
    else if (step.type === 'multi') patch = { choice: (step.sampleChoice || []).slice() };
    else patch = { text: (step.preview || []).join('\n'), reviewed: true };
    this.refreshLocal(ip12.editAnswer(this._questionnaire, this.data.moduleIndex, this.data.stepIndex, patch), '已带入主站同一份示例，可继续修改。');
  },

  saveDraft() {
    if (this.data.busy) return;
    this.setData({ busy: true, note: '' });
    this.patchQuestionnaire(this._questionnaire).then((project) => {
      this.applyProject(project);
      this.setData({ note: '草稿已按 revision 保存到账号档案。' });
    }).catch((error) => this.setData({ note: neutralMessage(error.message, '保存失败，请重试') }))
      .finally(() => this.setData({ busy: false }));
  },

  moveTo(next, note) {
    if (this.data.busy) return Promise.resolve(null);
    const questionnaire = ip12.withCursor(this._questionnaire, next.moduleIndex, next.stepIndex);
    this.setData({ busy: true, note: '' });
    return this.patchQuestionnaire(questionnaire).then((project) => {
      this.applyProject(project);
      this.setData({ note: note || '' });
      return project;
    }).catch((error) => {
      this.setData({ note: neutralMessage(error.message, '导航保存失败，请重试') });
      return null;
    }).finally(() => this.setData({ busy: false }));
  },

  previousStep() {
    if (this.data.previousDisabled) return Promise.resolve(null);
    return this.moveTo(ip12.previousCursor(this.data.moduleIndex, this.data.stepIndex), '已回到上一题。');
  },

  jumpModule(e) {
    const moduleIndex = Number(e.currentTarget.dataset.index);
    return this.moveTo({ moduleIndex, stepIndex: 0 }, '已切换模块；未确认草稿也已同步。');
  },

  resumeSkipped(e) {
    return this.moveTo({
      moduleIndex: Number(e.currentTarget.dataset.module),
      stepIndex: Number(e.currentTarget.dataset.step)
    }, '已回到待补题；填写并确认即可回补。');
  },

  prepareReview(questionnaire) {
    const step = ip12.stepAt(this.data.moduleIndex, this.data.stepIndex);
    if (step.type !== 'review') return questionnaire;
    return ip12.editAnswer(questionnaire, this.data.moduleIndex, this.data.stepIndex, {
      text: (step.preview || []).join('\n'), reviewed: true
    });
  },

  confirmCurrent() {
    if (this.data.busy) return;
    let questionnaire = this.prepareReview(this._questionnaire);
    const step = ip12.stepAt(this.data.moduleIndex, this.data.stepIndex);
    const key = ip12.keyFor(this.data.moduleIndex, this.data.stepIndex);
    const answer = questionnaire.answers[key] || {};
    if (!ip12.answerReady(step, answer)) {
      this.setData({ note: step.type === 'text' ? '请先填写当前回答。' : '请先选择当前答案。' });
      return;
    }
    questionnaire = ip12.markConfirmed(questionnaire, this.data.moduleIndex, this.data.stepIndex);
    const next = ip12.nextCursor(this.data.moduleIndex, this.data.stepIndex);
    questionnaire = ip12.withCursor(questionnaire, next.moduleIndex, next.stepIndex);
    this.setData({ busy: true, note: '' });
    const wasFinalStep = this.data.finalStep;
    const confirmRequest = Number.isInteger(answer.aiChoice) && this.data.candidates.length === 3
      ? api.request('/api/gen/digital-ip/projects/' + encodeURIComponent(this._project.id) + '/confirm', {
        method: 'POST', data: { revision: this._project.revision, candidate_index: answer.aiChoice }
      }).then((res) => {
        if (res.statusCode === 409) throw new Error('候选已在另一端变化，请重新分析确认');
        if (res.statusCode !== 200) throw new Error(neutralMessage(res.data && res.data.detail, '候选确认失败'));
        this._project = res.data && (res.data.project || res.data);
      })
      : Promise.resolve();
    confirmRequest.then(() => this.patchQuestionnaire(questionnaire)).then((project) => {
      this.applyProject(project);
      this.setData({ note: wasFinalStep ? '全部 54 步已处理，可生成产品方案报告。' : '当前答案已确认并进入下一题。' });
    }).catch((error) => {
      if (/另一端/.test(error.message || '')) this.loadProject();
      this.setData({ note: neutralMessage(error.message, '确认失败，请重试') });
    }).finally(() => this.setData({ busy: false }));
  },

  skipCurrent() {
    if (this.data.busy) return;
    let questionnaire = ip12.markSkipped(this._questionnaire, this.data.moduleIndex, this.data.stepIndex);
    const next = ip12.nextCursor(this.data.moduleIndex, this.data.stepIndex);
    questionnaire = ip12.withCursor(questionnaire, next.moduleIndex, next.stepIndex);
    this.setData({ busy: true, note: '' });
    this.patchQuestionnaire(questionnaire).then((project) => {
      this.applyProject(project);
      this.setData({ note: '本题已标记待补；报告会把它列为资料缺口。' });
    }).catch((error) => this.setData({ note: neutralMessage(error.message, '跳过失败，请重试') }))
      .finally(() => this.setData({ busy: false }));
  },

  onAnalysisConsent(e) {
    this.setData({ analysisConsent: ((e.detail && e.detail.value) || []).indexOf('accepted') !== -1 });
  },

  chooseFiles() {
    const remaining = ip12.MAX_FILES - this._files.length;
    if (remaining <= 0) { wx.showToast({ title: '最多选择 6 份资料', icon: 'none' }); return; }
    wx.chooseMessageFile({ count: remaining, type: 'all', extension: ip12.ALLOWED_EXTENSIONS, success: (result) => {
      const incoming = (result.tempFiles || []).filter(ip12.isAllowedFile);
      const total = this._files.reduce((sum, item) => sum + Number(item.size || 0), 0) +
        incoming.reduce((sum, item) => sum + Number(item.size || 0), 0);
      if (incoming.length !== (result.tempFiles || []).length) { wx.showToast({ title: '含不支持的文件类型', icon: 'none' }); return; }
      if (incoming.some((file) => !ip12.isWithinFileLimit(file))) { wx.showToast({ title: '每份资料不能超过 8 MiB', icon: 'none' }); return; }
      if (total > ip12.MAX_BYTES) { wx.showToast({ title: '资料总大小不能超过 20 MiB', icon: 'none' }); return; }
      this._files = this._files.concat(incoming);
      this.setData({ selectedFiles: this._files.map((file) => ({ name: file.name, sizeText: ip12.formatBytes(file.size) })) });
    } });
  },

  removeFile(e) {
    this._files.splice(Number(e.currentTarget.dataset.index), 1);
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

  analyzeCurrent() {
    if (!this._project || this.data.busy) return;
    let questionnaire = this.prepareReview(this._questionnaire);
    const step = ip12.stepAt(this.data.moduleIndex, this.data.stepIndex);
    const answer = questionnaire.answers[ip12.keyFor(this.data.moduleIndex, this.data.stepIndex)] || {};
    const text = ip12.answerTextForStep(step, answer).trim();
    if (!text) { this.setData({ note: '请先填写或选择当前回答。' }); return; }
    if (!this.data.analysisConsent) { this.setData({ note: '请先明确同意将当前回答和所选资料发送给 AI。' }); return; }
    this._questionnaire = questionnaire;
    this.setData({ busy: true, note: '正在分析当前步骤，请不要重复提交。' });
    this.patchQuestionnaire(questionnaire).then((project) => {
      this._project = project;
      return this.readFiles();
    }).then((files) => api.request('/api/gen/digital-ip/projects/' + encodeURIComponent(this._project.id) + '/analyze', {
      method: 'POST', timeout: 150000, data: {
        revision: this._project.revision,
        module_index: this.data.moduleIndex,
        step_index: this.data.stepIndex,
        answer: text,
        context: ip12.analysisContext(questionnaire, this.data.moduleIndex, this.data.stepIndex),
        files,
        consent: true
      }
    })).then((res) => {
      if (!res || res.statusCode === 401) return;
      if (res.statusCode === 409) { this.loadProject(); throw new Error('项目已更新，请重新发起分析'); }
      if (res.statusCode !== 200) throw new Error(neutralMessage(res.data && res.data.detail, 'AI 分析失败'));
      this.applyProject(res.data && (res.data.project || res.data));
      this.setData({ note: 'AI 已返回 3 个候选；请选择一个，再点击确认当前题。' });
    }).catch((error) => this.setData({ note: neutralMessage(error.message, '网络错误，暂时无法分析') }))
      .finally(() => {
        this._files = [];
        this.setData({ selectedFiles: [], analysisConsent: false, busy: false });
      });
  },

  selectCandidate(e) {
    const index = Number(e.currentTarget.dataset.index);
    const questionnaire = ip12.setAiChoice(this._questionnaire, this.data.moduleIndex, this.data.stepIndex, index);
    this._questionnaire = questionnaire;
    this.setData(Object.assign({}, questionnaireView(questionnaire, this._project), analysisView(this._project, questionnaire), {
      note: '候选已选择；点击“确认并下一题”后才写入已确认档案。'
    }));
  },

  goImage() {
    if (!this.data.canPrefill || !this.data.imagePrompt) { wx.showToast({ title: '当前没有已确认的图片计划', icon: 'none' }); return; }
    wx.setStorageSync('hq_ip12_prefill_image', { prompt: this.data.imagePrompt });
    wx.navigateTo({ url: '/pages/banana/banana' });
  },

  goVideo() {
    if (!this.data.canPrefill || !this.data.videoPrompt) { wx.showToast({ title: '当前没有已确认的视频计划', icon: 'none' }); return; }
    wx.setStorageSync('hq_ip12_prefill_video', { prompt: this.data.videoPrompt });
    wx.navigateTo({ url: '/pages/video/video?mode=generate' });
  },

  onReportConsent(e) {
    this.setData({ reportConsent: ((e.detail && e.detail.value) || []).indexOf('accepted') !== -1 });
  },

  loadReport() {
    if (!this._project) return Promise.resolve(null);
    return api.request('/api/gen/digital-ip/projects/' + encodeURIComponent(this._project.id) + '/report', {
      method: 'GET'
    }).then((res) => {
      if (res.statusCode === 200) this.setData(reportView(res.data));
      else if (res.statusCode !== 404 && res.statusCode !== 401) this.setData({ note: neutralMessage(res.data && res.data.detail, '报告恢复失败') });
      return res;
    }).catch(() => null);
  },

  generateReport() {
    if (!this._project || this.data.busy) return;
    if (!this.data.canGenerateReport) { this.setData({ note: '请先确认或跳过全部 54 步。' }); return; }
    if (!this.data.reportConsent) { this.setData({ note: '请先明确同意将已保存回答发送给 AI 服务生成报告。' }); return; }
    this.setData({ busy: true, note: '正在生成产品方案报告，请不要重复提交。' });
    api.request('/api/gen/digital-ip/projects/' + encodeURIComponent(this._project.id) + '/report', {
      method: 'POST', timeout: 150000, data: { revision: this._project.revision, consent: true }
    }).then((res) => {
      if (res.statusCode === 409) { this.loadProject(); throw new Error('项目已更新，请重新确认报告内容'); }
      if (res.statusCode !== 200) throw new Error(neutralMessage(res.data && res.data.detail, '报告生成失败'));
      const payload = res.data || {};
      this.applyProject(payload.project);
      this.setData(Object.assign({}, reportView(payload), { note: '报告已保存到当前项目，可跨端恢复。' }));
    }).catch((error) => this.setData({ note: neutralMessage(error.message, '报告生成失败，请稍后重试') }))
      .finally(() => this.setData({ busy: false, reportConsent: false }));
  },

  openReportProduct(e) {
    const pain = this.data.reportPains[Number(e.currentTarget.dataset.pain)];
    const match = pain && pain.productMatches[Number(e.currentTarget.dataset.match)];
    if (!pain || !match || !match.canOpen) return;
    const prompt = ip12.productPrompt(pain.pain, {
      fit_reason: match.fitReason,
      execution_steps: match.steps
    });
    if (match.actionType === 'image') {
      wx.setStorageSync('hq_ip12_prefill_image', { prompt });
      wx.navigateTo({ url: '/pages/banana/banana' });
    } else if (match.actionType === 'video') {
      wx.setStorageSync('hq_ip12_prefill_video', { prompt });
      wx.navigateTo({ url: '/pages/video/video?mode=generate' });
    } else if (match.actionType === 'script') {
      wx.setStorageSync('hq_ip12_prefill_script', { prompt });
      wx.navigateTo({ url: '/pages/video/video?mode=talking' });
    } else if (match.actionType === 'audio') {
      wx.setStorageSync('hq_ip12_prefill_audio', { text: prompt });
      wx.navigateTo({ url: '/pages/audio/audio' });
    } else if (match.actionType === 'website') {
      wx.setClipboardData({
        data: WEBSITE_FEATURE_URLS[match.productId] || 'https://huangquechuanmei.com/workbench',
        success: () => wx.showToast({ title: '网站功能地址已复制', icon: 'none' })
      });
    }
  },

  reportView
});
