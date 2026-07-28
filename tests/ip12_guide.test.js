const assert = require('assert');
const fs = require('fs');

let page;
global.Page = (definition) => { page = definition; };
const api = require('../miniprogram/utils/api.js');
const ip12 = require('../miniprogram/utils/ip12.js');
require('../miniprogram/pages/ip12/ip12.js');

const view = fs.readFileSync('miniprogram/pages/ip12/ip12.wxml', 'utf8');
assert.match(view, /一次只聊一个问题/);
assert.match(view, /bindtap="askGuide"/);
assert.doesNotMatch(view, /让 AI 问第一题/);

const requests = [];
let guideCount = 0;
let revision = 4;
const initialQuestionnaire = ip12.normalizeQuestionnaire({ interviewVersion: 2, answers: {} });
const project = {
  id: 'ip12-guide', revision,
  foundation_stage: { status: 'missing', stale: false },
  state: { questionnaire_state: initialQuestionnaire }
};

api.request = (path, options) => {
  requests.push({ path, options });
  if (path === '/api/gen/digital-ip/guide') {
    guideCount += 1;
    if (guideCount === 1) {
      return Promise.resolve({ statusCode: 200, data: { ok: true, guide: {
        reply: '我记下了，还想确认一个细节。',
        follow_up_questions: ['你希望我在报告里怎么称呼你？'],
        suggested_answer: '常用称呼待补充'
      } } });
    }
    return Promise.resolve({ statusCode: 200, data: { ok: true, guide: {
      reply: '好的，已经记下。', follow_up_questions: [], suggested_answer: '唐老师'
    } } });
  }
  if (path === '/api/gen/digital-ip/projects/ip12-guide') {
    revision += 1;
    return Promise.resolve({ statusCode: 200, data: { project: {
      id: 'ip12-guide', revision,
      foundation_stage: { status: 'missing', stale: false },
      state: { questionnaire_state: options.data.state.questionnaire_state }
    } } });
  }
  throw new Error('unexpected request ' + path);
};

const context = {
  data: Object.assign({}, page.data, {
    moduleIndex: 0, stepIndex: 0, guideConsent: true, guideInput: '我平时用唐老师这个称呼',
    busy: false, guideBusy: false, atFoundationGate: false, flowComplete: false
  }),
  _project: project,
  _questionnaire: initialQuestionnaire,
  setData(patch) { Object.assign(this.data, patch); },
  applyProject(nextProject) {
    this._project = nextProject;
    this._questionnaire = ip12.normalizeQuestionnaire(nextProject.state.questionnaire_state);
    this.data.revision = nextProject.revision;
    this.data.moduleIndex = this._questionnaire.moduleIndex;
    this.data.stepIndex = this._questionnaire.stepIndex;
    this.data.atFoundationGate = false;
    this.data.flowComplete = false;
    return nextProject;
  }
};
context.patchQuestionnaire = page.patchQuestionnaire;

(async () => {
  await page.askGuide.call(context, { currentTarget: { dataset: {} } });
  assert.strictEqual(requests[0].path, '/api/gen/digital-ip/guide');
  assert.strictEqual(requests[0].options.method, 'POST');
  assert.strictEqual(requests[0].options.data.module, '定位诊断');
  assert.strictEqual(requests[0].options.data.step, '姓名或昵称');
  assert.strictEqual(requests[0].options.data.consent, true);
  assert.strictEqual(requests[0].options.data.recent_turns.length, 0);
  assert.strictEqual(context._questionnaire.answers['0-0'].text, '我平时用唐老师这个称呼');
  assert.strictEqual(context._questionnaire.answers['0-0'].keywords, '常用称呼待补充');
  assert.strictEqual(context._questionnaire.answers['0-0'].suggested_answer, '常用称呼待补充');
  assert.strictEqual(context._questionnaire.answers['0-0'].confirmed, false, 'one follow-up must stay on the current field');
  assert.deepStrictEqual({ moduleIndex: context.data.moduleIndex, stepIndex: context.data.stepIndex }, { moduleIndex: 0, stepIndex: 0 });
  assert.strictEqual(context._questionnaire.guideTurns.length, 3, 'first exchange includes the visible interview question');
  assert.match(context._questionnaire.guideTurns[2].content, /怎么称呼你/);
  assert.match(context.data.note, /继续回答/);

  context.data.guideInput = '报告里就叫我唐老师';
  await page.askGuide.call(context, { currentTarget: { dataset: {} } });
  assert.strictEqual(requests[2].path, '/api/gen/digital-ip/guide');
  assert.strictEqual(requests[2].options.data.recent_turns.length, 3);
  assert.strictEqual(context._questionnaire.answers['0-0'].text, '我平时用唐老师这个称呼\n报告里就叫我唐老师');
  assert.strictEqual(context._questionnaire.answers['0-0'].keywords, '唐老师');
  assert.strictEqual(context._questionnaire.answers['0-0'].confirmed, true, 'no follow-up auto-confirms the field');
  assert.deepStrictEqual({ moduleIndex: context.data.moduleIndex, stepIndex: context.data.stepIndex }, { moduleIndex: 0, stepIndex: 1 });
  assert.strictEqual(context._questionnaire.interviewVersion, 2);
  assert.match(context.data.note, /继续下一题/);
  assert.strictEqual(context.data.busy, false);
  assert.strictEqual(context.data.guideBusy, false);

  const patchRequests = requests.filter((request) => request.path === '/api/gen/digital-ip/projects/ip12-guide');
  assert.strictEqual(patchRequests.length, 2);
  assert.ok(patchRequests.every((request) => request.options.data.state.questionnaire_state.interviewVersion === 2));
  console.log('ip12 guide checks passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
