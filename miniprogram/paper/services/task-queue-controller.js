const queue=require('./task-queue');
class Controller{
 constructor(options){this.o=options;this.epoch=0;this.timer=null;this.busy=false;this.started=0;}
 stop(){this.epoch++;clearTimeout(this.timer);this.timer=null;this.busy=false;this.started=0;this.pendingId=null;}
 async refresh(id){
  const {o}=this,scope=Object.assign({},o.scope());if(!scope.alive||!scope.visible||!scope.sid||!scope.token)return;
  if(this.busy){this.pendingId=id||this.pendingId;return;}
  clearTimeout(this.timer);this.timer=null;this.busy=true;const epoch=this.epoch;if(!this.started)this.started=Date.now();
  const valid=()=>{const s=o.scope();return epoch===this.epoch&&s.alive&&s.visible&&s.sid===scope.sid&&s.token===scope.token;};
  let retry=false;
  try{
   const status=await o.request('/workbench/ip12/api/v4/status/'+encodeURIComponent(scope.sid));if(!valid())return;
   let tasks=queue.merge(o.tasks(),queue.collect(status),scope.sid);
   if(id&&!tasks.some(t=>t.id===id))return;
   const ids=id?[id]:tasks.filter(t=>!t.terminal).map(t=>t.id);
   for(const taskId of ids){const job=await o.request('/api/gen/job/'+encodeURIComponent(taskId));if(!valid())return;tasks=queue.merge(tasks,[job],scope.sid);}
   if(valid()){o.update(tasks,false);retry=tasks.some(t=>!t.terminal);}
  }catch(error){
   const current=o.scope();
   if(epoch===this.epoch&&current.alive&&current.sid===scope.sid&&!current.token)o.update([],false);
   else if(valid()){if(error.status===401)o.update([],false);else{o.update(o.tasks(),true);retry=true;}}
  }finally{
   if(epoch===this.epoch){this.busy=false;if(valid()&&this.pendingId){const next=this.pendingId;this.pendingId=null;this.timer=setTimeout(()=>this.refresh(next),0);}else if(retry&&valid())this.timer=setTimeout(()=>this.refresh(),Date.now()-this.started>120000?15000:5000);}
  }
 }
}
module.exports=Controller;
