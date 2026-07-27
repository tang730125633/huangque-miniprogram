const assert = require('assert');
const ip12 = require('../miniprogram/utils/ip12.js');

assert.strictEqual(ip12.MODULE_STEPS.reduce((a, b) => a + b, 0), 54);
assert.deepStrictEqual(ip12.MODULE_STEPS, [5, 5, 5, 5, 4, 3, 3, 4, 5, 5, 5, 5]);
assert.deepStrictEqual(ip12.MODULE_NAMES, ['定位诊断', '人设塑造', '价值主张', '故事资产', '内容选题', '文案口播', 'IP 形象设计', '脚本分镜', '私域矩阵', '朋友圈运营', '销售与反馈', '公众号商业化']);
assert.strictEqual(ip12.FIRST_MODULE_INDEX, 0);
assert.strictEqual(ip12.FIRST_STEP_INDEX, 0);
assert.deepStrictEqual(ip12.analysisContext({ answers: { '0-0': { text: '门店底图', confirmed: true } } }), {
  current_module: '定位诊断', current_step: '采集门店经营底图',
  confirmed_context: [{ step: '0-0', answer: '门店底图' }]
});
assert.strictEqual(ip12.modules(6)[0].done, 5);
assert.strictEqual(ip12.modules(6)[1].done, 1);
assert.ok(ip12.isAllowedFile({ name: 'brief.PDF' }));
assert.ok(!ip12.isAllowedFile({ name: 'archive.zip' }));
assert.strictEqual(ip12.MAX_FILES, 6);
assert.strictEqual(ip12.MAX_BYTES, 20 * 1024 * 1024);
assert.strictEqual(ip12.MAX_FILE_BYTES, 8 * 1024 * 1024);
assert.strictEqual(ip12.mimeType('brief.pdf'), 'application/pdf');
assert.strictEqual(ip12.mimeType('brief.doc'), 'application/msword');
assert.strictEqual(ip12.mimeType('brief.docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
assert.strictEqual(ip12.mimeType('slides.pptx'), 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
assert.strictEqual(ip12.mimeType('sheet.xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
assert.strictEqual(ip12.mimeType('list.csv'), 'text/csv');
assert.strictEqual(ip12.mimeType('photo.webp'), 'image/webp');
assert.ok(ip12.isWithinFileLimit({ size: ip12.MAX_FILE_BYTES }));
assert.ok(!ip12.isWithinFileLimit({ size: ip12.MAX_FILE_BYTES + 1 }));
assert.ok(!ip12.isWithinFileLimit({ size: 0 }));
const merged = ip12.mergeQuestionnaire({ answers: { '1-0': { text: '保留', confirmed: true } } }, '模块一回答', true, 2);
assert.strictEqual(merged.answers['1-0'].text, '保留');
assert.deepStrictEqual(merged.answers['0-0'], { text: '模块一回答', confirmed: true, aiChoice: 2 });
assert.strictEqual(ip12.currentAnswer(merged), '模块一回答');
assert.strictEqual(ip12.confirmedStepCount(merged, 'confirmed'), 2);
assert.strictEqual(ip12.evidenceList([{ file_name: 'brief.docx', location: '未定位', claim: '客群是店主', evidence: '第 2 页' }])[0], 'brief.docx · 未定位：客群是店主（证据：第 2 页）');
assert.deepStrictEqual(ip12.analysisFromProject({ last_analysis: { analysis: { positioning_candidates: [{ title: 'A' }] } } }), { positioning_candidates: [{ title: 'A' }] });
assert.deepStrictEqual(ip12.planView({ goal: '建立信任', prompt: '品牌人像，暖光', references_needed: ['门店照'], steps: ['生成首帧'] }, 'image'), { lines: ['目标：建立信任', '提示词：品牌人像，暖光', '所需参考：门店照', '步骤：生成首帧'], prompt: '品牌人像，暖光' });
assert.deepStrictEqual(ip12.planView({ goal: '讲案例', format: '9:16', duration_seconds: 15, shots: ['前三秒抛问题'], steps: ['生成视频'] }, 'video'), { lines: ['目标：讲案例', '形式：9:16', '时长：15 秒', '镜头：前三秒抛问题', '步骤：生成视频'], prompt: '讲案例；前三秒抛问题' });
console.log('ip12 helper checks passed');
