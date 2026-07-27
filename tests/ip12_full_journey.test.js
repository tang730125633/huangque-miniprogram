const assert = require('assert');
const fs = require('fs');
const ip12 = require('../miniprogram/utils/ip12.js');

assert.strictEqual(ip12.MODULES.length, 12);
assert.strictEqual(ip12.ACTIVE_MODULE_COUNT, 8);
assert.strictEqual(ip12.TOTAL_STEPS, 34);
assert.strictEqual(ip12.ROADMAP_STEPS, 54);
assert.deepStrictEqual(ip12.MODULE_NAMES.slice(8), ['私域矩阵', '朋友圈运营', '销售策略', '公众号变现']);
assert.ok(ip12.MODULES.slice(8).every((module) => module.availability === 'coming_soon'));
assert.strictEqual(ip12.MODULES[0].steps[0].title, '先聊聊你想打造的 IP');
const typeCounts = {};
ip12.ACTIVE_MODULES.forEach((module) => module.steps.forEach((step) => {
  typeCounts[step.type] = (typeCounts[step.type] || 0) + 1;
  assert.ok(step.title && step.instruction && step.why);
}));
assert.strictEqual(Object.values(typeCounts).reduce((sum, count) => sum + count, 0), 34);

let questionnaire = ip12.normalizeQuestionnaire({});
assert.deepStrictEqual(ip12.progress(questionnaire), {
  total: 34, confirmed: 0, skipped: 0, progressed: 0, unresolved: 34, skippedItems: []
});
questionnaire = ip12.markSkipped(questionnaire, 0, 0);
assert.strictEqual(ip12.progress(questionnaire).skipped, 1);
questionnaire = ip12.editAnswer(questionnaire, 0, 0, { text: '回补后的真实经营底图' });
questionnaire = ip12.markConfirmed(questionnaire, 0, 0);
assert.strictEqual(ip12.progress(questionnaire).confirmed, 1);
assert.strictEqual(ip12.progress(questionnaire).skipped, 0);
questionnaire = ip12.editAnswer(questionnaire, 0, 0, { text: '修改后的经营底图' });
assert.strictEqual(questionnaire.answers['0-0'].confirmed, false);

questionnaire = ip12.normalizeQuestionnaire({ answers: {} });
ip12.ACTIVE_MODULES.forEach((module, moduleIndex) => module.steps.forEach((step, stepIndex) => {
  if ((moduleIndex + stepIndex) % 7 === 0) questionnaire = ip12.markSkipped(questionnaire, moduleIndex, stepIndex);
  else {
    const patch = step.type === 'text' ? { text: '已确认回答 ' + moduleIndex + '-' + stepIndex }
      : step.type === 'multi' ? { choice: [step.options[0]] }
        : step.type === 'single' ? { choice: step.options[0] }
          : { text: step.preview.join('\n'), reviewed: true };
    questionnaire = ip12.editAnswer(questionnaire, moduleIndex, stepIndex, patch);
    questionnaire = ip12.markConfirmed(questionnaire, moduleIndex, stepIndex);
  }
}));
const completed = ip12.progress(questionnaire);
assert.strictEqual(completed.progressed, 34);
assert.strictEqual(completed.unresolved, 0);
assert.strictEqual(ip12.canGenerateReport(questionnaire), true);
assert.strictEqual(questionnaire.completedModules.length, 8);

const legacy = ip12.normalizeQuestionnaire({
  moduleIndex: 9, stepIndex: 2, completedModules: [9, 10], profile: { 9: { title: '旧私域数据' } },
  answers: { '8-0': { text: '旧答案', confirmed: true } }
});
assert.deepStrictEqual(ip12.cursor(9, 2), { moduleIndex: 0, stepIndex: 2 });
assert.strictEqual(legacy.answers['8-0'].text, '旧答案');
assert.deepStrictEqual(legacy.completedModules, [9, 10]);
assert.strictEqual(legacy.profile[9].title, '旧私域数据');
assert.ok(ip12.moduleCards(legacy, 0).slice(8).every((module) => module.comingSoon && !module.done));

const lastOfFirst = ip12.previousCursor(1, 0);
assert.deepStrictEqual(lastOfFirst, { moduleIndex: 0, stepIndex: 4 });
assert.deepStrictEqual(ip12.nextCursor(0, 4), { moduleIndex: 1, stepIndex: 0 });

const page = fs.readFileSync('miniprogram/pages/ip12/ip12.js', 'utf8');
const view = fs.readFileSync('miniprogram/pages/ip12/ip12.wxml', 'utf8');
const questions = fs.readFileSync('miniprogram/utils/ip12_questions.js', 'utf8');
assert.match(page, /state: \{ questionnaire_state: questionnaire \}/);
assert.match(page, /revision: this\._project\.revision/);
assert.match(page, /res\.statusCode === 409/);
assert.match(page, /\/analyze'/);
assert.match(page, /\/api\/gen\/digital-ip\/guide/);
assert.match(page, /\/confirm'/);
assert.match(page, /\/report'/);
assert.match(page, /downloadProtected\(this\.data\.reportPdfUrl\)/);
assert.match(page, /showMenu: true/);
assert.match(page, /method: 'POST', timeout: 150000, data: \{ revision: this\._project\.revision, consent: true \}/);
assert.match(view, /bindtap="previousStep"/);
assert.match(view, /bindtap="skipCurrent"/);
assert.match(view, /bindtap="confirmCurrent"/);
assert.match(view, /开发中，敬请期待/);
assert.match(view, /让 AI 问第一题/);
assert.match(view, /一次只问一题/);
assert.match(view, /本步确认稿/);
assert.match(view, /这里不是固定问卷/);
assert.doesNotMatch(questions, /门店类型与规模|美业老板/);
assert.doesNotMatch(view, /门店类型与规模|美业老板/);
assert.match(view, /executive|reportSummary/);
assert.match(view, /行业痛点与黄雀产品匹配/);
assert.match(view, /行动阶段/);
assert.match(view, /复盘指标/);
assert.match(view, /资料缺口/);
assert.match(view, /bindtap="downloadReport"/);
assert.match(view, /预览并保存 PDF/);
assert.match(view, /当前开放进度 \{\{completedSteps\}\} \/ 34/);
assert.doesNotMatch(view, /<rich-text/);

assert.strictEqual(ip12.productAction('image_studio').type, 'image');
assert.strictEqual(ip12.productAction('video_studio').type, 'video');
assert.strictEqual(ip12.productAction('script_studio').type, 'script');
assert.strictEqual(ip12.productAction('voice_studio').type, 'audio');
assert.strictEqual(ip12.productAction('workflow_canvas').type, 'website');
assert.match(view, /product-title-link/);
assert.match(ip12.productAction('image_studio').label, /可点击跳转使用黄雀/);
assert.doesNotMatch(view, /OpenAI|GPT|Structured/i);
assert.match(ip12.productPrompt('复购不足', { fit_reason: '统一视觉', execution_steps: ['确认提示词'] }), /确认提示词/);
console.log('ip12 full journey checks passed');
