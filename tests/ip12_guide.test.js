const assert = require('assert');

let page;
global.Page = (definition) => { page = definition; };
const api = require('../miniprogram/utils/api.js');
const ip12 = require('../miniprogram/utils/ip12.js');
require('../miniprogram/pages/ip12/ip12.js');

const requests = [];
const project = { id: 'ip12-guide', revision: 4, state: { questionnaire_state: ip12.normalizeQuestionnaire({}) } };
api.request = (path, options) => {
  requests.push({ path, options });
  if (path === '/api/gen/digital-ip/guide') {
    return Promise.resolve({ statusCode: 200, data: {
      ok: true,
      guide: { reply: '你的门店最想服务哪类顾客？', suggested_answer: '我想服务重视长期改善的顾客。' }
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
  _questionnaire: ip12.normalizeQuestionnaire({}),
  setData(patch) { Object.assign(this.data, patch); },
  applyProject(nextProject) {
    this._project = nextProject;
    this._questionnaire = ip12.normalizeQuestionnaire(nextProject.state.questionnaire_state);
    this.setData({ revision: nextProject.revision, guideTurns: this._questionnaire.guideTurns || [] });
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
  assert.strictEqual(context._questionnaire.answers['0-0'], undefined, 'guide must not write or confirm an answer');
  assert.strictEqual(context._questionnaire.guideTurns.length, 2);
  assert.strictEqual(context._questionnaire.guideTurns[1].content, '你的门店最想服务哪类顾客？');
  assert.strictEqual(context._questionnaire.guideTurns[1].suggestedAnswer, '我想服务重视长期改善的顾客。');
  assert.strictEqual(context.data.busy, false);
  assert.strictEqual(context.data.guideBusy, false);
  console.log('ip12 guide checks passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
