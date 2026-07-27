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
  state: { questionnaire_state: { answers: { '0-0': { text: '帮助店主成交', confirmed: true } } } },
  last_analysis: { analysis: {
    positioning_candidates: [{ title: 'A' }, { title: 'B' }, { title: 'C' }],
    source_evidence: [{ file_name: 'brief.pdf', location: '未定位', claim: '客群店主', evidence: '摘要' }],
    image_plan: { prompt: '旧图片提示词' }, video_plan: { script_direction: '旧视频脚本' }
  }, model: 'test-model', created_at: '2026-07-27T00:00:00Z', input: { answer: '帮助店主成交' } },
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
assert.strictEqual(page.projectFromResponse.call(ctx, { project, analysis: { ignored: true } }), project);
page.onAnswer.call(ctx, { detail: { value: '修改后的回答' } });
assert.strictEqual(ctx.data.candidates.length, 0);
assert.strictEqual(ctx.data.canPrefill, false);
page.applyProject.call(ctx, project);

const calls = [];
global.wx = {
  setStorageSync(key, value) { calls.push(['storage', key, value]); },
  navigateTo(value) { calls.push(['navigate', value]); },
  showToast(value) { calls.push(['toast', value]); }
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
console.log('ip12 project contract checks passed');
