const test=require('node:test');
const assert=require('node:assert/strict');
let component;
global.wx={getStorageSync(){return null;},setStorageSync(){},showToast(){}};
global.getApp=()=>({globalData:{apiBase:'https://huangquechuanmei.com'}});
global.Component=value=>{component=value;};
require('../miniprogram/paper/components/screen/index');
function context(){
 const c=Object.create(component.methods);
 const widget={id:'template_catalog',key:'template_catalog@4',gen:4,type:'option_pick',title:'模板',items:[{id:'tpl',title:'模板甲'}]};
 c.data={busy:false,agentThinking:false,agentWidgets:[widget]};
 c.setData=patch=>{for(const [key,value] of Object.entries(patch)){const match=key.match(/^agentWidgets\[(\d+)\]\.(\w+)$/);if(match)c.data.agentWidgets[Number(match[1])][match[2]]=value;else c.data[key]=value;}};
 c.fail=error=>{throw error;};c.toast=()=>{};return c;
}
test('模板选项带真实卡片代次，只提交一次，成功后只读',async()=>{
 const c=context(),calls=[];let release;
 c.sendAgentMessage=(...args)=>{calls.push(args);return new Promise(resolve=>{release=resolve;});};
 const e={currentTarget:{dataset:{widget:0,option:0}}};
 const running=c.chooseAgentWidget(e);c.chooseAgentWidget(e);
 assert.equal(calls.length,1);
 assert.deepEqual(calls[0][2],{widget_type:'option_pick',widget_id:'template_catalog',gen:4,item_ids:['tpl']});
 release();await running;await c.chooseAgentWidget(e);
 assert.equal(calls.length,1);assert.equal(c.data.agentWidgets[0].consumed,true);
});
test('旧卡失效不恢复为可点，普通网络失败允许再试',async()=>{
 const c=context();c.sendAgentMessage=async()=>{const error=new Error('过期');error.status=409;throw error;};
 await c.submitAgentWidgetAction(0,c.data.agentWidgets[0].items);
 assert.equal(c.data.agentWidgets[0].consumed,true);
});
