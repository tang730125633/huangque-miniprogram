const assert = require('assert');
const fs = require('fs');
const ip12 = require('../miniprogram/utils/ip12.js');

assert.strictEqual(ip12.MODULES.length, 12);
assert.strictEqual(ip12.TOTAL_STEPS, 54);
const typeCounts = {};
ip12.MODULES.forEach((module) => module.steps.forEach((step) => {
  typeCounts[step.type] = (typeCounts[step.type] || 0) + 1;
  assert.ok(step.title && step.instruction && step.why);
}));
assert.deepStrictEqual(typeCounts, { text: 12, multi: 6, single: 18, review: 18 });

let questionnaire = ip12.normalizeQuestionnaire({});
assert.deepStrictEqual(ip12.progress(questionnaire), {
  total: 54, confirmed: 0, skipped: 0, progressed: 0, unresolved: 54, skippedItems: []
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
ip12.MODULES.forEach((module, moduleIndex) => module.steps.forEach((step, stepIndex) => {
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
assert.strictEqual(completed.progressed, 54);
assert.strictEqual(completed.unresolved, 0);
assert.strictEqual(ip12.canGenerateReport(questionnaire), true);
assert.strictEqual(questionnaire.completedModules.length, 12);

const lastOfFirst = ip12.previousCursor(1, 0);
assert.deepStrictEqual(lastOfFirst, { moduleIndex: 0, stepIndex: 4 });
assert.deepStrictEqual(ip12.nextCursor(0, 4), { moduleIndex: 1, stepIndex: 0 });

const page = fs.readFileSync('miniprogram/pages/ip12/ip12.js', 'utf8');
const view = fs.readFileSync('miniprogram/pages/ip12/ip12.wxml', 'utf8');
assert.match(page, /state: \{ questionnaire_state: questionnaire \}/);
assert.match(page, /revision: this\._project\.revision/);
assert.match(page, /res\.statusCode === 409/);
assert.match(page, /\/analyze'/);
assert.match(page, /\/confirm'/);
assert.match(page, /\/report'/);
assert.match(page, /downloadProtected\(this\.data\.reportPdfUrl\)/);
assert.match(page, /showMenu: true/);
assert.match(page, /method: 'POST', timeout: 150000, data: \{ revision: this\._project\.revision, consent: true \}/);
assert.match(view, /bindtap="previousStep"/);
assert.match(view, /bindtap="skipCurrent"/);
assert.match(view, /bindtap="confirmCurrent"/);
assert.match(view, /executive|reportSummary/);
assert.match(view, /行业痛点与黄雀产品匹配/);
assert.match(view, /行动阶段/);
assert.match(view, /复盘指标/);
assert.match(view, /资料缺口/);
assert.match(view, /bindtap="downloadReport"/);
assert.match(view, /预览并保存 PDF/);
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
