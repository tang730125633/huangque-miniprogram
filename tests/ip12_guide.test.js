const assert = require('assert');
const fs = require('fs');

let page;
global.Page = (definition) => { page = definition; };
const api = require('../miniprogram/utils/api.js');
const ip12 = require('../miniprogram/utils/ip12.js');
require('../miniprogram/pages/ip12/ip12.js');
const view = fs.readFileSync('miniprogram/pages/ip12/ip12.wxml', 'utf8');
assert.match(view, /bindtap="resetGuideMemory">重置教练记忆/);
assert.match(view, /主站与小程序同步/);

const requests = [];
const initialQuestionnaire = ip12.normalizeQuestionnaire({
  answers: { '0-0': { text: '我做成过一件值得复盘的事。', confirmed: true } }
});
const project = { id: 'ip12-guide', revision: 4, state: { questionnaire_state: initialQuestionnaire } };
api.request = (path, options) => {
  requests.push({ path, options });
  if (path === '/api/gen/digital-ip/guide') {
    return Promise.resolve({ statusCode: 200, data: {
      ok: true,
      guide: { reply: '哪段经历最能代表你的能力？', suggested_answer: '我想从一次真实成果开始讲起。' }
    } });
  }
  if (path === '/api/gen/digital-ip/projects/ip12-guide') {
    return Promise.resolve({ statusCode: 200, data: { project: {
      id: 'ip12-guide', revision: 5, state: { questionnaire_state: options.data.state.questionnaire_state }
    } } });
  }
  throw new Error('unexpected request ' + path);
};

const context = {
  data: Object.assign({}, page.data, {
    moduleIndex: 0, stepIndex: 0, guideConsent: true, guideInput: '', busy: false, guideBusy: false
  }),
  _project: project,
  _questionnaire: initialQuestionnaire,
  setData(patch) { Object.assign(this.data, patch); },
  applyProject(nextProject) {
    this._project = nextProject;
    this._questionnaire = ip12.normalizeQuestionnaire(nextProject.state.questionnaire_state);
    const turns = this._questionnaire.guideTurns || [];
    const latest = turns.slice().reverse().find((turn) => turn.role === 'assistant') || {};
    this.setData({ revision: nextProject.revision, guideTurns: turns,
      guideSuggestedAnswer: latest.suggested_answer || latest.suggestedAnswer || '' });
    return nextProject;
  }
};
context.patchQuestionnaire = page.patchQuestionnaire;

(async () => {
  await page.askGuide.call(context, { currentTarget: { dataset: { message: '请开始问我吧。一次只问一个问题。' } } });
  assert.strictEqual(requests[0].path, '/api/gen/digital-ip/guide');
  assert.strictEqual(requests[0].options.method, 'POST');
  assert.strictEqual(requests[0].options.data.module, '定位诊断');
  assert.strictEqual(requests[0].options.data.consent, true);
  assert.strictEqual(requests[0].options.data.recent_turns.length, 0);
  assert.strictEqual(requests.filter((request) => /\/confirm$/.test(request.path)).length, 0);
  assert.strictEqual(context._questionnaire.answers['0-0'].text, '我做成过一件值得复盘的事。');
  assert.strictEqual(context._questionnaire.answers['0-0'].confirmed, true, 'guide must not change a confirmed answer');
  assert.strictEqual(context._questionnaire.guideTurns.length, 2);
  assert.strictEqual(context._questionnaire.guideTurns[1].content, '哪段经历最能代表你的能力？');
  assert.strictEqual(context._questionnaire.guideTurns[1].suggested_answer, '我想从一次真实成果开始讲起。');
  assert.strictEqual(context.data.busy, false);
  assert.strictEqual(context.data.guideBusy, false);

  let modal;
  global.wx = { showModal(options) { modal = options; options.success({ confirm: true }); } };
  context.data.guideInput = '尚未发送的临时输入';
  await page.resetGuideMemory.call(context);
  assert.match(modal.content, /同步到主站/);
  assert.match(modal.content, /不会删除已确认答案/);
  assert.strictEqual(requests[2].path, '/api/gen/digital-ip/projects/ip12-guide');
  assert.deepStrictEqual(requests[2].options.data.state.questionnaire_state.guideTurns, []);
  assert.strictEqual(context._questionnaire.answers['0-0'].text, '我做成过一件值得复盘的事。');
  assert.strictEqual(context._questionnaire.answers['0-0'].confirmed, true);
  assert.deepStrictEqual(context._questionnaire.guideTurns, []);
  assert.strictEqual(context.data.guideInput, '');
  assert.strictEqual(context.data.guideConsent, false);
  assert.match(context.data.note, /教练记忆已清除/);

  const syncContext = {
    data: Object.assign({}, page.data), _project: null, _questionnaire: ip12.normalizeQuestionnaire({}),
    setData(patch) { Object.assign(this.data, patch); }
  };
  page.applyProject.call(syncContext, {
    id: 'main-site-project', revision: 8,
    state: { questionnaire_state: ip12.normalizeQuestionnaire({ guideTurns: [
      { role: 'assistant', content: '来自主站的问题', suggested_answer: '来自主站的建议草稿', stepKey: '0-0' }
    ] }) }
  });
  assert.strictEqual(syncContext.data.guideTurns[0].content, '来自主站的问题');
  assert.strictEqual(syncContext.data.guideSuggestedAnswer, '来自主站的建议草稿');
  console.log('ip12 guide checks passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
