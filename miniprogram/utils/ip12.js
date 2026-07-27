const MODULE_STEPS = [5, 5, 5, 5, 4, 3, 3, 4, 5, 5, 5, 5];
const MODULE_NAMES = ['定位诊断', '人设塑造', '价值主张', '故事资产', '内容选题', '文案口播', 'IP 形象设计', '脚本分镜', '私域矩阵', '朋友圈运营', '销售与反馈', '公众号商业化'];
const ALLOWED_EXTENSIONS = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'csv', 'txt', 'md', 'png', 'jpg', 'jpeg', 'webp'];
const MAX_FILES = 6;
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const FIRST_MODULE_INDEX = 0;
const FIRST_STEP_INDEX = 0;
const FIRST_MODULE_NAME = '定位诊断';
const FIRST_STEP_NAME = '采集门店经营底图';
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

function answerText(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  if (value.text) return String(value.text);
  if (Array.isArray(value.choice)) return value.choice.join('、');
  return value.choice ? String(value.choice) : '';
}

function currentAnswer(questionnaireState, lastAnalysis) {
  const questionnaire = questionnaireState || {};
  const answers = questionnaire.answers || {};
  return answerText(answers['0-0']) || answerText(answers.module_1_step_1) ||
    String(questionnaire.module_1_step_1 || '') || String(lastAnalysis && lastAnalysis.input && lastAnalysis.input.answer || '');
}

function mergeQuestionnaire(questionnaireState, answer, confirmed, candidateIndex) {
  const questionnaire = Object.assign({}, questionnaireState || {});
  const answers = Object.assign({}, questionnaire.answers || {});
  const previous = answers['0-0'] && typeof answers['0-0'] === 'object' ? answers['0-0'] : {};
  const sameAnswer = answerText(previous) === String(answer || '');
  answers['0-0'] = Object.assign({}, previous, {
    text: String(answer || ''),
    confirmed: confirmed === true ? true : (sameAnswer && previous.confirmed === true)
  });
  if (Number.isInteger(candidateIndex)) answers['0-0'].aiChoice = candidateIndex;
  questionnaire.answers = answers;
  return questionnaire;
}

function confirmedStepCount(questionnaireState, projectStatus) {
  const answers = (questionnaireState && questionnaireState.answers) || {};
  const count = Object.keys(answers).filter((key) => {
    const answer = answers[key];
    return answer && typeof answer === 'object' && answer.confirmed === true;
  }).length;
  return Math.min(54, Math.max(count, projectStatus === 'confirmed' && currentAnswer(questionnaireState) ? 1 : 0));
}

function analysisContext(questionnaireState) {
  const answers = (questionnaireState && questionnaireState.answers) || {};
  const confirmed = Object.keys(answers).filter((key) => answers[key] && answers[key].confirmed === true).slice(-12).map((key) => ({
    step: key,
    answer: answerText(answers[key]).slice(0, 1200)
  })).filter((item) => item.answer);
  return { current_module: FIRST_MODULE_NAME, current_step: FIRST_STEP_NAME, confirmed_context: confirmed };
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  return value < 1024 * 1024 ? Math.ceil(value / 1024) + ' KB' : (value / (1024 * 1024)).toFixed(1) + ' MiB';
}

function modules(completed) {
  let left = Math.max(0, Number(completed) || 0);
  return MODULE_STEPS.map((steps, index) => {
    const done = Math.min(steps, left);
    left -= done;
    return { index: index + 1, name: MODULE_NAMES[index], steps, done };
  });
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

module.exports = { MODULE_STEPS, MODULE_NAMES, ALLOWED_EXTENSIONS, MAX_FILES, MAX_BYTES, MAX_FILE_BYTES, FIRST_MODULE_INDEX, FIRST_STEP_INDEX, FIRST_MODULE_NAME, FIRST_STEP_NAME, MIME_TYPES, extension, isAllowedFile, mimeType, isWithinFileLimit, answerText, currentAnswer, mergeQuestionnaire, confirmedStepCount, analysisContext, formatBytes, modules, projectList, textList, evidenceList, analysisFromProject, planView };
