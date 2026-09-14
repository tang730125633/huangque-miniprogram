const LIMIT=15;
function collect(status){return [].concat(status&&Array.isArray(status.jobs)?status.jobs:[],status&&Array.isArray(status.deliveries)?status.deliveries.map(x=>x&&x.job).filter(Boolean):[]);}
function view(job,sid,previous){
 const id=String(job&&(job.job_id||job.id)||'');if(!/^\d+$/.test(id)||Number(id)<=0)return null;
 const old=previous&&previous.sid===sid&&previous.id===id?previous:{};
 const status=String(job.status||job.state||old.status||'unknown');
 const label=({pending:'排队中',queued:'排队中',running:'执行中',done:'已完成',failed:'失败',error:'失败',submitting:'提交中'})[status]||'状态待确认';
 const has=k=>Object.prototype.hasOwnProperty.call(job,k);
 const result=job.result&&typeof job.result==='object'?job.result:old.result||{};
 const billing=has('refunded')?job.refunded===true?'已退款':job.cost===0?'未扣点':'计费状态待确认':job.cost===0?'未扣点':old.billing||'计费状态待确认';
 return {id,sid,status,label,terminal:['done','failed','error'].includes(status),kind:job.kind||old.kind||'',name:String(job.title||job.prompt||result.prompt||old.name||'创作任务'),phase:has('phase')?String(job.phase||''):old.phase||'',error:has('error')?String(job.error||''):old.error||'',billing,createdAt:has('created_at')?Number(job.created_at)||0:old.createdAt||0,result};
}
function merge(previous,jobs,sid){const map=new Map((previous||[]).filter(t=>t.sid===sid).map(t=>[t.id,t]));(jobs||[]).forEach(j=>{const id=String(j&&(j.job_id||j.id)||'');const t=view(j,sid,map.get(id));if(t)map.set(t.id,t);});return [...map.values()].sort((a,b)=>b.createdAt-a.createdAt||Number(b.id)-Number(a.id)).slice(0,LIMIT);}
module.exports={LIMIT,collect,view,merge};
