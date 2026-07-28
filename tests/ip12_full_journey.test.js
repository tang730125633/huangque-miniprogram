const assert = require('assert');
const fs = require('fs');
const ip12 = require('../miniprogram/utils/ip12.js');

assert.strictEqual(ip12.MODULES.length, 12);
assert.strictEqual(ip12.ACTIVE_MODULE_COUNT, 6);
assert.strictEqual(ip12.TOTAL_STEPS, 38);
assert.strictEqual(ip12.foundationProgress({}).total, 30);
assert.deepStrictEqual(ip12.ACTIVE_MODULE_STEPS, [18, 4, 3, 5, 5, 3]);
assert.deepStrictEqual(ip12.MODULE_NAMES.slice(6), ['IP 形象设计', '脚本分镜', '私域矩阵', '朋友圈运营', '销售策略', '公众号变现']);
assert.ok(ip12.MODULES.slice(6).every((module) => module.availability === 'coming_soon' && module.desc === '正在开发中，敬请期待'));
assert.strictEqual(ip12.MODULES[0].steps[0].title, '姓名或昵称');
assert.strictEqual(ip12.MODULES[3].steps[4].title, '团队或项目故事');
assert.strictEqual(ip12.MODULES[5].steps[2].title, '行动目标');
ip12.ACTIVE_MODULES.forEach((module) => module.steps.forEach((step) => {
  assert.strictEqual(step.type, 'text');
  assert.ok(step.title && step.question && step.instruction && step.why);
}));

let questionnaire = ip12.normalizeQuestionnaire({});
assert.deepStrictEqual(ip12.progress(questionnaire), {
  total: 38, confirmed: 0, skipped: 0, progressed: 0, unresolved: 38, skippedItems: []
});
questionnaire = ip12.markSkipped(questionnaire, 0, 0);
questionnaire = ip12.editAnswer(questionnaire, 0, 0, { text: '唐老师' });
questionnaire = ip12.markConfirmed(questionnaire, 0, 0);
assert.strictEqual(ip12.progress(questionnaire).confirmed, 1);
assert.strictEqual(ip12.progress(questionnaire).skipped, 0);
questionnaire = ip12.editAnswer(questionnaire, 0, 0, { text: 'Tang' });
assert.strictEqual(questionnaire.answers['0-0'].confirmed, false);

questionnaire = ip12.normalizeQuestionnaire({});
ip12.ACTIVE_MODULES.slice(0, 4).forEach((module, moduleIndex) => module.steps.forEach((step, stepIndex) => {
  questionnaire = ip12.editAnswer(questionnaire, moduleIndex, stepIndex, { text: '已确认回答 ' + moduleIndex + '-' + stepIndex });
  questionnaire = ip12.markConfirmed(questionnaire, moduleIndex, stepIndex);
}));
assert.strictEqual(ip12.foundationProgress(questionnaire).progressed, 30);
assert.strictEqual(ip12.progress(questionnaire).unresolved, 8);
assert.strictEqual(ip12.canGenerateReport(questionnaire), true, 'report gate is after modules 1-4');
assert.deepStrictEqual(ip12.nextCursor(3, 4, false), { moduleIndex: 3, stepIndex: 4 });
assert.deepStrictEqual(ip12.nextCursor(3, 4, true), { moduleIndex: 4, stepIndex: 0 });

ip12.ACTIVE_MODULES.slice(4).forEach((module, relativeIndex) => module.steps.forEach((step, stepIndex) => {
  const moduleIndex = relativeIndex + 4;
  questionnaire = ip12.editAnswer(questionnaire, moduleIndex, stepIndex, { text: '已确认回答 ' + moduleIndex + '-' + stepIndex });
  questionnaire = ip12.markConfirmed(questionnaire, moduleIndex, stepIndex);
}));
const completed = ip12.progress(questionnaire);
assert.strictEqual(completed.progressed, 38);
assert.strictEqual(completed.unresolved, 0);
assert.deepStrictEqual(questionnaire.completedModules, [1, 2, 3, 4, 5, 6]);

const page = fs.readFileSync('miniprogram/pages/ip12/ip12.js', 'utf8');
const view = fs.readFileSync('miniprogram/pages/ip12/ip12.wxml', 'utf8');
const questions = fs.readFileSync('miniprogram/utils/ip12_questions.js', 'utf8');
assert.match(page, /ip12\.normalizeQuestionnaire/);
assert.match(page, /state: \{ questionnaire_state: normalized \}/);
assert.match(page, /res\.statusCode === 409/);
assert.match(page, /\/api\/gen\/digital-ip\/guide/);
assert.match(page, /follow_up_questions/);
assert.match(page, /keywords: suggestedAnswer/);
assert.match(page, /confirmed: followUp\.length === 0/);
assert.match(page, /\/report-confirm/);
assert.match(page, /downloadProtected\(this\.data\.reportPdfUrl\)/);
assert.match(page, /showMenu: true/);
assert.match(view, /bindtap="previousStep"/);
assert.match(view, /bindtap="skipCurrent"/);
assert.match(view, /bindtap="askGuide"/);
assert.match(view, /\{\{currentQuestion\}\}/);
assert.match(view, /一次只聊一个主题/);
assert.match(view, /正在开发中，敬请期待/);
assert.match(view, /确认模块 1–4 报告后解锁/);
assert.match(view, /bindtap="confirmReport"/);
assert.match(view, /预览并保存 PDF/);
assert.match(view, /reportModules/);
assert.match(view, /reportPains/);
assert.doesNotMatch(view, /bindtap="chooseFiles"|bindtap="analyzeCurrent"|product-title-link/);
assert.doesNotMatch(view, /本步确认稿|让 AI 问第一题|当前开放进度/);
assert.doesNotMatch(questions, /门店类型与规模|美业老板/);
assert.doesNotMatch(view, /OpenAI|GPT|Structured/i);
assert.doesNotMatch(view, /<rich-text/);
console.log('ip12 full journey checks passed');
