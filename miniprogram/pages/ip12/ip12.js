'use strict';

const api = require('../../utils/api.js');
const ip12 = require('../../utils/ip12.js');

function neutralMessage(value, fallback) {
  return String(value || fallback || '')
    .replace(/OpenAI/gi, 'AI 服务')
    .replace(/GPT(?:-[A-Za-z0-9.]+)*(?:\s+\d[A-Za-z0-9.-]*)?/gi, 'AI 服务')
    .replace(/Structured(?: Outputs?)?/gi, 'AI 服务')
    .replace(/(?:Claude|Anthropic|Gemini|Seedance|Doubao|Grok|Sora)(?:[-\s][A-Za-z0-9.]+)*/gi, 'AI 服务');
}

function neutralList(value) { return ip12.textList(value).map((item) => neutralMessage(item)); }

function normalizedGuideTurns(questionnaire) {
  return (Array.isArray(questionnaire.guideTurns) ? questionnaire.guideTurns : []).filter(Boolean).map((turn) => {
    const normalized = Object.assign({}, turn, {
      suggested_answer: String(turn.suggested_answer || turn.suggestedAnswer || '')
    });
    delete normalized.suggestedAnswer;
    return normalized;
  });
}

function guideView(questionnaire, moduleIndex, stepIndex) {
  const stepKey = ip12.keyFor(moduleIndex, stepIndex);
  const allTurns = normalizedGuideTurns(questionnaire);
  let previousStepKey = '';
  const turns = allTurns
    .filter((turn) => turn && ip12.MODULES[Number(String(turn.stepKey || '').split('-')[0])])
    .slice(-24)
    .map((turn) => {
      const parts = String(turn.stepKey || '').split('-').map(Number);
      const module = ip12.MODULES[parts[0]];
      const step = module && module.steps[parts[1]];
      const showStep = turn.stepKey !== previousStepKey;
      previousStepKey = turn.stepKey;
      return {
        role: turn.role === 'assistant' ? 'assistant' : 'user',
        content: neutralMessage(turn.content),
        stepLabel: showStep && step ? '模块 ' + module.id + ' · ' + step.title : ''
      };
    });
  return {
    guideTurns: turns,
    currentStepHasTurns: allTurns.some((turn) => turn.stepKey === stepKey)
  };
}

function profileSummary(questionnaire) {
  return Object.keys(questionnaire.profile || {}).slice(0, 6).map((id) => {
    const item = questionnaire.profile[id] || {};
    return [item.title, item.summary].filter(Boolean).join('：');
  }).filter(Boolean).join('\n').slice(0, 1800);
}

function nextStepTitle(moduleIndex, stepIndex, project) {
  const next = ip12.nextCursor(moduleIndex, stepIndex, ip12.foundationReady(project));
  if (next.moduleIndex === moduleIndex && next.stepIndex === stepIndex) {
    if (moduleIndex === ip12.FOUNDATION_MODULE_COUNT - 1) return '生成并确认模块 1–4 阶段报告';
    if (moduleIndex === ip12.ACTIVE_MODULE_COUNT - 1) return '完成六个模块';
  }
  const step = ip12.stepAt(next.moduleIndex, next.stepIndex);
  return step && step.title || '完成当前开放模块';
}

function guardedQuestionnaire(value, project) {
  const questionnaire = ip12.normalizeQuestionnaire(value);
  if (ip12.isModuleUnlocked(questionnaire.moduleIndex, project)) return questionnaire;
  let fallback = { moduleIndex: 0, stepIndex: 0 };
  ip12.ACTIVE_MODULES.slice(0, ip12.FOUNDATION_MODULE_COUNT).some((module, moduleIndex) =>
    module.steps.some((step, stepIndex) => {
      const answer = questionnaire.answers[ip12.keyFor(moduleIndex, stepIndex)] || {};
      if (answer.confirmed === true || answer.skipped === true) return false;
      fallback = { moduleIndex, stepIndex };
      return true;
    }));
  if (ip12.canGenerateReport(questionnaire)) {
    fallback = {
      moduleIndex: ip12.FOUNDATION_MODULE_COUNT - 1,
      stepIndex: ip12.MODULES[ip12.FOUNDATION_MODULE_COUNT - 1].steps.length - 1
    };
  }
  return ip12.withCursor(questionnaire, fallback.moduleIndex, fallback.stepIndex);
}

function questionnaireView(value, project) {
  const questionnaire = guardedQuestionnaire(value, project);
  const current = ip12.cursor(questionnaire.moduleIndex, questionnaire.stepIndex);
  const module = ip12.MODULES[current.moduleIndex];
  const step = module.steps[current.stepIndex];
  const progress = ip12.progress(questionnaire);
  const foundation = ip12.foundationProgress(questionnaire);
  const stage = ip12.foundationStage(project);
  return Object.assign({
    moduleIndex: current.moduleIndex,
    stepIndex: current.stepIndex,
    moduleId: module.id,
    moduleName: module.name,
    modulePhase: module.phase,
    stepTitle: step.title,
    currentQuestion: step.question || step.label || step.title,
    currentStepText: (current.stepIndex + 1) + ' / ' + module.steps.length,
    previousDisabled: current.moduleIndex === 0 && current.stepIndex === 0,
    modules: ip12.moduleCards(questionnaire, current.moduleIndex, project),
    completedSteps: progress.progressed,
    confirmedSteps: progress.confirmed,
    skippedSteps: progress.skipped,
    unresolvedSteps: progress.unresolved,
    progressPercent: Math.round(progress.progressed * 100 / progress.total),
    foundationComplete: foundation.unresolved === 0,
    foundationReady: ip12.foundationReady(project),
    foundationStatus: stage.status,
    atFoundationGate: foundation.unresolved === 0 && !ip12.foundationReady(project),
    flowComplete: progress.unresolved === 0,
    canGenerateReport: foundation.unresolved === 0 && !!(project && project.id)
  }, guideView(questionnaire, current.moduleIndex, current.stepIndex));
}

function reportView(payload) {
  const envelope = payload && payload.report || {};
  const content = envelope.content || {};
  const stage = payload && payload.stage_status && payload.stage_status.status || envelope.status || '';
  const foundation = envelope.stage === 'foundation_v1';
  return {
    reportVisible: !!(envelope.report_id || content.title),
    reportId: String(envelope.report_id || ''),
    reportStage: stage,
    reportFoundation: foundation,
    reportCanConfirm: foundation && stage === 'pending_confirmation' && !(payload && payload.stale),
    reportConfirmed: foundation && stage === 'confirmed' && !(payload && payload.stale),
    reportPdfUrl: String(envelope.pdf_url || ''),
    reportStale: !!(payload && payload.stale),
    reportTitle: neutralMessage(content.title, foundation ? 'IP 人设定位｜模块 1–4' : 'IP12 产品方案报告'),
    reportSummary: neutralMessage(content.executive_summary),
    reportProgressText: '已记录 ' + Number(envelope.progress && envelope.progress.confirmed || 0) +
      ' · 待补 ' + Number(envelope.progress && envelope.progress.skipped || 0),
    reportEvidence: (content.evidence || []).map((item) => ({
      id: item.evidence_id || '',
      claim: neutralMessage(item.claim),
      excerpt: neutralMessage(item.source_excerpt),
      source: neutralMessage(item.source_name && item.source_location
        ? item.source_name + ' · ' + item.source_location : item.source_ref)
    })),
    reportModules: (content.modules || []).slice()
      .sort((a, b) => Number(a.module_id || 0) - Number(b.module_id || 0))
      .map((item) => ({
        id: Number(item.module_id || 0),
        title: neutralMessage(item.title, '模块 ' + Number(item.module_id || 0)),
        summary: neutralMessage(item.summary),
        findings: (item.findings || []).map((finding) => ({
          kind: ({ fact: '事实', inference: 'AI 判断', option: '备选', recommendation: '推荐' })[finding.kind] || '待核对',
          title: neutralMessage(finding.title),
          detail: neutralMessage(finding.detail),
          evidenceIds: finding.evidence_ids || [],
          risks: neutralList(finding.risks)
        }))
      })),
    reportPriorities: (content.execution_priorities || []).map((item) => ({
      priority: neutralMessage(item.priority),
      task: neutralMessage(item.task),
      output: neutralMessage(item.output),
      evidenceIds: item.evidence_ids || []
    })),
    reportConfirmations: (content.confirmation_items || []).map((item) => ({
      item: neutralMessage(item.item),
      reason: neutralMessage(item.reason),
      required: !!item.required,
      evidenceIds: item.evidence_ids || []
    })),
    reportGaps: (content.material_gaps || []).map((item) => ({
      gap: neutralMessage(item.gap),
      why: neutralMessage(item.why_needed),
      collect: neutralMessage(item.how_to_collect),
      blocking: !!item.blocking
    })),
    reportPains: (content.industry_pains || []).map((item) => ({
      pain: neutralMessage(item.pain), why: neutralMessage(item.why_it_matters)
    })),
    reportExecution: (content.execution_plan || []).map((item) => ({
      phase: neutralMessage(item.phase), goal: neutralMessage(item.goal), steps: neutralList(item.steps)
    })),
    reportMetrics: (content.metrics || []).map((item) => ({
      name: neutralMessage(item.name), definition: neutralMessage(item.definition)
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
    guideConsent: false,
    guideInput: '',
    guideBusy: false,
    reportConsent: false,
    busy: false,
    note: '',
    reportVisible: false,
    reportId: '',
    reportStage: '',
    reportFoundation: false,
    reportCanConfirm: false,
    reportConfirmed: false,
    reportPdfUrl: '',
    pdfBusy: false,
    reportStale: false,
    reportTitle: '',
    reportSummary: '',
    reportProgressText: '',
    reportEvidence: [],
    reportModules: [],
    reportPriorities: [],
    reportConfirmations: [],
    reportGaps: [],
    reportPains: [],
    reportExecution: [],
    reportMetrics: [],
    reportDisclaimer: '',
    modulesOpen: false
  }, questionnaireView(ip12.normalizeQuestionnaire({}), null)),

  onLoad() {
    this._questionnaire = ip12.normalizeQuestionnaire({});
    this._project = null;
  },

  onShow() {
    if (!api.getToken()) {
      wx.reLaunch({ url: api.loginUrl('/pages/ip12/ip12') });
      return;
    }
    api.request('/api/auth/me', { method: 'GET' }).then((res) => {
      if (res.statusCode !== 200 || !res.data || !res.data.user) {
        this.setData({ note: '暂时无法核验账号权益，请稍后重试' });
        return;
      }
      if (res.data.membership_enforcement_enabled && !res.data.user.membership_active) {
        api.showMembershipRequired('请先开通会员后再使用小黄雀 IP 教练。');
        this.setData({ note: '需要有效会员才能进入小黄雀 IP 教练。' });
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
    return api.request('/api/gen/digital-ip/projects', {
      method: 'POST', data: { title: '我的数字化 IP' }
    }).then((res) => {
      if (res.statusCode === 401) return null;
      if (res.statusCode !== 200 && res.statusCode !== 201) {
        throw new Error(neutralMessage(res.data && res.data.detail, '创建成长档案失败，请重试'));
      }
      return this.applyProject(res.data && (res.data.project || res.data));
    });
  },

  applyProject(project) {
    if (!project || !project.id) {
      this.setData({ note: '服务返回的成长档案不完整' });
      return null;
    }
    const questionnaire = guardedQuestionnaire(project.state && project.state.questionnaire_state, project);
    this._project = project;
    this._questionnaire = questionnaire;
    this.setData(Object.assign({
      project,
      projectId: project.id,
      revision: Number(project.revision || 0),
      status: project.status || 'draft',
      reportStale: !!(project.foundation_stage && project.foundation_stage.stale),
      note: ''
    }, questionnaireView(questionnaire, project)));
    return project;
  },

  patchQuestionnaire(questionnaire) {
    if (!this._project) return Promise.reject(new Error('账号档案尚未加载'));
    const normalized = ip12.normalizeQuestionnaire(questionnaire);
    return api.request('/api/gen/digital-ip/projects/' + encodeURIComponent(this._project.id), {
      method: 'PATCH',
      data: { revision: this._project.revision, state: { questionnaire_state: normalized } }
    }).then((res) => {
      if (res.statusCode === 409) {
        return this.loadProject().then(() => { throw new Error('项目已在另一端更新，已恢复云端最新内容'); });
      }
      if (res.statusCode !== 200) throw new Error(neutralMessage(res.data && res.data.detail, '项目保存失败，请重试'));
      return res.data && (res.data.project || res.data);
    });
  },

  moveTo(next, note) {
    if (this.data.busy) return Promise.resolve(null);
    if (!ip12.isModuleUnlocked(Number(next.moduleIndex), this._project)) {
      this.setData({
        note: Number(next.moduleIndex) >= ip12.ACTIVE_MODULE_COUNT
          ? '正在开发中，敬请期待'
          : '请先完成模块 1–4，并确认阶段报告后再进入这个模块。'
      });
      return Promise.resolve(null);
    }
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
    if (!ip12.isOpenModuleIndex(moduleIndex)) {
      this.setData({ note: '正在开发中，敬请期待', modulesOpen: false });
      return Promise.resolve(null);
    }
    if (!ip12.isModuleUnlocked(moduleIndex, this._project)) {
      this.setData({ note: '请先确认模块 1–4 阶段报告，模块 5–6 才会解锁。', modulesOpen: false });
      return Promise.resolve(null);
    }
    this.setData({ modulesOpen: false });
    return this.moveTo({ moduleIndex, stepIndex: 0 }, '已切换到模块 ' + (moduleIndex + 1) + '。');
  },

  toggleModules() { this.setData({ modulesOpen: !this.data.modulesOpen }); },

  closeModules() { this.setData({ modulesOpen: false }); },

  skipCurrent() {
    if (this.data.busy || this.data.atFoundationGate || this.data.flowComplete) return Promise.resolve(null);
    let questionnaire = ip12.markSkipped(this._questionnaire, this.data.moduleIndex, this.data.stepIndex);
    const next = ip12.nextCursor(this.data.moduleIndex, this.data.stepIndex, ip12.foundationReady(this._project));
    questionnaire = ip12.withCursor(questionnaire, next.moduleIndex, next.stepIndex);
    const atFoundationEnd = this.data.moduleIndex === ip12.FOUNDATION_MODULE_COUNT - 1 &&
      this.data.stepIndex === ip12.MODULES[ip12.FOUNDATION_MODULE_COUNT - 1].steps.length - 1;
    const atFlowEnd = this.data.moduleIndex === ip12.ACTIVE_MODULE_COUNT - 1 &&
      this.data.stepIndex === ip12.MODULES[ip12.ACTIVE_MODULE_COUNT - 1].steps.length - 1;
    this.setData({ busy: true, note: '' });
    return this.patchQuestionnaire(questionnaire).then((project) => {
      this.applyProject(project);
      this.setData({
        note: atFlowEnd ? '六个模块已完成，当前流程到这里结束。'
          : atFoundationEnd ? '模块 1–4 已完成，请查看并确认阶段报告。'
            : '本题已标记待补，继续下一题。'
      });
      return project;
    }).catch((error) => {
      this.setData({ note: neutralMessage(error.message, '暂时无法跳过，请重试') });
      return null;
    }).finally(() => this.setData({ busy: false }));
  },

  onGuideConsent(e) {
    this.setData({ guideConsent: ((e.detail && e.detail.value) || []).indexOf('accepted') !== -1 });
  },

  onGuideInput(e) {
    this.setData({ guideInput: String(e.detail && e.detail.value || '') });
  },

  askGuide(e) {
    if (!this._project || this.data.busy || this.data.guideBusy) return Promise.resolve(null);
    const message = String(e && e.currentTarget && e.currentTarget.dataset.message || this.data.guideInput || '').trim();
    if (!message) {
      this.setData({ note: '请先回答小黄雀的当前问题。' });
      return Promise.resolve(null);
    }
    if (!this.data.guideConsent) {
      this.setData({ note: '请先明确同意将当前回答发送给 AI。' });
      return Promise.resolve(null);
    }
    const moduleIndex = this.data.moduleIndex;
    const stepIndex = this.data.stepIndex;
    if (!ip12.isModuleUnlocked(moduleIndex, this._project)) {
      this.setData({ note: '请先确认模块 1–4 阶段报告，再进入模块 5–6。' });
      return Promise.resolve(null);
    }
    if (this.data.atFoundationGate) {
      this.setData({ note: '模块 1–4 已完成，请先生成并确认阶段报告。' });
      return Promise.resolve(null);
    }
    if (this.data.flowComplete) {
      this.setData({ note: '六个模块已完成，当前流程到这里结束。' });
      return Promise.resolve(null);
    }

    const module = ip12.MODULES[moduleIndex];
    const step = ip12.stepAt(moduleIndex, stepIndex);
    const stepKey = ip12.keyFor(moduleIndex, stepIndex);
    const answer = this._questionnaire.answers[stepKey] || {};
    const storedTurns = normalizedGuideTurns(this._questionnaire);
    const recentTurns = storedTurns.filter((turn) => turn && turn.stepKey === stepKey).slice(-6)
      .map((turn) => ({ role: turn.role, content: String(turn.content || '') }));
    this.setData({ busy: true, guideBusy: true, note: '小黄雀正在理解你的回答…' });
    return api.request('/api/gen/digital-ip/guide', {
      method: 'POST',
      timeout: 150000,
      data: {
        module: module.name,
        step: step.title,
        step_instruction: step.instruction,
        step_why: step.why,
        current_answer: ip12.answerTextForStep(step, answer),
        ip_summary: profileSummary(this._questionnaire),
        next_step: nextStepTitle(moduleIndex, stepIndex, this._project),
        message,
        recent_turns: recentTurns,
        consent: true
      }
    }).then((res) => {
      if (!res || res.statusCode === 401) return null;
      if (res.statusCode !== 200 || !res.data || res.data.ok === false) {
        throw new Error(neutralMessage(res.data && res.data.detail, '小黄雀暂时无法回复'));
      }
      const guide = res.data.guide || {};
      const followUp = (guide.follow_up_questions || []).filter(Boolean).slice(0, 1).map(String);
      const suggestedAnswer = String(guide.suggested_answer || '').trim();
      const mergedAnswer = [String(answer.text || '').trim(), message].filter(Boolean).join('\n').slice(0, 6000);
      const initialQuestion = storedTurns.some((turn) => turn.stepKey === stepKey) ? [] : [
        { role: 'assistant', content: step.question || step.title, stepKey }
      ];
      const assistantContent = [String(guide.reply || '我已经记下了。').trim(), followUp[0] || '']
        .filter(Boolean)
        .filter((item, index, list) => list.indexOf(item) === index)
        .join('\n\n');
      const turns = storedTurns.concat(initialQuestion, [
        { role: 'user', content: message, stepKey },
        {
          role: 'assistant',
          content: assistantContent,
          suggested_answer: suggestedAnswer,
          follow_up_questions: followUp,
          stepKey
        }
      ]).slice(-72);

      let questionnaire = ip12.editAnswer(this._questionnaire, moduleIndex, stepIndex, {
        text: mergedAnswer,
        keywords: suggestedAnswer || String(answer.keywords || ''),
        suggested_answer: suggestedAnswer || String(answer.suggested_answer || ''),
        skipped: false
      });
      questionnaire.answers[stepKey] = Object.assign({}, questionnaire.answers[stepKey], {
        confirmed: followUp.length === 0,
        confirmedValue: followUp.length === 0 ? mergedAnswer : String(answer.confirmedValue || ''),
        skipped: false
      });
      questionnaire = ip12.syncDerived(Object.assign({}, questionnaire, { guideTurns: turns }));
      if (followUp.length === 0) {
        const next = ip12.nextCursor(moduleIndex, stepIndex, ip12.foundationReady(this._project));
        questionnaire = ip12.withCursor(questionnaire, next.moduleIndex, next.stepIndex);
      }
      const completedFoundation = followUp.length === 0 && moduleIndex === ip12.FOUNDATION_MODULE_COUNT - 1 &&
        stepIndex === module.steps.length - 1;
      const completedFlow = followUp.length === 0 && moduleIndex === ip12.ACTIVE_MODULE_COUNT - 1 &&
        stepIndex === module.steps.length - 1;
      return this.patchQuestionnaire(questionnaire).then((project) => {
        this.applyProject(project);
        this.setData({
          guideInput: '',
          note: followUp.length ? '还差一点信息，请继续回答上面这个问题。'
            : completedFoundation ? '模块 1–4 已完成，请查看并确认阶段报告。'
              : completedFlow ? '六个模块已完成，当前流程到这里结束。'
                : '已记录，继续下一题。'
        });
        return project;
      });
    }).catch((error) => {
      this.setData({ note: neutralMessage(error.message, '小黄雀暂时无法回复，请稍后重试') });
      return null;
    }).finally(() => this.setData({ busy: false, guideBusy: false }));
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
      else if (res.statusCode === 404) this.setData(reportView({}));
      else if (res.statusCode !== 401) {
        this.setData({ note: neutralMessage(res.data && res.data.detail, '报告恢复失败') });
      }
      return res;
    }).catch(() => null);
  },

  generateReport() {
    if (!this._project || this.data.busy) return Promise.resolve(null);
    if (!this.data.canGenerateReport) {
      this.setData({ note: '请先完成或标记待补模块 1–4 的 30 个采访问题。' });
      return Promise.resolve(null);
    }
    if (!this.data.reportConsent) {
      this.setData({ note: '请先明确同意将已保存回答发送给 AI 服务生成报告。' });
      return Promise.resolve(null);
    }
    this.setData({ busy: true, note: '正在生成阶段报告，请不要重复提交。' });
    return api.request('/api/gen/digital-ip/projects/' + encodeURIComponent(this._project.id) + '/report', {
      method: 'POST',
      timeout: 150000,
      data: { revision: this._project.revision, consent: true }
    }).then((res) => {
      if (res.statusCode === 409) {
        this.loadProject();
        throw new Error('项目已更新，请重新确认报告内容');
      }
      if (res.statusCode !== 200) throw new Error(neutralMessage(res.data && res.data.detail, '报告生成失败'));
      const payload = res.data || {};
      this.applyProject(payload.project);
      this.setData(Object.assign({}, reportView(payload), {
        note: '阶段报告已生成。请核对并明确确认后，再进入模块 5。'
      }));
      return payload;
    }).catch((error) => {
      this.setData({ note: neutralMessage(error.message, '报告生成失败，请稍后重试') });
      return null;
    }).finally(() => this.setData({ busy: false, reportConsent: false }));
  },

  confirmReport() {
    if (!this._project || this.data.busy || !this.data.reportCanConfirm || !this.data.reportId) {
      return Promise.resolve(null);
    }
    this.setData({ busy: true, note: '正在确认模块 1–4 的 IP 底座…' });
    return api.request('/api/gen/digital-ip/projects/' + encodeURIComponent(this._project.id) + '/report-confirm', {
      method: 'POST',
      data: { revision: this._project.revision, report_id: this.data.reportId }
    }).then((res) => {
      if (res.statusCode === 409) {
        return this.loadProject().then(() => this.loadReport()).then(() => {
          throw new Error('项目内容已更新，请重新生成并确认阶段报告。');
        });
      }
      if (res.statusCode !== 200) throw new Error(neutralMessage(res.data && res.data.detail, '阶段报告确认失败'));
      const project = res.data && (res.data.project || res.data);
      this.applyProject(project);
      const questionnaire = ip12.withCursor(this._questionnaire, ip12.FOUNDATION_MODULE_COUNT, 0);
      return this.patchQuestionnaire(questionnaire).then((updated) => {
        this.applyProject(updated);
        this.setData({
          reportStage: 'confirmed',
          reportCanConfirm: false,
          reportConfirmed: true,
          note: 'IP 底座已确认，已进入模块 5。'
        });
        return updated;
      });
    }).catch((error) => {
      this.setData({ note: neutralMessage(error.message, '阶段报告确认失败，请重试') });
      return null;
    }).finally(() => this.setData({ busy: false }));
  },

  downloadReport() {
    if (!this.data.reportPdfUrl || this.data.pdfBusy) return Promise.resolve(null);
    this.setData({ pdfBusy: true, note: '正在准备 PDF…' });
    return api.downloadProtected(this.data.reportPdfUrl).then((filePath) => new Promise((resolve, reject) => {
      wx.openDocument({
        filePath,
        fileType: 'pdf',
        showMenu: true,
        success: resolve,
        fail(error) {
          const reason = error instanceof Error ? error : new Error('open document failed');
          reason.pdfOpenFailed = true;
          reject(reason);
        }
      });
    })).then(() => this.setData({ note: 'PDF 已打开，可从右上角菜单保存或转发。' }))
      .catch((error) => {
        if (error && error.statusCode === 401) {
          api.clearToken();
          wx.reLaunch({ url: api.loginUrl('/pages/ip12/ip12') });
          return;
        }
        const note = error && error.pdfOpenFailed ? '当前微信无法打开该 PDF，请稍后重试。'
          : error && error.statusCode === 403 ? '当前账号无权下载这份 PDF。'
            : error && error.statusCode === 429 ? '正在生成另一份 PDF，请稍后再试。'
              : 'PDF 下载失败，请稍后重试。';
        this.setData({ note });
      }).finally(() => this.setData({ pdfBusy: false }));
  },

  reportView
});
