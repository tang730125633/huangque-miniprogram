const assert = require('assert');

let page;
global.Page = (definition) => { page = definition; };
require('../miniprogram/pages/ip12/ip12.js');

const ctx = {
  data: Object.assign({}, page.data),
  setData(patch) { Object.assign(this.data, patch); }
};
const project = {
  id: 'ip12-1', revision: 7, status: 'confirmed',
  state: { questionnaire_state: {
    moduleIndex: 0, stepIndex: 0,
    answers: { '0-0': { text: '帮助店主成交', confirmed: true } }
  } },
  last_analysis: {
    analysis: {
      positioning_candidates: [{ title: 'A' }, { title: 'B' }, { title: 'C' }],
      source_evidence: [{ file_name: 'brief.pdf', location: '未定位', claim: '客群店主', evidence: '摘要' }],
      image_plan: { prompt: '旧图片提示词' }, video_plan: { script_direction: '旧视频脚本' }
    },
    created_at: '2026-07-27T00:00:00Z',
    input: { module_index: 0, step_index: 0, answer: '帮助店主成交' }
  },
  confirmed_profile: { title: '已确认定位' },
  confirmed_candidate_index: 1,
  confirmed_plans: {
    image_plan: { goal: '品牌首帧', prompt: '确认图片提示词', references_needed: ['门店照'] },
    video_plan: { goal: '成交短片', format: '9:16', duration_seconds: 15, shots: ['确认视频脚本'] }
  }
};

page.applyProject.call(ctx, project);
assert.strictEqual(ctx.data.revision, 7);
assert.strictEqual(ctx.data.candidates.length, 3);
assert.match(ctx.data.sourceEvidence[0], /brief\.pdf · 未定位/);
assert.strictEqual(ctx.data.imagePrompt, '确认图片提示词');
assert.strictEqual(ctx.data.videoPrompt, '成交短片；确认视频脚本');
assert.strictEqual(ctx.data.confirmed.title, '已确认定位');
assert.strictEqual(ctx.data.canPrefill, true);

const calls = [];
global.wx = {
  setStorageSync(key, value) { calls.push(['storage', key, value]); },
  navigateTo(value) { calls.push(['navigate', value]); },
  showToast(value) { calls.push(['toast', value]); },
  setClipboardData(value) { calls.push(['clipboard', value]); if (value.success) value.success(); }
};
ctx.data.canPrefill = false;
page.goImage.call(ctx);
page.goVideo.call(ctx);
assert.deepStrictEqual(calls.map((item) => item[0]), ['toast', 'toast']);
ctx.data.canPrefill = true;
page.goImage.call(ctx);
page.goVideo.call(ctx);
assert.deepStrictEqual(calls.slice(2).map((item) => item[0]), ['storage', 'navigate', 'storage', 'navigate']);
assert.strictEqual(calls[2][2].prompt, '确认图片提示词');
assert.strictEqual(calls[4][2].prompt, '成交短片；确认视频脚本');

const report = page.reportView({
  stale: false,
  report: { report_id: 'r1', progress: { total: 54, confirmed: 53, skipped: 1 }, content: {
    title: '门店 IP 产品方案', executive_summary: '先建立可信定位，再稳定生产内容。',
    evidence: [{ evidence_id: 'E1', claim: '复购下降', source_ref: 'answer:0-0', source_excerpt: '老客复购下降',
      source_name: '已确认问卷回答', source_location: '问卷步骤 0-0' }],
    industry_pains: [{ pain: '复购不足', evidence_ids: ['E1'], why_it_matters: '影响长期增长', product_matches: [
      { product_id: 'image_studio', fit_reason: '建立统一视觉', execution_steps: ['先确认视觉提示词'] }
    ] }],
    execution_plan: [{ phase: '第一阶段', goal: '建立视觉', steps: ['确认提示词'] }],
    metrics: [{ name: '复购率', definition: '复购人数占比', baseline: '待确认', target: '待确认', review_cycle: '每月', evidence_ids: ['E1'] }],
    material_gaps: [{ gap: '缺少客单数据', why_needed: '建立基线', how_to_collect: '导出月报', blocking: false }],
    disclaimer: '仅基于已确认资料。'
  } }
});
assert.strictEqual(report.reportVisible, true);
assert.strictEqual(report.reportEvidence[0].source, '已确认问卷回答 · 问卷步骤 0-0');
assert.strictEqual(report.reportPains[0].productMatches[0].actionType, 'image');
assert.strictEqual(report.reportMetrics[0].reviewCycle, '每月');
const neutralReport = page.reportView({ report: { report_id: 'r2', content: {
  title: 'OpenAI GPT-4o Structured Outputs', executive_summary: 'Claude 与 Gemini 生成'
} } });
assert.strictEqual(neutralReport.reportTitle, 'AI 服务 AI 服务 AI 服务');
assert.strictEqual(neutralReport.reportSummary, 'AI 服务 与 AI 服务 生成');

calls.length = 0;
ctx.data.reportPains = [{ painIndex: 0, pain: '内容不稳定', productMatches: [
  { matchIndex: 0, canOpen: true, actionType: 'image', productId: 'image_studio', fitReason: '视觉', steps: ['首图'] },
  { matchIndex: 1, canOpen: true, actionType: 'video', productId: 'video_studio', fitReason: '短片', steps: ['脚本'] },
  { matchIndex: 2, canOpen: true, actionType: 'script', productId: 'script_studio', fitReason: '文案', steps: ['提纲'] },
  { matchIndex: 3, canOpen: true, actionType: 'audio', productId: 'voice_studio', fitReason: '音频', steps: ['口播'] },
  { matchIndex: 4, canOpen: true, actionType: 'website', productId: 'workflow_canvas', fitReason: '流程', steps: ['编排'] }
] }];
for (let match = 0; match < 5; match += 1) {
  page.openReportProduct.call(ctx, { currentTarget: { dataset: { pain: 0, match } } });
}
assert.deepStrictEqual(calls.filter((item) => item[0] === 'navigate').map((item) => item[1].url), [
  '/pages/banana/banana', '/pages/video/video?mode=generate', '/pages/video/video?mode=talking', '/pages/audio/audio'
]);
assert.strictEqual(calls.find((item) => item[0] === 'clipboard')[1].data, 'https://huangquechuanmei.com/workbench/canvas.html');
console.log('ip12 project contract checks passed');
