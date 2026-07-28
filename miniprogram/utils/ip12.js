'use strict';

const { MODULES } = require('./ip12_questions.js');

const MODULE_STEPS = MODULES.map((module) => module.steps.length);
const MODULE_NAMES = MODULES.map((module) => module.name);
const INTERVIEW_VERSION = 2;
const ACTIVE_MODULE_COUNT = 6;
const FOUNDATION_MODULE_COUNT = 4;
const ACTIVE_MODULES = MODULES.slice(0, ACTIVE_MODULE_COUNT);
const ACTIVE_MODULE_STEPS = ACTIVE_MODULES.map((module) => module.steps.length);
const TOTAL_STEPS = ACTIVE_MODULE_STEPS.reduce((sum, count) => sum + count, 0);

function keyFor(moduleIndex, stepIndex) { return String(moduleIndex) + '-' + String(stepIndex); }

function isOpenModuleIndex(moduleIndex) {
  return Number.isInteger(Number(moduleIndex)) && Number(moduleIndex) >= 0 && Number(moduleIndex) < ACTIVE_MODULE_COUNT;
}

function writableCursor(moduleIndex, stepIndex) {
  const mi = Number(moduleIndex);
  const si = Number(stepIndex);
  if (!isOpenModuleIndex(mi) || !Number.isInteger(si) || si < 0 || si >= MODULES[mi].steps.length) return null;
  return { moduleIndex: mi, stepIndex: si };
}

function cursor(moduleIndex, stepIndex) {
  let mi = Number(moduleIndex);
  let si = Number(stepIndex);
  if (!isOpenModuleIndex(mi)) mi = 0;
  if (!Number.isInteger(si) || si < 0 || si >= MODULES[mi].steps.length) si = 0;
  return { moduleIndex: mi, stepIndex: si };
}

function normalizeQuestionnaire(value) {
  const candidate = value && typeof value === 'object' ? value : {};
  const source = candidate.interviewVersion === INTERVIEW_VERSION ? candidate : {};
  const current = cursor(
    source.moduleIndex !== undefined ? source.moduleIndex : source.module_index,
    source.stepIndex !== undefined ? source.stepIndex : source.step_index
  );
  return syncDerived(Object.assign({}, source, current, {
    interviewVersion: INTERVIEW_VERSION,
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

function syncDerived(questionnaireState) {
  const questionnaire = questionnaireState && typeof questionnaireState === 'object' ? questionnaireState : {};
  const answers = questionnaire.answers || {};
  const profile = Object.assign({}, questionnaire.profile || {});
  const completedModules = [];
  ACTIVE_MODULES.forEach((module, moduleIndex) => {
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
      const summary = module.steps.map((step, stepIndex) => {
        const answer = answers[keyFor(moduleIndex, stepIndex)] || {};
        return String(answer.keywords || answerTextForStep(step, answer)).trim();
      }).filter(Boolean).join('；').slice(0, 180);
      profile[module.id] = {
        title: module.name,
        output: module.output,
        summary: summary || module.output
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
  const current = writableCursor(moduleIndex, stepIndex);
  if (!current) return questionnaire;
  const key = keyFor(current.moduleIndex, current.stepIndex);
  const previous = questionnaire.answers[key] && typeof questionnaire.answers[key] === 'object' ? questionnaire.answers[key] : {};
  const next = Object.assign({}, previous, patch || {});
  if (comparableAnswer(previous) !== comparableAnswer(next)) {
    next.confirmed = false;
    delete next.aiChoice;
  }
  questionnaire.answers[key] = next;
  return syncDerived(questionnaire);
}

function markConfirmed(questionnaireState, moduleIndex, stepIndex) {
  const questionnaire = normalizeQuestionnaire(questionnaireState);
  const current = writableCursor(moduleIndex, stepIndex);
  if (!current) return questionnaire;
  const key = keyFor(current.moduleIndex, current.stepIndex);
  const previous = questionnaire.answers[key] && typeof questionnaire.answers[key] === 'object' ? questionnaire.answers[key] : {};
  questionnaire.answers[key] = Object.assign({}, previous, { confirmed: true, skipped: false });
  return syncDerived(questionnaire);
}

function markSkipped(questionnaireState, moduleIndex, stepIndex) {
  const questionnaire = normalizeQuestionnaire(questionnaireState);
  const current = writableCursor(moduleIndex, stepIndex);
  if (!current) return questionnaire;
  const key = keyFor(current.moduleIndex, current.stepIndex);
  const previous = questionnaire.answers[key] && typeof questionnaire.answers[key] === 'object' ? questionnaire.answers[key] : {};
  const next = Object.assign({}, previous, { confirmed: false, skipped: true });
  delete next.aiChoice;
  questionnaire.answers[key] = next;
  return syncDerived(questionnaire);
}

function withCursor(questionnaireState, moduleIndex, stepIndex) {
  return Object.assign(normalizeQuestionnaire(questionnaireState), cursor(moduleIndex, stepIndex));
}

function nextCursor(moduleIndex, stepIndex, contentUnlocked) {
  const current = cursor(moduleIndex, stepIndex);
  if (current.stepIndex < MODULES[current.moduleIndex].steps.length - 1) {
    return { moduleIndex: current.moduleIndex, stepIndex: current.stepIndex + 1 };
  }
  if (current.moduleIndex === FOUNDATION_MODULE_COUNT - 1 && contentUnlocked !== true) return current;
  if (current.moduleIndex < ACTIVE_MODULES.length - 1) return { moduleIndex: current.moduleIndex + 1, stepIndex: 0 };
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
  ACTIVE_MODULES.forEach((module, moduleIndex) => module.steps.forEach((step, stepIndex) => {
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

function foundationProgress(questionnaireState) {
  const questionnaire = normalizeQuestionnaire(questionnaireState);
  let confirmed = 0;
  let skipped = 0;
  ACTIVE_MODULES.slice(0, FOUNDATION_MODULE_COUNT).forEach((module, moduleIndex) => {
    module.steps.forEach((step, stepIndex) => {
      const answer = questionnaire.answers[keyFor(moduleIndex, stepIndex)] || {};
      if (answer.confirmed === true) confirmed += 1;
      else if (answer.skipped === true) skipped += 1;
    });
  });
  const total = ACTIVE_MODULE_STEPS.slice(0, FOUNDATION_MODULE_COUNT).reduce((sum, count) => sum + count, 0);
  return { total, confirmed, skipped, progressed: confirmed + skipped, unresolved: total - confirmed - skipped };
}

function foundationStage(project) {
  return project && project.foundation_stage && typeof project.foundation_stage === 'object'
    ? project.foundation_stage : { status: 'missing', stale: false };
}

function foundationReady(project) {
  const stage = foundationStage(project);
  return stage.status === 'confirmed' && stage.stale !== true;
}

function isModuleUnlocked(moduleIndex, project) {
  const index = Number(moduleIndex);
  return isOpenModuleIndex(index) && (index < FOUNDATION_MODULE_COUNT || foundationReady(project));
}

function moduleCards(questionnaireState, activeModuleIndex, project) {
  const questionnaire = normalizeQuestionnaire(questionnaireState);
  return MODULES.map((module, moduleIndex) => {
    let confirmed = 0;
    let skipped = 0;
    if (moduleIndex < ACTIVE_MODULE_COUNT) module.steps.forEach((step, stepIndex) => {
      const answer = questionnaire.answers[keyFor(moduleIndex, stepIndex)] || {};
      if (answer.confirmed === true) confirmed += 1;
      else if (answer.skipped === true) skipped += 1;
    });
    const comingSoon = moduleIndex >= ACTIVE_MODULE_COUNT;
    const locked = !comingSoon && moduleIndex >= FOUNDATION_MODULE_COUNT && !foundationReady(project);
    return { index: moduleIndex, id: module.id, name: module.name, steps: Number(module.plannedSteps || module.steps.length),
      confirmed, skipped, progressed: confirmed + skipped, active: moduleIndex === activeModuleIndex,
      done: !comingSoon && confirmed + skipped === module.steps.length, comingSoon, locked };
  });
}

function canGenerateReport(questionnaireState) { return foundationProgress(questionnaireState).unresolved === 0; }

function projectList(data) {
  if (Array.isArray(data)) return data;
  return (data && (data.items || data.projects)) || [];
}

function textList(value) {
  if (Array.isArray(value)) return value.map((item) => typeof item === 'string' ? item : (item.text || item.title || JSON.stringify(item)));
  if (!value) return [];
  return [typeof value === 'string' ? value : (value.text || value.title || JSON.stringify(value))];
}

module.exports = {
  MODULES, MODULE_STEPS, MODULE_NAMES, INTERVIEW_VERSION, ACTIVE_MODULE_COUNT, FOUNDATION_MODULE_COUNT,
  ACTIVE_MODULES, ACTIVE_MODULE_STEPS, TOTAL_STEPS,
  keyFor, isOpenModuleIndex, writableCursor, cursor, normalizeQuestionnaire, stepAt,
  answerText, answerTextForStep, syncDerived, editAnswer, markConfirmed, markSkipped, withCursor,
  nextCursor, previousCursor, progress, foundationProgress, foundationStage, foundationReady, isModuleUnlocked,
  moduleCards, canGenerateReport, projectList, textList
};
