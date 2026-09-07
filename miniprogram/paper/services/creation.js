const api = require('./api');
const formats = [
  { id: 'image', name: '图片', endpoint: 'image', rule: 'image.openai.std', detail: '1 张图片 · 标准画质' },
  { id: 'audio', name: '音频', endpoint: 'audio', rule: 'audio.tts', detail: '按输入文稿配音 · 最多 1000 字' },
  { id: 'video', name: '视频', endpoint: 'xiaole_video', rule: 'video.minimax_h3.768p', detail: '5 秒视频 · 2K · 竖屏' },
  { id: 'text', name: '文案', endpoint: 'copy', rule: 'text.copy', detail: '1 份文案' }
];
function format(id) { const f = formats.find(x => x.id === id); if (!f) throw new Error('作品类型无效'); return f; }
function payload(draft) {
  const f = format(draft.kind), prompt = String(draft.prompt || '').trim();
  if (!prompt || prompt.length > 1000) throw new Error('请填写 1–1000 字创作内容');
  const p = { prompt };
  if (f.id === 'image') Object.assign(p, { provider: 'openai', quality: 'standard', count: 1, ratio: '1:1' });
  if (f.id === 'video') Object.assign(p, { channel: 'minimax', operation: 'generate', duration: 5, resolution: '2k', ratio: '9:16' });
  if (f.id === 'audio') {
    if (!draft.voice) throw new Error('请先选择音色');
    Object.assign(p, { text: prompt, voice: draft.voice, speed: 1 });
  }
  if (draft.reference) {
    if (f.id !== 'image' && f.id !== 'text') throw new Error('当前参考图仅用于图片与文案创作');
    p.reference_images = [draft.reference];
  }
  return p;
}
async function quote(draft) {
  payload(draft);
  const f = format(draft.kind);
  const [prices, identity] = await Promise.all([api.request('/api/gen/pricing'), api.request('/api/auth/me')]);
  const row = (prices.items || []).find(x => x.key === f.rule);
  if (!row || typeof row.points !== 'number' || row.points < 0) throw new Error('暂时无法取得价格，请稍后重试');
  const cost = row.points * (f.id === 'video' ? 5 : 1);
  return { cost, balance: identity.user.points, user: identity.user, detail: f.detail, kind: f.id };
}
let submitting = false;
async function submit(draft, confirmedCost, recover = false) {
  if (submitting) throw new Error('请求正在提交，请稍候');
  const identity = api.session(); if (!identity) throw new Error('请先登录');
  const owner = identity.user.username;
  const assertOwner = () => { if (!api.session() || api.session().user.username !== owner) throw new Error('登录状态已变化，请重新确认'); };
  submitting = true;
  try {
    let attempt = api.read().attempt;
    if (attempt && ['submitting', 'unknown'].includes(attempt.status) && !recover) throw new Error('上次提交结果尚未确认，请先恢复上次任务');
    if (!recover) {
      const q = await quote(draft); assertOwner();
      if (q.cost !== confirmedCost) { const e = new Error('价格已更新，请重新查看并确认'); e.code = 'price_changed'; throw e; }
      if (q.balance < q.cost) throw new Error('积分不足，请先查看会员与积分');
      attempt = { key: 'paper-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2), status: 'submitting', endpoint: format(draft.kind).endpoint, kind: draft.kind, body: payload(draft), cost: q.cost };
      api.save({ attempt, draft });
    } else if (!attempt || !['submitting', 'unknown'].includes(attempt.status)) throw new Error('没有待恢复的提交');
    assertOwner();
    let result;
    try { result = await api.request('/api/gen/' + attempt.endpoint, 'POST', attempt.body, { 'Idempotency-Key': attempt.key }); }
    catch (e) {
      assertOwner();
      // Keep the same key after an uncertain response; never silently start another paid request.
      attempt.status = e.uncertain || e.status >= 500 || e.status === 409 ? 'unknown' : 'rejected';
      attempt.error = e.message;
      if (e.body && e.body.job_id) result = e.body;
      else { api.save({ attempt }); throw e; }
    }
    assertOwner();
    const id = result.job_id || result.id;
    if (!id) { attempt.status = 'unknown'; api.save({ attempt }); throw new Error('任务回执不完整，请恢复上次提交'); }
    attempt.status = 'accepted'; attempt.jobId = id;
    const ids = api.read().jobIds || [];
    api.save({ attempt, selected: { id, kind: attempt.kind }, jobIds: [id].concat(ids.filter(x => x !== id)).slice(0,60) });
    return { id, kind: attempt.kind };
  } finally { submitting = false; }
}
function jobView(job, fallbackKind) {
  const result = job.result && typeof job.result === 'object' ? job.result : {};
  const kind = ({ copy: 'text', xiaole_video: 'video' })[job.kind] || job.kind || fallbackKind || 'image';
  const urls = (Array.isArray(result.urls) ? result.urls : [result.url]).map(api.mediaURL).filter(Boolean);
  return { id: job.id || job.job_id, kind, status: job.status, title: result.prompt || job.prompt || format(['image','audio','video','text'].includes(kind) ? kind : 'video').name + '作品', urls,
    url: urls[0] || '', text: result.text || '', cost: job.cost, refunded: job.refunded === true,
    error: job.error || '', done: job.status === 'done', failed: ['error','failed'].includes(job.status),
    label: ({done:'已完成',error:'生成失败',failed:'生成失败',pending:'排队中',running:'生成中'})[job.status] || '正在查询' };
}
module.exports = { formats, format, payload, quote, submit, jobView };
