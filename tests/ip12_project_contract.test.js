const assert = require('assert');
const api = require('../miniprogram/utils/api.js');
const ip12 = require('../miniprogram/utils/ip12.js');

let page;
global.Page = (definition) => { page = definition; };
require('../miniprogram/pages/ip12/ip12.js');

const ctx = {
  data: Object.assign({}, page.data),
  setData(patch) { Object.assign(this.data, patch); }
};
const project = {
  id: 'ip12-1', revision: 7, status: 'draft',
  foundation_stage: { status: 'missing', stale: false },
  state: { questionnaire_state: ip12.normalizeQuestionnaire({ interviewVersion: 2, answers: {
    '0-0': { text: '唐老师', confirmed: true }
  } }) }
};
page.applyProject.call(ctx, project);
assert.strictEqual(ctx.data.projectId, 'ip12-1');
assert.strictEqual(ctx.data.revision, 7);
assert.strictEqual(ctx.data.moduleIndex, 0);
assert.strictEqual(ctx.data.stepIndex, 0);
assert.strictEqual(ctx.data.foundationReady, false);
assert.strictEqual(ctx.data.modules[4].locked, true);
assert.strictEqual(ctx._questionnaire.interviewVersion, 2);

const legacyReport = page.reportView({
  stale: false,
  report: { report_id: 'legacy-1', pdf_url: '/api/gen/digital-ip/projects/ip12-1/report.pdf',
    progress: { total: 34, confirmed: 33, skipped: 1 }, content: {
      title: '旧版产品方案', executive_summary: '旧报告仍可阅读。',
      evidence: [{ evidence_id: 'E1', claim: '客群明确', source_excerpt: '服务店主',
        source_name: '已确认问卷回答', source_location: '问卷步骤 0-0' }],
      industry_pains: [{ pain: '内容不稳定', why_it_matters: '影响长期表达' }],
      execution_plan: [{ phase: '第一阶段', goal: '建立稳定表达', steps: ['确认主题'] }],
      metrics: [{ name: '更新频率', definition: '每周发布次数' }],
      material_gaps: [{ gap: '账号链接待补', why_needed: '核对内容', how_to_collect: '粘贴链接', blocking: false }],
      disclaimer: '仅基于已确认资料。'
    }
  }
});
assert.strictEqual(legacyReport.reportVisible, true);
assert.strictEqual(legacyReport.reportFoundation, false);
assert.strictEqual(legacyReport.reportPains[0].pain, '内容不稳定');
assert.strictEqual(legacyReport.reportExecution[0].phase, '第一阶段');
assert.strictEqual(legacyReport.reportMetrics[0].name, '更新频率');
assert.strictEqual(legacyReport.reportEvidence[0].source, '已确认问卷回答 · 问卷步骤 0-0');

const foundationReport = page.reportView({
  stale: false,
  stage_status: { status: 'pending_confirmation', report_id: 'foundation-1', stale: false },
  report: { stage: 'foundation_v1', status: 'pending_confirmation', report_id: 'foundation-1',
    pdf_url: '/api/gen/digital-ip/projects/ip12-1/report.pdf', progress: { total: 30, confirmed: 28, skipped: 2 },
    content: {
      title: 'IP 人设定位｜模块 1–4', executive_summary: '先确认定位底座。', evidence: [],
      modules: [{ module_id: 1, title: '定位诊断', summary: '定位清楚', findings: [{
        kind: 'fact', title: '常用称呼', detail: '唐老师', evidence_ids: ['E1'], risks: []
      }] }],
      execution_priorities: [{ priority: 'P0', task: '核对定位', output: '定位确认稿', evidence_ids: ['E1'] }],
      confirmation_items: [{ item: '公开称呼', reason: '用于公开页面', required: true, evidence_ids: ['E1'] }],
      material_gaps: [{ gap: '账号链接待补', why_needed: '核对内容', how_to_collect: '粘贴链接', blocking: false }],
      disclaimer: '仅基于已确认资料。'
    }
  }
});
assert.strictEqual(foundationReport.reportFoundation, true);
assert.strictEqual(foundationReport.reportCanConfirm, true);
assert.strictEqual(foundationReport.reportConfirmed, false);
assert.strictEqual(foundationReport.reportModules[0].findings[0].kind, '事实');
assert.strictEqual(foundationReport.reportPriorities[0].priority, 'P0');
assert.strictEqual(foundationReport.reportConfirmations[0].required, true);
assert.strictEqual(foundationReport.reportGaps[0].gap, '账号链接待补');
assert.strictEqual(foundationReport.reportProgressText, '已记录 28 · 待补 2');

const neutralReport = page.reportView({ report: { report_id: 'r2', content: {
  title: 'OpenAI GPT-4o Structured Outputs', executive_summary: 'Claude 与 Gemini 生成'
} } });
assert.strictEqual(neutralReport.reportTitle, 'AI 服务 AI 服务 AI 服务');
assert.strictEqual(neutralReport.reportSummary, 'AI 服务 与 AI 服务 生成');

let foundationQuestionnaire = ip12.normalizeQuestionnaire({});
ip12.ACTIVE_MODULES.slice(0, 4).forEach((module, moduleIndex) => module.steps.forEach((step, stepIndex) => {
  foundationQuestionnaire = ip12.markSkipped(foundationQuestionnaire, moduleIndex, stepIndex);
}));
foundationQuestionnaire = ip12.withCursor(foundationQuestionnaire, 3, 4);
const confirmCalls = [];
const confirmCtx = {
  data: Object.assign({}, page.data, {
    reportCanConfirm: true, reportId: 'foundation-1', busy: false, reportVisible: true
  }),
  _project: {
    id: 'ip12-confirm', revision: 8, status: 'draft',
    foundation_stage: { status: 'pending_confirmation', stale: false, report_id: 'foundation-1' },
    state: { questionnaire_state: foundationQuestionnaire }
  },
  _questionnaire: foundationQuestionnaire,
  setData(patch) { Object.assign(this.data, patch); }
};
confirmCtx.applyProject = page.applyProject;
confirmCtx.patchQuestionnaire = page.patchQuestionnaire;
api.request = (path, options) => {
  confirmCalls.push({ path, options });
  if (path.endsWith('/report-confirm')) return Promise.resolve({ statusCode: 200, data: { project: {
    id: 'ip12-confirm', revision: 9, status: 'draft',
    foundation_stage: { status: 'confirmed', stale: false, report_id: 'foundation-1' },
    state: { questionnaire_state: foundationQuestionnaire }
  } } });
  if (path === '/api/gen/digital-ip/projects/ip12-confirm') return Promise.resolve({ statusCode: 200, data: { project: {
    id: 'ip12-confirm', revision: 10, status: 'draft',
    foundation_stage: { status: 'confirmed', stale: false, report_id: 'foundation-1' },
    state: { questionnaire_state: options.data.state.questionnaire_state }
  } } });
  throw new Error('unexpected request ' + path);
};

(async () => {
  await page.confirmReport.call(confirmCtx);
  assert.strictEqual(confirmCalls[0].path, '/api/gen/digital-ip/projects/ip12-confirm/report-confirm');
  assert.deepStrictEqual(confirmCalls[0].options.data, { revision: 8, report_id: 'foundation-1' });
  assert.strictEqual(confirmCalls[1].path, '/api/gen/digital-ip/projects/ip12-confirm');
  assert.strictEqual(confirmCalls[1].options.data.state.questionnaire_state.moduleIndex, 4);
  assert.strictEqual(confirmCalls[1].options.data.state.questionnaire_state.stepIndex, 0);
  assert.strictEqual(confirmCtx.data.moduleIndex, 4);
  assert.strictEqual(confirmCtx.data.foundationReady, true);
  assert.match(confirmCtx.data.note, /已进入模块 5/);
  console.log('ip12 project contract checks passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
