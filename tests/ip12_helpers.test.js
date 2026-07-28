const assert = require('assert');
const ip12 = require('../miniprogram/utils/ip12.js');

assert.deepStrictEqual(ip12.MODULE_STEPS, [18, 4, 3, 5, 5, 3, 0, 0, 0, 0, 0, 0]);
assert.strictEqual(ip12.MODULE_STEPS.reduce((a, b) => a + b, 0), 38);
assert.strictEqual(ip12.INTERVIEW_VERSION, 2);
assert.strictEqual(ip12.ACTIVE_MODULE_COUNT, 6);
assert.strictEqual(ip12.FOUNDATION_MODULE_COUNT, 4);
assert.strictEqual(ip12.TOTAL_STEPS, 38);
assert.deepStrictEqual(ip12.MODULE_NAMES, ['定位诊断', '人设塑造', '价值主张', '故事资产', '内容选题', '文案口播', 'IP 形象设计', '脚本分镜', '私域矩阵', '朋友圈运营', '销售策略', '公众号变现']);
assert.strictEqual(ip12.MODULES[0].steps[0].title, '姓名或昵称');
assert.strictEqual(ip12.MODULES[0].steps[0].conversation, true);
assert.ok(ip12.ACTIVE_MODULES.every((module) => module.steps.every((step) => step.type === 'text')));
assert.doesNotMatch(JSON.stringify(ip12.MODULES.slice(0, 6)), /门店类型与规模|美业老板/);

const beforeClosedWrite = ip12.normalizeQuestionnaire({ interviewVersion: 2, answers: {
  '0-0': { text: '不能被覆盖', confirmed: true }
} });
for (const mutate of [ip12.editAnswer, ip12.markConfirmed, ip12.markSkipped]) {
  const afterClosedWrite = mutate(beforeClosedWrite, 6, 0, { text: '关闭模块' });
  assert.deepStrictEqual(afterClosedWrite.answers, beforeClosedWrite.answers);
  assert.strictEqual(afterClosedWrite.answers['6-0'], undefined);
}

let foundation = ip12.normalizeQuestionnaire({});
ip12.ACTIVE_MODULES.slice(0, 4).forEach((module, moduleIndex) => module.steps.forEach((step, stepIndex) => {
  foundation = ip12.markSkipped(foundation, moduleIndex, stepIndex);
}));
assert.deepStrictEqual(ip12.foundationProgress(foundation), {
  total: 30, confirmed: 0, skipped: 30, progressed: 30, unresolved: 0
});
assert.strictEqual(ip12.canGenerateReport(foundation), true);
assert.deepStrictEqual(ip12.nextCursor(3, 4, false), { moduleIndex: 3, stepIndex: 4 });
assert.deepStrictEqual(ip12.nextCursor(3, 4, true), { moduleIndex: 4, stepIndex: 0 });
assert.strictEqual(ip12.moduleCards(foundation, 3, null)[4].locked, true);
const confirmedProject = { foundation_stage: { status: 'confirmed', stale: false } };
assert.strictEqual(ip12.moduleCards(foundation, 3, confirmedProject)[4].locked, false);
assert.strictEqual(ip12.isModuleUnlocked(5, confirmedProject), true);

let summarized = ip12.normalizeQuestionnaire({});
ip12.MODULES[1].steps.forEach((step, stepIndex) => {
  summarized = ip12.editAnswer(summarized, 1, stepIndex, {
    text: '原话 ' + stepIndex,
    keywords: stepIndex === 0 ? '真实关键词' : ''
  });
  summarized = ip12.markConfirmed(summarized, 1, stepIndex);
});
assert.match(summarized.profile[2].summary, /真实关键词；原话 1/,
  'completed module summary must carry all confirmed fields across web and mini-program');

const legacy = ip12.normalizeQuestionnaire({ answers: { '4-0': { text: '旧版内容' } } });
assert.strictEqual(legacy.interviewVersion, 2);
assert.deepStrictEqual(legacy.answers, {}, 'legacy fields must not leak into the six-module contract');
console.log('ip12 helper checks passed');
