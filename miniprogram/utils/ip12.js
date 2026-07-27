'use strict';

const { MODULES } = require('./ip12_questions.js');

const MODULE_STEPS = MODULES.map((module) => module.steps.length);
const MODULE_NAMES = MODULES.map((module) => module.name);
const TOTAL_STEPS = MODULE_STEPS.reduce((sum, count) => sum + count, 0);
const ALLOWED_EXTENSIONS = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'csv', 'txt', 'md', 'png', 'jpg', 'jpeg', 'webp'];
const MAX_FILES = 6;
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const FIRST_MODULE_INDEX = 0;
const FIRST_STEP_INDEX = 0;
const FIRST_MODULE_NAME = MODULE_NAMES[0];
const FIRST_STEP_NAME = MODULES[0].steps[0].title;
const MIME_TYPES = {
  pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv', txt: 'text/plain', md: 'text/plain',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp'
};

function extension(name) {
  const match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

function isAllowedFile(file) {
  return !!file && ALLOWED_EXTENSIONS.indexOf(extension(file.name)) !== -1;
}

function mimeType(name) { return MIME_TYPES[extension(name)] || ''; }
function isWithinFileLimit(file) {
  const size = Number(file && file.size || 0);
  return size > 0 && size <= MAX_FILE_BYTES;
}

function keyFor(moduleIndex, stepIndex) { return String(moduleIndex) + '-' + String(stepIndex); }

function cursor(moduleIndex, stepIndex) {
  let mi = Number(moduleIndex);
  let si = Number(stepIndex);
  if (!Number.isInteger(mi) || mi < 0 || mi >= MODULES.length) mi = 0;
  if (!Number.isInteger(si) || si < 0 || si >= MODULES[mi].steps.length) si = 0;
  return { moduleIndex: mi, stepIndex: si };
}

function normalizeQuestionnaire(value) {
  const source = value && typeof value === 'object' ? value : {};
  const current = cursor(
    source.moduleIndex !== undefined ? source.moduleIndex : source.module_index,
    source.stepIndex !== undefined ? source.stepIndex : source.step_index
  );
  return syncDerived(Object.assign({}, source, current, {
    answers: Object.assign({}, source.answers || {})
  }));
}

function stepAt(moduleIndex, stepIndex) {
  const current = cursor(moduleIndex, stepIndex);
  return MODULES[current.moduleIndex].steps[current.stepIndex];
}

function answerText(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  if (value.text) return String(value.text);
  if (Array.isArray(value.choice)) return value.choice.join('、');
  return value.choice ? String(value.choice) : '';
}

function answerTextForStep(step, answer) {
  const value = answer || {};
  if (!step) return answerText(value);
  if (step.type === 'text') return String(value.text || '');
  if (step.type === 'single') return String(value.choice || '');
  if (step.type === 'multi') return Array.isArray(value.choice) ? value.choice.join('、') : '';
  return String(value.text || (step.preview || []).join('\n'));
}

function answerReady(step, answer) {
  if (!step) return false;
  if (step.type === 'review') return true;
  return !!answerTextForStep(step, answer).trim();
}

function syncDerived(questionnaireState) {
  const questionnaire = questionnaireState && typeof questionnaireState === 'object' ? questionnaireState : {};
  const answers = questionnaire.answers || {};
  const profile = Object.assign({}, questionnaire.profile || {});
  const completedModules = [];
  MODULES.forEach((module, moduleIndex) => {
    const complete = module.steps.every((step, stepIndex) => {
      const answer = answers[keyFor(moduleIndex, stepIndex)] || {};
      return answer.confirmed === true || answer.skipped === true;
    });
    if (!complete) {
      delete profile[module.id];
      return;
    }
    completedModules.push(module.id);
    const lastIndex = module.steps.length - 1;
    const lastAnswer = answers[keyFor(moduleIndex, lastIndex)] || {};
    if (lastAnswer.confirmed === true && !profile[module.id]) {
      profile[module.id] = {
        title: module.name,
        output: module.output,
        summary: answerTextForStep(module.steps[lastIndex], lastAnswer).slice(0, 180) || module.output
      };
    } else if (lastAnswer.skipped === true) {
      delete profile[module.id];
    }
  });
  questionnaire.completedModules = completedModules;
  questionnaire.profile = profile;
  return questionnaire;
}

function comparableAnswer(answer) {
  const value = answer || {};
  return JSON.stringify({ text: String(value.text || ''), choice: value.choice === undefined ? null : value.choice });
}

function editAnswer(questionnaireState, moduleIndex, stepIndex, patch) {
  const questionnaire = normalizeQuestionnaire(questionnaireState);
  const key = keyFor(moduleIndex, stepIndex);
  const previous = questionnaire.answers[key] && typeof questionnaire.answers[key] === 'object' ? questionnaire.answers[key] : {};
  const next = Object.assign({}, previous, patch || {});
  if (comparableAnswer(previous) !== comparableAnswer(next)) {
    next.confirmed = false;
    delete next.aiChoice;
  }
  questionnaire.answers[key] = next;
  return syncDerived(questionnaire);
}

function setAiChoice(questionnaireState, moduleIndex, stepIndex, candidateIndex) {
  const questionnaire = normalizeQuestionnaire(questionnaireState);
  const key = keyFor(moduleIndex, stepIndex);
  const previous = questionnaire.answers[key] && typeof questionnaire.answers[key] === 'object' ? questionnaire.answers[key] : {};
  questionnaire.answers[key] = Object.assign({}, previous, {
    aiChoice: Number(candidateIndex), confirmed: false, skipped: false
  });
  return syncDerived(questionnaire);
}

function markConfirmed(questionnaireState, moduleIndex, stepIndex) {
  const questionnaire = normalizeQuestionnaire(questionnaireState);
  const key = keyFor(moduleIndex, stepIndex);
  const previous = questionnaire.answers[key] && typeof questionnaire.answers[key] === 'object' ? questionnaire.answers[key] : {};
  questionnaire.answers[key] = Object.assign({}, previous, { confirmed: true, skipped: false });
  return syncDerived(questionnaire);
}

function markSkipped(questionnaireState, moduleIndex, stepIndex) {
  const questionnaire = normalizeQuestionnaire(questionnaireState);
  const key = keyFor(moduleIndex, stepIndex);
  const previous = questionnaire.answers[key] && typeof questionnaire.answers[key] === 'object' ? questionnaire.answers[key] : {};
  const next = Object.assign({}, previous, { confirmed: false, skipped: true });
  delete next.aiChoice;
  questionnaire.answers[key] = next;
  return syncDerived(questionnaire);
}

function withCursor(questionnaireState, moduleIndex, stepIndex) {
  return Object.assign(normalizeQuestionnaire(questionnaireState), cursor(moduleIndex, stepIndex));
}

function nextCursor(moduleIndex, stepIndex) {
  const current = cursor(moduleIndex, stepIndex);
  if (current.stepIndex < MODULES[current.moduleIndex].steps.length - 1) {
    return { moduleIndex: current.moduleIndex, stepIndex: current.stepIndex + 1 };
  }
  if (current.moduleIndex < MODULES.length - 1) return { moduleIndex: current.moduleIndex + 1, stepIndex: 0 };
  return current;
}

function previousCursor(moduleIndex, stepIndex) {
  const current = cursor(moduleIndex, stepIndex);
  if (current.stepIndex > 0) return { moduleIndex: current.moduleIndex, stepIndex: current.stepIndex - 1 };
  if (current.moduleIndex > 0) {
    const previousModule = current.moduleIndex - 1;
    return { moduleIndex: previousModule, stepIndex: MODULES[previousModule].steps.length - 1 };
  }
  return current;
}

function progress(questionnaireState) {
  const questionnaire = normalizeQuestionnaire(questionnaireState);
  let confirmed = 0;
  let skipped = 0;
  const skippedItems = [];
  MODULES.forEach((module, moduleIndex) => module.steps.forEach((step, stepIndex) => {
    const answer = questionnaire.answers[keyFor(moduleIndex, stepIndex)] || {};
    if (answer.confirmed === true) confirmed += 1;
    else if (answer.skipped === true) {
      skipped += 1;
      skippedItems.push({ moduleIndex, stepIndex, moduleName: module.name, moduleId: module.id, stepTitle: step.title });
    }
  }));
  return { total: TOTAL_STEPS, confirmed, skipped, progressed: confirmed + skipped,
    unresolved: TOTAL_STEPS - confirmed - skipped, skippedItems };
}

function moduleCards(questionnaireState, activeModuleIndex) {
  const questionnaire = normalizeQuestionnaire(questionnaireState);
  return MODULES.map((module, moduleIndex) => {
    let confirmed = 0;
    let skipped = 0;
    module.steps.forEach((step, stepIndex) => {
      const answer = questionnaire.answers[keyFor(moduleIndex, stepIndex)] || {};
      if (answer.confirmed === true) confirmed += 1;
      else if (answer.skipped === true) skipped += 1;
    });
    return { index: moduleIndex, id: module.id, name: module.name, steps: module.steps.length,
      confirmed, skipped, progressed: confirmed + skipped, active: moduleIndex === activeModuleIndex,
      done: confirmed + skipped === module.steps.length };
  });
}

function modules(completed) {
  let left = Math.max(0, Number(completed) || 0);
  return MODULES.map((module, index) => {
    const done = Math.min(module.steps.length, left);
    left -= done;
    return { index: index + 1, name: module.name, steps: module.steps.length, done };
  });
}

function currentAnswer(questionnaireState, lastAnalysis, moduleIndex, stepIndex) {
  const questionnaire = normalizeQuestionnaire(questionnaireState);
  const current = cursor(moduleIndex === undefined ? 0 : moduleIndex, stepIndex === undefined ? 0 : stepIndex);
  const answer = questionnaire.answers[keyFor(current.moduleIndex, current.stepIndex)];
  return answerTextForStep(stepAt(current.moduleIndex, current.stepIndex), answer) ||
    String(lastAnalysis && lastAnalysis.input && lastAnalysis.input.answer || '');
}

function mergeQuestionnaire(questionnaireState, answer, confirmed, candidateIndex) {
  let questionnaire = editAnswer(questionnaireState, 0, 0, { text: String(answer || '') });
  if (Number.isInteger(candidateIndex)) questionnaire = setAiChoice(questionnaire, 0, 0, candidateIndex);
  if (confirmed === true) questionnaire = markConfirmed(questionnaire, 0, 0);
  return questionnaire;
}

function confirmedStepCount(questionnaireState) { return progress(questionnaireState).confirmed; }

function analysisContext(questionnaireState, moduleIndex, stepIndex) {
  const questionnaire = normalizeQuestionnaire(questionnaireState);
  const current = cursor(moduleIndex === undefined ? 0 : moduleIndex, stepIndex === undefined ? 0 : stepIndex);
  const confirmed = [];
  Object.keys(questionnaire.answers).forEach((key) => {
    const answer = questionnaire.answers[key];
    if (!answer || answer.confirmed !== true) return;
    const parts = key.split('-').map(Number);
    const step = MODULES[parts[0]] && MODULES[parts[0]].steps[parts[1]];
    if (!step) return;
    const text = answerTextForStep(step, answer).slice(0, 1200);
    if (text) confirmed.push({ step: key, answer: text });
  });
  return { current_module: MODULES[current.moduleIndex].name,
    current_step: MODULES[current.moduleIndex].steps[current.stepIndex].title,
    confirmed_context: confirmed.slice(-12) };
}

function canGenerateReport(questionnaireState) { return progress(questionnaireState).unresolved === 0; }

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  return value < 1024 * 1024 ? Math.ceil(value / 1024) + ' KB' : (value / (1024 * 1024)).toFixed(1) + ' MiB';
}

function projectList(data) {
  if (Array.isArray(data)) return data;
  return (data && (data.items || data.projects)) || [];
}

function textList(value) {
  if (Array.isArray(value)) return value.map((item) => typeof item === 'string' ? item : (item.text || item.title || JSON.stringify(item)));
  if (!value) return [];
  return [typeof value === 'string' ? value : (value.text || value.title || JSON.stringify(value))];
}

function evidenceList(value) {
  const items = Array.isArray(value) ? value : (value ? [value] : []);
  return items.map((item) => {
    if (typeof item === 'string') return item;
    const file = item.file_name || item.filename || item.source || '未命名资料';
    const location = item.location || '未定位';
    const claim = item.claim || item.text || item.summary || '未提供主张';
    const evidence = item.evidence || item.quote || item.detail || '';
    return file + ' · ' + location + '：' + claim + (evidence ? '（证据：' + evidence + '）' : '');
  });
}

function analysisFromProject(project) {
  const current = project || {};
  const last = current.last_analysis || (current.state && current.state.last_analysis) || {};
  return last.analysis || last;
}

function planView(plan, type) {
  if (!plan) return { lines: [], prompt: '' };
  if (Array.isArray(plan)) return { lines: textList(plan), prompt: textList(plan)[0] || '' };
  if (typeof plan === 'string') return { lines: [plan], prompt: plan };
  const duration = plan.duration_seconds ? plan.duration_seconds + ' 秒' : plan.duration;
  const fields = type === 'video'
    ? [['目标', plan.goal], ['形式', plan.format], ['时长', duration], ['脚本方向', plan.script_direction], ['镜头', plan.shots], ['所需素材', plan.assets_needed], ['步骤', plan.steps]]
    : [['目标', plan.goal], ['提示词', plan.prompt], ['所需参考', plan.references_needed], ['步骤', plan.steps]];
  const lines = fields.reduce((list, pair) => {
    const value = pair[1];
    if (!value) return list;
    return list.concat(Array.isArray(value) ? value.map((item) => pair[0] + '：' + (typeof item === 'string' ? item : JSON.stringify(item))) : [pair[0] + '：' + value]);
  }, []);
  const videoPrompt = [plan.goal, plan.script_direction, Array.isArray(plan.shots) ? plan.shots.join('；') : plan.shots]
    .filter(Boolean).join('；');
  return { lines, prompt: type === 'video' ? videoPrompt : (plan.prompt || plan.goal || '') };
}

function productPrompt(pain, match) {
  const item = match || {};
  return [pain, item.fit_reason].concat(Array.isArray(item.execution_steps) ? item.execution_steps : [])
    .filter(Boolean).join('；').slice(0, 1800);
}

function productAction(productId) {
  if (productId === 'image_studio') return { type: 'image', label: '可点击跳转使用黄雀图片功能' };
  if (productId === 'video_studio') return { type: 'video', label: '可点击跳转使用黄雀视频功能' };
  if (productId === 'script_studio') return { type: 'script', label: '可点击跳转使用黄雀文案功能' };
  if (productId === 'voice_studio') return { type: 'audio', label: '可点击跳转使用黄雀音频功能' };
  if (productId === 'workflow_canvas') return { type: 'website', label: '可点击获取黄雀网站创作画布地址' };
  return { type: '', label: '' };
}

module.exports = {
  MODULES, MODULE_STEPS, MODULE_NAMES, TOTAL_STEPS, ALLOWED_EXTENSIONS, MAX_FILES, MAX_BYTES, MAX_FILE_BYTES,
  FIRST_MODULE_INDEX, FIRST_STEP_INDEX, FIRST_MODULE_NAME, FIRST_STEP_NAME, MIME_TYPES,
  extension, isAllowedFile, mimeType, isWithinFileLimit, keyFor, cursor, normalizeQuestionnaire, stepAt,
  answerText, answerTextForStep, answerReady, syncDerived, editAnswer, setAiChoice, markConfirmed, markSkipped, withCursor,
  nextCursor, previousCursor, progress, moduleCards, modules, currentAnswer, mergeQuestionnaire,
  confirmedStepCount, analysisContext, canGenerateReport, formatBytes, projectList, textList, evidenceList,
  analysisFromProject, planView, productPrompt, productAction
};
