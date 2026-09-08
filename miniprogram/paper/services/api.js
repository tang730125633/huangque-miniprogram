const shared = require('../../utils/api');
const BASE = shared.getBase();
let identity = null;
function session() {
  const token=shared.getToken();
  return token ? {token,user:identity&&identity.token===token?identity.user:{username:''}} : null;
}
function rememberIdentity(token,user) {
  if(token!==shared.getToken())throw new Error('登录状态已变化，请重新加载');
  if(!user||typeof user.username!=='string'||!user.username)throw new Error('账号信息不完整，请重新登录');
  identity={token,user};
}
function setSession(value) {
  if(value){shared.setToken(value.token);rememberIdentity(value.token,value.user);}
  else{shared.clearToken();identity=null;}
}
async function request(path,method='GET',data,extra={}) {
  if(!/^\/api\//.test(path)&&!/^\/workbench\/ip12\/api\//.test(path))throw new Error('接口地址无效');
  let res;
  try {res=await shared.request(path,{method,data,timeout:extra.timeout,idempotencyKey:extra['Idempotency-Key'],redirectOn401:false});}
  catch(_){const e=new Error('网络连接中断，请检查网络和合法域名配置');e.uncertain=true;throw e;}
  const body=res.data;
  if(res.statusCode>=200&&res.statusCode<300&&body&&typeof body==='object')return body;
  const message=body&&(body.detail||body.message||body.error);
  const e=new Error(typeof message==='string'?message:'服务暂不可用，请稍后重试');
  Object.assign(e,{status:res.statusCode,code:body&&body.code,body,uncertain:res.statusCode>=200&&res.statusCode<300});throw e;
}
function login(){return Promise.reject(new Error('请使用黄雀统一登录页'));}
function localKey(){const s=session();if(s&&!s.user.username)throw new Error('正在核对账号，请稍后重试');return 'hq-paper-work-v1:'+(s?s.user.username:'guest');}
function read(){try{return wx.getStorageSync(localKey())||{};}catch(_){return {};}}
function save(patch){const key=localKey();const value=Object.assign({},read(),patch);wx.setStorageSync(key,value);return value;}
function mediaURL(value){if(typeof value!=='string')return '';if(/^\/(?!\/)/.test(value))return BASE+value;return /^https:\/\/[^\s]+$/i.test(value)?value:'';}
function protectedMedia(url){return url.indexOf(BASE+'/api/gen/file/')===0||url.indexOf(BASE+'/workbench/ip12/')===0;}
function mediaHeaders(url){const token=shared.getToken();return token&&protectedMedia(url)?{Authorization:'Bearer '+token}:{};}
function mediaSource(url){return protectedMedia(url)?shared.downloadProtected(url):Promise.resolve(url);}
module.exports={BASE,session,rememberIdentity,setSession,request,login,read,save,mediaURL,mediaHeaders,mediaSource};
