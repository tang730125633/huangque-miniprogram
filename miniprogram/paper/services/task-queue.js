const LIMIT=15;
function collect(status){return [].concat(status&&Array.isArray(status.jobs)?status.jobs:[],status&&Array.isArray(status.deliveries)?status.deliveries.map(x=>x&&x.job).filter(Boolean):[]);}
function view(job,sid){
 const id=String(job&&(job.job_id||job.id)||'');if(!/^\d+$/.test(id)||Number(id)<=0)return null;
 const status=String(job.status||job.state||'unknown');
 const label=({pending:'排队中',queued:'排队中',running:'执行中',done:'已完成',failed:'失败',error:'失败',submitting:'提交中'})[status]||'状态待确认';
 const result=job.result&&typeof job.result==='object'?job.result:{};
 return {id,sid,status,label,terminal:['done','failed','error'].includes(status),name:String(job.title||job.prompt||result.prompt||'创作任务'),phase:String(job.phase||''),error:String(job.error||''),billing:job.refunded===true?'已退款':job.cost===0?'未扣点':'计费状态待确认',createdAt:Number(job.created_at)||0,result};
}
function merge(previous,jobs,sid){const map=new Map((previous||[]).filter(t=>t.sid===sid).map(t=>[t.id,t]));(jobs||[]).forEach(j=>{const t=view(j,sid);if(t)map.set(t.id,t);});return [...map.values()].sort((a,b)=>b.createdAt-a.createdAt||Number(b.id)-Number(a.id)).slice(0,LIMIT);}
module.exports={LIMIT,collect,view,merge};
