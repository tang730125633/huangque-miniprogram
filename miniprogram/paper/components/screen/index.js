const pages = require('./pages');
const api = require('../../services/api');
const creation = require('../../services/creation');
const titles = {}; pages.forEach(p => { titles[p.id] = p.title; });
const emptyCard = { name: '', headline: '', company: '', bio: '', email: '', address: '', email_public: false, address_public: false, works: [] };
const IP12_API = '/workbench/ip12/api/v4';
const IP12_SESSION_KEY = 'hq-v4-session-id';
const IP12_NEW_SESSION = '__new__';
const AGENT_MESSAGE_LIMIT = 30;
const AGENT_IMAGE_LIMIT = 10;
const AGENT_ATTACHMENT_LIMIT = 10;
const AGENT_QUICK_PHRASES = ['帮我做一张商品图','帮我做一条短视频','帮我写一段文案','看看我的 IP 报告','我不太会用，请一步一步教我'];
const AGENT_QUICK_KEY_PREFIX = 'hq-agent-quick-phrases-v1:';
function cleanAgentQuickPhrases(value) {
  const items=Array.isArray(value)?value:[];
  return items.map(item=>String(item||'').trim().replace(/\s+/g,' ')).filter((item,index,list)=>item.length>=2&&item.length<=40&&!AGENT_QUICK_PHRASES.includes(item)&&list.indexOf(item)===index).slice(0,8);
}
async function agentRead(path) {
  try{return await api.request(path);}
  catch(error){
    if(!error.uncertain&&error.status<500)throw error;
    await new Promise(resolve=>setTimeout(resolve,1800));
    return api.request(path);
  }
}
function mediaFromContent(value) {
  const content=String(value||''),images=[],videos=[],known=[];
  (content.match(/(?:https?:\/\/|\/api\/v4\/)[^\s<>"']+/g)||[]).forEach(raw=>{
    const url=raw.replace(/[)）\]}>*_，。；;]+$/,'');
    if(/\.(?:jpe?g|png|webp|gif)(?:[?#]|$)/i.test(url)){images.push(url);known.push(url);}
    else if(/\.(?:mp4|mov|webm|m3u8)(?:[?#]|$)|\/api\/v4\/render\/[0-9a-f]{32}(?:[?#]|$)/i.test(url)){videos.push(url);known.push(url);}
  });
  const clean=known.reduce((text,url)=>text.split(url).join(''),content).replace(/\[([^\]]*)\]\(\s*\)/g,'$1').replace(/<\s*>/g,'');
  return {
    content:clean.split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!/^(?:成片|成片链接|视频|视频链接|模板小样|小样视频|预览视频|缩略图)[：:]?$/.test(line.replace(/[)）\]}>*_，。；;]+$/,''))).join('\n').trim(),
    images:[...new Set(images)], videos:[...new Set(videos)]
  };
}
function ip12MediaPath(value) {
  const raw=String(value||'');
  return /^\/?api\/v4\//.test(raw)?'/workbench/ip12/'+raw.replace(/^\//,''):raw;
}
function agentMessages(items) {
  return (Array.isArray(items)?items:[]).map((item,index)=>{
    const media=mediaFromContent(item&&item.content);
    return {
      domId:'agent-message-'+index,
      role:item&&item.role==='user'?'user':'assistant', content:media.content,
      images:[...new Set((Array.isArray(item&&item.images)?item.images:[]).concat(media.images))],
      videos:media.videos, attachments:[]
    };
  });
}
function limitAgentImages(items) {
  let remaining=AGENT_IMAGE_LIMIT,total=0;
  items.forEach(item=>{total+=(item.images||[]).length;});
  for(let i=items.length-1;i>=0;i--){
    const images=items[i].images||[];
    items[i].images=remaining>0?images.slice(0,remaining):[];
    remaining-=items[i].images.length;
  }
  return Math.max(0,total-AGENT_IMAGE_LIMIT);
}
function agentSessionLabel(item) {
  const preview=String(item&&item.preview||'').replace(/\s+/g,' ').trim();
  const turns=Math.max(0,Number(item&&item.turns||0));
  return preview?'继续：'+preview.slice(0,18)+(turns?'（'+turns+'轮）':''):'继续上次对话';
}
function videoHeight(ratio) {
  if(['16:9','3:2','21:9','5:4'].includes(String(ratio||'')))return 390;
  if(String(ratio||'')==='1:1')return 686;
  return 980;
}
function videoWork(item) {
  const jobId=Number(item.job_id)||0;
  const status=String(item.status||'done');
  return {
    key:'video-'+(jobId||'asset-'+item.id), id:jobId||item.id, jobId, assetOnly:!jobId,
    kind:'video', status, title:item.text||'视频作品', url:api.mediaURL(item.video_url),
    coverFile:item.image_file||'', ratio:item.ratio||'', videoHeight:videoHeight(item.ratio),
    done:['done','completed'].includes(status), failed:['error','failed'].includes(status),
    label:['done','completed'].includes(status)?'已完成':['error','failed'].includes(status)?'生成失败':'正在处理'
  };
}
function delegationCards(value) {
  return Object.keys(value&&typeof value==='object'?value:{}).map(domain=>{
    const item=value[domain]||{},quote=item.quote||{};
    return {
      key:domain+':'+String(item.quote_id||item.state||''),
      domain, state:item.state||'', summary:item.summary||'',
      quoteId:item.quote_id||'', cost:quote.cost, points:quote.points,
      needsApproval:item.state==='needs_approval'
    };
  }).filter(item=>item.needsApproval);
}
Component({
  properties: { pageId: { type: String, value: 'home' } },
  data: {
    title: '', statusTop: 24, navHeight: 48, safeRight: 104, chatNavOffset: 72, user: null, busy: false, loading: false, error: '',
    promptInput: '', kind: 'image', formats: creation.formats, kindName: '图片', formatDetail: creation.formats[0].detail,
    username: '', password: '', consent: false, quote: null, attempt: null, job: null,
    works: [], visibleWorks: [], search: '', filter: 'all', hasMore: false,
    filters: [{id:'all',name:'全部'}, ...creation.formats],
    workFilters: [{id:'all',name:'全部'},{id:'processing',name:'进行中'},{id:'done',name:'已完成'},{id:'failed',name:'失败'}],
    card: emptyCard, publicCard: null, points: [], pointFilter: 'all', invite: null, voices: [], voice: '', voiceName: '',
    referencePath: '', chatView: 'proposal', scriptOpen: false, stopped: false,
    agentMessages: [], agentSessionId: '', agentSessions: [], agentTargetLabel: '新对话', agentPending: null, agentScrollTarget: '', agentThinking: false, agentProgress: '',
    agentDelegations: [], agentReport: {}, agentHiddenCount: 0, agentImageHiddenCount: 0,
    agentAttachments: [], agentAssets: [], agentAssetsOpen: false, agentIpDrawerOpen: false, agentSheet: '', agentQuickPhrases: AGENT_QUICK_PHRASES, agentHasText: false,
    notifications: { finished: true, failed: true, activity: false },
    notificationItems: [{key:'finished',title:'作品完成提醒'},{key:'failed',title:'任务异常提醒'},{key:'activity',title:'产品与活动消息'}],
    feedbackInput: '', feedbackType: '体验建议', feedbackSent: false, openFaq: -1,
    helpItems: [
      {q:'怎样开始一次创作？',a:'在首页直接说你想做什么就行。不知道怎么说，可以先点一条常用问题，黄雀会一步一步问你。'},
      {q:'生成失败后，积分会怎样？',a:'任务状态和退回状态分别显示。仅当服务端确认退回时显示已退回；重试前需再次确认。'},
      {q:'网络中断后要重新发送吗？',a:'先点“检查是否已经发送”。如果记录里已经有这句话，就不要再发；没有找到时，文字会留在输入框里。'},
      {q:'谁能看到我的作品和联系方式？',a:'创作记录按账号隔离。名片只有发布后才公开，邮箱与地址由你分别控制。'}
    ]
  },
  lifetimes: {
    attached() {
      this.alive = true; this.visible = true;
      let statusTop=24, navHeight=48, safeRight=104;
      try { const w=wx.getWindowInfo(); const c=wx.getMenuButtonBoundingClientRect(); statusTop=w.statusBarHeight||24; navHeight=Math.max(44,(c.top-statusTop)*2+c.height); safeRight=w.windowWidth-c.left+12; } catch (_) {}
      const draft=api.read().draft||{}; this.reference=draft.reference||''; this.agentDraft=draft.prompt||'';
      const f=creation.formats.find(f=>f.id===draft.kind)||creation.formats[0];
      this.setData({title:titles[this.properties.pageId],statusTop,navHeight,safeRight,chatNavOffset:statusTop+navHeight,promptInput:draft.prompt||'',agentHasText:Boolean(String(draft.prompt||'').trim()),kind:f.id,kindName:f.name,formatDetail:f.detail,voice:draft.voice||'',referencePath:draft.reference||'',attempt:api.read().attempt||null,notifications:api.read().notifications||this.data.notifications});
      this.load();
    },
    detached() { this.alive=false; clearTimeout(this.timer);if(this.audio)this.audio.destroy(); }
  },
  pageLifetimes: { show() { this.visible=true; if(this.alive)this.load(); }, hide() { this.visible=false; clearTimeout(this.timer);if(this.audio)this.audio.pause(); } },
  methods: {
    toast(title) { wx.showToast({title,icon:'none'}); },
    fail(error) { if(!this.alive)return; const patch={error:error.message||'暂时无法完成，请重试'};if(error.status===401)Object.assign(patch,{user:null,works:[],visibleWorks:[],job:null,card:emptyCard,publicCard:null,points:[]});this.setData(patch); },
    async run(fn) { if(this.data.busy)return;this.setData({busy:true,error:''});try { return await fn(); }catch(e){this.fail(e);}finally{if(this.alive)this.setData({busy:false});} },
    async load() {
      if(this.loading)return;this.loading=true;
      const token=api.session()&&api.session().token;
      const valid=()=>this.alive&&token===(api.session()&&api.session().token);
      this.setData({loading:true,error:'',user:api.session()&&api.session().user,attempt:api.read().attempt||null});
      if(this.owner&&(!api.session()||api.session().user.username!==this.owner)){this.agentDraft='';this.setData({works:[],visibleWorks:[],job:null,card:emptyCard,publicCard:null,points:[],promptInput:'',referencePath:'',attempt:null,agentMessages:[],agentSessionId:'',agentSessions:[],agentTargetLabel:'新对话',agentPending:null,agentDelegations:[],agentReport:{},agentAttachments:[],agentAssets:[],agentAssetsOpen:false,agentIpDrawerOpen:false,agentSheet:'',agentQuickPhrases:AGENT_QUICK_PHRASES,agentHasText:false});}
      const page=this.properties.pageId;
      try {
        if(!token || page==='login')return;
        const identity=await api.request('/api/auth/me');if(!valid())return;
        api.rememberIdentity(token,identity.user);
        const saved=api.read();
        if(!this.owner||this.owner!==identity.user.username){this.owner=identity.user.username;const d=saved.draft||{};const f=creation.formats.find(x=>x.id===d.kind)||creation.formats[0];this.reference=d.reference||'';this.setData({promptInput:d.prompt||'',kind:f.id,kindName:f.name,formatDetail:f.detail,voice:d.voice||'',referencePath:d.reference||'',attempt:saved.attempt||null});}
        this.setData({user:identity.user});
        if(page==='home')await Promise.all([this.loadWorks(valid),this.loadAgent(valid)]);
        else if(['works','messages','card-works'].includes(page))await this.loadWorks(valid);
        else if(page==='chat')await this.loadAgent(valid);
        if(['card','card-edit','privacy','card-works','card-public'].includes(page)) {
          const data=await api.request('/api/auth/card/me?create=0').catch(e=>{if(e.status===404)return {card:null};throw e;}); if(valid())this.setData({card:Object.assign({},emptyCard,data.card||{}),publicCard:null});
          if(page==='card-public'&&data.card&&data.card.published) { const pub=await api.request('/api/auth/card/public?id='+encodeURIComponent(data.card.public_id));if(valid())this.setData({publicCard:pub.card||null}); }
        }
        if(page==='points') { const data=await api.request('/api/gen/points/history?page_size=50');if(valid())this.setData({points:(data.items||[]).map(x=>Object.assign({},x,{date:new Date(x.created_at*1000).toLocaleDateString()}))}); }
        if(page==='invite') { const data=await api.request('/api/invite/dashboard');if(valid())this.setData({invite:data}); }
        if(page==='membership'||page==='benefits') { const data=await api.request('/api/gen/pricing');if(valid())this.setData({prices:(data.items||[]).filter(p=>p.key.startsWith('membership.'))}); }
        if(page==='confirm')await this.loadQuote();
        if(['processing','failed','image-detail','audio-detail','video-detail','text-detail'].includes(page))await this.refreshJob();
      } catch(e){if(this.alive)this.fail(e);} finally {this.loading=false;if(this.alive)this.setData({loading:false});}
    },
    async loadAgent(valid=()=>this.alive) {
      const data=await agentRead(IP12_API+'/sessions');
      if(!valid())return;
      const sessions=Array.isArray(data.sessions)?data.sessions:[];
      const local=api.read(),pending=local.ip12Pending||null,waiting=local.ip12Waiting||null,outgoing=local.ip12Outgoing||null;
      const saved=wx.getStorageSync(IP12_SESSION_KEY),forceNew=saved===IP12_NEW_SESSION||(this.properties.pageId==='chat'&&outgoing&&outgoing.newConversation);
      const wantedSid=outgoing&&outgoing.sid||saved;
      const current=forceNew?null:(sessions.find(item=>item.sid===wantedSid)||sessions[0]);
      this.setData({agentSessions:sessions.slice(0,8)});
      if(current&&this.properties.pageId==='chat')await this.restoreAgent(current.sid,valid);
      else if(current){wx.setStorageSync(IP12_SESSION_KEY,current.sid);this.setData({agentSessionId:current.sid,agentTargetLabel:agentSessionLabel(current)});}
      else this.setData({agentMessages:[],agentSessionId:'',agentTargetLabel:'新对话',agentDelegations:[],agentReport:{}});
      if(!valid())return;
      this.setData({agentPending:pending,agentThinking:!!waiting,agentProgress:waiting?'正在恢复处理进度…':''});
      if(this.properties.pageId==='chat'&&waiting&&waiting.sid===this.data.agentSessionId)setTimeout(()=>this.run(()=>this.pollAgent(waiting.sid,waiting.seq)),0);
      else if(this.properties.pageId==='chat'&&outgoing&&outgoing.status==='queued'){
        this.agentDraft=outgoing.message||'';this.setData({promptInput:this.agentDraft});
        if(Date.now()-Number(outgoing.createdAt||0)<=5*60*1000)setTimeout(()=>this.sendAgent(false),0);
        else{api.save({ip12Outgoing:null});this.setData({error:'上次没有发送的文字已保留，请确认后再点发送'});}
      }
    },
    async restoreAgent(sid,valid=()=>this.alive) {
      const switching=sid!==this.data.agentSessionId;
      const data=await agentRead(IP12_API+'/restore/'+encodeURIComponent(sid)+'?limit='+AGENT_MESSAGE_LIMIT);
      if(!valid())return;
      const items=agentMessages(data.history);
      const imageHidden=limitAgentImages(items);
      for(const item of items){
        const resolve=raw=>api.mediaSource(api.mediaURL(ip12MediaPath(raw))).catch(()=>'');
        if(item.images.length)item.images=(await Promise.all(item.images.map(resolve))).filter(Boolean);
        if(item.videos.length)item.videos=(await Promise.all(item.videos.map(resolve))).filter(Boolean);
      }
      if(!valid())return;
      wx.setStorageSync(IP12_SESSION_KEY,sid);
      this.setData(Object.assign({agentMessages:items,agentSessionId:sid,agentDelegations:delegationCards(data.delegations),agentReport:data.report||null,agentHiddenCount:Math.max(0,Number(data.history_total||items.length)-items.length),agentImageHiddenCount:imageHidden},switching?{agentAttachments:[],agentAssets:[],agentAssetsOpen:false}:{}));
      this.scrollAgent(items);
    },
    scrollAgent(items=this.data.agentMessages) {
      const last=items[items.length-1];
      if(last)setTimeout(()=>{if(this.alive)this.setData({agentScrollTarget:last.domId});},30);
    },
    async loadWorks(valid=()=>this.alive) {
      const page=this.properties.pageId,limit=page==='home'?6:120;
      const kinds=['image','copy','audio'];
      const [responses,videos]=await Promise.all([
        Promise.all(kinds.map(kind=>api.request('/api/gen/history?kind='+kind+'&include_failed=1&limit='+limit))),
        api.request('/api/gen/video/assets?limit='+limit)
      ]);
      const batches=responses.map((r,index)=>(r.items||[]).map(x=>Object.assign(creation.jobView(Object.assign({},x,{kind:kinds[index],result:{url:x.url,text:x.text,prompt:x.prompt}})),{key:'job-'+(x.id||x.job_id)})));
      batches.push((videos.items||[]).map(videoWork));
      const map=new Map();batches.flat().forEach(j=>map.set(j.key||'job-'+j.id,j));
      const pending=api.read().jobIds||[];
      const knownJobs=new Set([...map.values()].map(item=>Number(item.jobId||item.id)).filter(Boolean));
      const tracked=await Promise.all(pending.slice(0,12).filter(id=>!knownJobs.has(Number(id))).map(id=>api.request('/api/gen/job/'+encodeURIComponent(id)).then(job=>Object.assign(creation.jobView(job),{key:'job-'+id})).catch(e=>{if(e.status===404)return null;throw e;})));
      tracked.filter(Boolean).forEach(j=>map.set(j.key,j));
      const works=[...map.values()].sort((a,b)=>Number(b.jobId||b.id||0)-Number(a.jobId||a.id||0));
      const images=(page==='home'?works.slice(0,3):page==='messages'?[]:works).filter(j=>j.kind==='image'&&j.url);
      for(let i=0;i<images.length;i+=4)await Promise.all(images.slice(i,i+4).map(async j=>{j.displayUrl=await api.mediaSource(j.url).catch(()=> '');}));
      const covers=(page==='home'?works.slice(0,3):page==='messages'?[]:works).filter(j=>j.kind==='video'&&j.coverFile);
      for(let i=0;i<covers.length;i+=4)await Promise.all(covers.slice(i,i+4).map(async j=>{j.displayCover=await api.mediaSource(api.mediaURL('/api/gen/file/'+j.coverFile)).catch(()=>'');}));
      if(valid()){this.setData({works,hasMore:page==='works'&&batches.some(b=>b.length>=limit)});this.applyFilter();}
    },
    field(e) { const key=e.currentTarget.dataset.field;if(['promptInput','username','password','feedbackInput','search'].includes(key)){this.setData({[key]:e.detail.value});if(key==='search')this.applyFilter();} },
    agentInput(e){const text=String(e.detail&&e.detail.value||'');this.agentDraft=text;const hasText=Boolean(text.trim());if(this.data&&hasText!==this.data.agentHasText)this.setData({agentHasText:hasText});},
    voiceUnavailable(){this.toast('语音功能暂未开放');},
    agentQuickKey(){const session=api.session(),username=session&&session.user&&session.user.username||this.data.user&&this.data.user.username||'guest';return AGENT_QUICK_KEY_PREFIX+username;},
    agentCustomPhrases(){try{return cleanAgentQuickPhrases(wx.getStorageSync(this.agentQuickKey()));}catch(_){return[];}},
    openAgentQuickPhrases(){this.setData({agentSheet:'phrases',agentAssetsOpen:false,agentIpDrawerOpen:false,agentQuickPhrases:AGENT_QUICK_PHRASES.concat(this.agentCustomPhrases())});},
    chooseAgentQuickPhrase(e){const text=this.data.agentQuickPhrases[Number(e.currentTarget.dataset.index)];if(!text)return;this.agentDraft=text;this.setData({promptInput:text,agentSheet:'',agentHasText:true});},
    addAgentQuickPhrase(){
      const custom=this.agentCustomPhrases();
      if(custom.length>=8)return this.toast('最多保存 8 条自定义短语');
      wx.showModal({title:'自定义快捷短语',editable:true,placeholderText:'例如：帮我把这段内容整理得更简单',confirmText:'保存',success:result=>{
        if(!result.confirm)return;
        const text=String(result.content||'').trim().replace(/\s+/g,' ');
        if(text.length<2)return this.toast('请至少输入两个字');
        if(text.length>40)return this.toast('最多输入 40 个字');
        if(AGENT_QUICK_PHRASES.includes(text)||custom.includes(text))return this.toast('这条短语已经存在');
        try{wx.setStorageSync(this.agentQuickKey(),custom.concat(text));this.setData({agentQuickPhrases:AGENT_QUICK_PHRASES.concat(custom,text)});this.toast('已保存');}catch(_){this.toast('当前设备无法保存');}
      }});
    },
    openAgentTools(){this.setData({agentSheet:'tools',agentAssetsOpen:false,agentIpDrawerOpen:false});},
    closeAgentSheet(){this.setData({agentSheet:'',agentAssetsOpen:false});},
    keepAgentSheet(){},
    openAgentAvatar(){this.closeAgentSheet();wx.navigateTo({url:'/pages/clone/clone'});},
    cardField(e) {const key=e.currentTarget.dataset.field;if(['name','headline','company','bio','email','address'].includes(key))this.setData({['card.'+key]:e.detail.value});},
    openLegacy(e){const routes={recharge:'/pages/recharge/recharge',invite:'/pages/invite/invite',card:'/pages/my-card/my-card',inspiration:'/pages/inspiration/inspiration',ip12:'/pages/ip12/ip12'};const url=routes[e.currentTarget.dataset.legacy];if(url)wx.navigateTo({url});},
    homeShortcut(e){this.setData({promptInput:e.currentTarget.dataset.prompt||''});},
    go(e){this.navigate(e.currentTarget.dataset.route);},
    navigate(id){if(!pages.some(p=>p.id===id))return;if(id==='login'){wx.navigateTo({url:'/pages/login/login?redirect=paper'});return;}const url='/paper/pages/'+id+'/index';if(['home','works','profile'].includes(id))wx.reLaunch({url});else wx.navigateTo({url,fail:()=>wx.redirectTo({url})});},
    back(){if(getCurrentPages().length>1)wx.navigateBack();else this.navigate('home');},
    requireLogin(){if(api.session())return true;this.navigate('login');return false;},
    consentChange(e){this.setData({consent:e.detail.value.includes('agree')});},
    login(){this.run(async()=>{if(!this.data.consent)throw new Error('请阅读并同意账号登录说明');if(!this.data.username.trim()||!this.data.password)throw new Error('请填写账号与密码');await api.login(this.data.username,this.data.password);this.setData({password:''});this.navigate('home');});},
    logout(){this.run(async()=>{try{await api.request('/api/auth/logout','POST',{});}catch(_){}api.setSession(null);this.setData({user:null,password:'',works:[],card:emptyCard});this.navigate('login');});},
    chooseKind(e){const kind=e.currentTarget.dataset.kind;const f=creation.format(kind);this.setData({kind,kindName:f.name,formatDetail:f.detail,quote:null});if(kind==='audio'&&api.session())this.run(()=>this.loadVoices());},
    draft(){return {kind:this.data.kind,prompt:this.data.promptInput,voice:this.data.voice,reference:this.reference||''};},
    startChat(){
      if(!this.requireLogin())return;
      const message=this.data.promptInput.trim();
      if(!message)return this.toast('请先写一句想说的话');
      const sid=this.data.agentSessionId||'';
      api.save({ip12Outgoing:{message,sid,newConversation:!sid,status:'queued',createdAt:Date.now()}});
      this.navigate('chat');
    },
    chooseHomeAgentTarget(){
      const sessions=this.data.agentSessions||[];
      const labels=['＋ 开始新对话'].concat(sessions.map(item=>((item.sid===this.data.agentSessionId?'当前 · ':'')+(item.preview||'以前的对话').replace(/\s+/g,' ')+(item.turns?' · '+item.turns+'轮':'')).slice(0,28)));
      wx.showActionSheet({itemList:labels,success:result=>{if(result.tapIndex===0)return this.useNewHomeAgentSession();const item=sessions[result.tapIndex-1];if(item){wx.setStorageSync(IP12_SESSION_KEY,item.sid);this.setData({agentSessionId:item.sid,agentTargetLabel:agentSessionLabel(item)});}}});
    },
    useNewHomeAgentSession(){
      wx.setStorageSync(IP12_SESSION_KEY,IP12_NEW_SESSION);
      this.setData({agentSessionId:'',agentTargetLabel:'新对话'});
    },
    sendPrompt(){return this.sendAgent(false);},
    sendAgent() {
      if(!this.requireLogin())return;
      if(this.data.agentThinking)return this.toast('黄雀还在回复，你可以先把下一句话写好');
      const attached=this.data.agentAttachments||[];
      const message=String(this.agentDraft===undefined?this.data.promptInput:this.agentDraft).trim()||(attached.length?'请查看我发送的素材：'+attached.slice(0,3).map(item=>item.name).join('、')+(attached.length>3?'等 '+attached.length+' 个文件':''):'');
      if(!message)return this.toast('请先写一句想说的话');
      return this.sendAgentMessage(message);
    },
    async ensureAgentSession() {
      if(this.data.agentSessionId)return this.data.agentSessionId;
      const started=await api.request(IP12_API+'/start','POST',{});
      const sid=String(started.session_id||'');
      if(!sid)throw new Error('暂时无法开始对话，请稍后重试');
      wx.setStorageSync(IP12_SESSION_KEY,sid);
      this.setData({agentSessionId:sid});
      return sid;
    },
    sendAgentMessage(message,approval) {
      return this.run(async()=>{
        const sid=await this.ensureAgentSession();
        const body={session_id:sid,message:String(message||'').trim()};
        const attachments=approval?[]:(this.data.agentAttachments||[]).slice();
        if(attachments.length)body.attachments=attachments.map(item=>item.fileId);
        if(approval)body.approval=approval;
        const pending={sid,body,attachments,status:'sending',createdAt:Date.now()};
        api.save({ip12Pending:pending,ip12Outgoing:null});if(!approval)this.agentDraft='';this.setData({agentPending:pending,agentThinking:true,promptInput:approval?this.data.promptInput:'',agentHasText:approval?this.data.agentHasText:false,agentAttachments:[],agentAssetsOpen:false,agentIpDrawerOpen:false,agentSheet:'',agentMessages:this.data.agentMessages.concat({domId:'agent-local-'+Date.now(),role:'user',content:body.message,images:[],videos:[],attachments})});
        this.scrollAgent();
        await this.executeAgent(pending);
      });
    },
    async executeAgent(pending) {
      let data;
      try {
        data=await api.request(IP12_API+'/chat','POST',pending.body);
      } catch(error) {
        this.agentDraft=pending.body.message;
        if(error.uncertain||!error.status||error.status>=500){pending.status='unknown';api.save({ip12Pending:pending});this.setData({agentPending:pending,agentThinking:false,agentProgress:'',promptInput:pending.body.message,agentHasText:true,agentAttachments:pending.attachments||[]});}
        else{api.save({ip12Pending:null});this.setData({agentPending:null,agentThinking:false,agentProgress:'',promptInput:pending.body.message,agentHasText:true,agentAttachments:pending.attachments||[]});}
        throw error;
      }
      if(!data.async||data.seq===undefined){this.agentDraft=pending.body.message;pending.status='unknown';api.save({ip12Pending:pending});this.setData({agentPending:pending,agentThinking:false,agentProgress:'',promptInput:pending.body.message,agentHasText:true,agentAttachments:pending.attachments||[]});throw new Error(data.error||'主 Agent 回执不完整，请先检查是否已经发送');}
      api.save({ip12Pending:null,ip12Waiting:{sid:pending.sid,seq:data.seq}});
      this.setData({agentPending:null,agentThinking:true,agentProgress:'正在理解你的要求…'});
      this.agentPoll=this.pollAgent(pending.sid,data.seq).catch(error=>this.fail(error));
    },
    async updateAgentProgress(sid){
      let status;
      try{status=await api.request(IP12_API+'/status/'+encodeURIComponent(sid),'GET',null,{timeout:5000});}catch(_){return;}
      if(!this.alive||!this.data.agentThinking)return;
      const active=(status.turns||[]).filter(item=>item.state==='working').sort((a,b)=>Number(b.elapsed||0)-Number(a.elapsed||0))[0]||{};
      const elapsed=Math.max(0,Math.floor(Number(active.elapsed||0)));
      const domain=String(status.tool&&status.tool.domain||'');
      const labels={compose:'正在整理视频方案…',image:'正在处理图片…',collect:'正在读取素材…',copy:'正在整理文案…',audio:'正在处理声音…',video:'正在处理视频…'};
      const text=labels[domain]||'正在理解你的要求…';
      this.setData({agentProgress:text+(elapsed>=3?' 已等待 '+elapsed+' 秒':'')});
    },
    async pollAgent(sid,target,tries=0) {
      if(!this.alive)return;
      if(tries>=240){api.save({ip12Waiting:null});this.setData({agentThinking:false,agentProgress:''});throw new Error('处理时间较长，稍后重新打开会自动恢复结果');}
      let data;
      try{data=await api.request(IP12_API+'/poll/'+encodeURIComponent(sid));}
      catch(error){if(error.status&&error.status<500)throw error;data={state:'working'};}
      if(data.state==='done'||data.state==='error'){
        if(Number(data.seq)>=Number(target)){
          api.save({ip12Waiting:null});
          await this.restoreAgent(sid);
          if(this.alive)this.setData({agentThinking:false,agentProgress:''});
          return;
        }
      }
      if(data.state==='idle'&&tries>=3){
        api.save({ip12Waiting:null});
        await this.restoreAgent(sid);
        if(this.alive)this.setData({agentThinking:false,agentProgress:''});
        throw new Error('后台没有找到刚才的处理结果，请重新发送');
      }
      if(tries%2===0)await this.updateAgentProgress(sid);
      await new Promise(resolve=>{this.agentTimer=setTimeout(resolve,2500);});
      return this.pollAgent(sid,target,tries+1);
    },
    retryAgent(){
      const pending=this.data.agentPending||api.read().ip12Pending;
      if(!pending||!pending.body)return this.load();
      return this.run(async()=>{
        await this.restoreAgent(pending.sid);
        const found=this.data.agentMessages.some(item=>item.role==='user'&&item.content===pending.body.message);
        this.agentDraft=found?'':pending.body.message;api.save({ip12Pending:null});this.setData({agentPending:null,agentThinking:false,agentProgress:'',promptInput:this.agentDraft,agentHasText:Boolean(this.agentDraft),agentAttachments:found?[]:(pending.attachments||[]),error:found?'':'刚才这句话没有送达，请再点一次发送'});
      });
    },
    newAgentConversation(){
      if(this.data.busy||this.data.agentThinking)return;
      wx.showModal({title:'开始新对话？',content:'以前的对话不会删除，之后仍可查看。',confirmText:'开始',success:result=>{if(result.confirm)this.run(()=>this.startNewAgent());}});
    },
    async startNewAgent(){
      const started=await api.request(IP12_API+'/start','POST',{}),sid=String(started.session_id||'');
      if(!sid||started.seq===undefined)throw new Error('暂时无法开始新对话，请稍后重试');
      wx.setStorageSync(IP12_SESSION_KEY,sid);api.save({ip12Pending:null,ip12Waiting:{sid,seq:started.seq},ip12Outgoing:null});
      this.agentDraft='';this.setData({agentSessionId:sid,agentMessages:[],promptInput:'',agentHasText:false,agentAttachments:[],agentAssets:[],agentAssetsOpen:false,agentIpDrawerOpen:false,agentSheet:'',agentDelegations:[],agentReport:{},agentHiddenCount:0,agentImageHiddenCount:0,agentThinking:true,agentProgress:'正在准备新对话…',agentSessions:[{sid,preview:'新对话'}].concat((this.data.agentSessions||[]).filter(item=>item.sid!==sid)).slice(0,8)});
      this.agentPoll=this.pollAgent(sid,started.seq).catch(error=>this.fail(error));
    },
    addAgentAttachment(item){
      const items=this.data.agentAttachments||[];
      if(items.length>=AGENT_ATTACHMENT_LIMIT)return this.toast('一次最多发送 10 个素材');
      if(items.some(entry=>entry.fileId===item.fileId))return;
      this.setData({agentAttachments:items.concat(item)});
    },
    chooseAgentMedia(e){
      if(this.data.busy||this.data.agentThinking)return;
      const kind=e.currentTarget.dataset.kind;
      this.setData({agentSheet:''});
      wx.chooseMedia({count:kind==='image'?Math.max(1,AGENT_ATTACHMENT_LIMIT-(this.data.agentAttachments||[]).length):1,mediaType:[kind],sizeType:['compressed'],sourceType:['album','camera'],maxDuration:60,success:result=>this.uploadAgentFiles((result.tempFiles||[]).map(file=>({path:file.tempFilePath,name:kind==='image'?'图片':'视频',kind,size:Number(file.size||0)}))),fail:error=>{if(!/cancel/i.test(String(error&&error.errMsg||'')))this.fail(new Error('无法选择'+(kind==='image'?'图片':'视频')+'，请检查微信权限'));}});
    },
    chooseAgentAudio(){
      if(this.data.busy||this.data.agentThinking)return;
      this.setData({agentSheet:''});
      wx.chooseMessageFile({count:Math.max(1,AGENT_ATTACHMENT_LIMIT-(this.data.agentAttachments||[]).length),type:'file',extension:['mp3','wav','m4a','aac','ogg'],success:result=>this.uploadAgentFiles((result.tempFiles||[]).map(file=>({path:file.path,name:file.name||file.path,kind:'audio',size:Number(file.size||0)}))),fail:error=>{if(!/cancel/i.test(String(error&&error.errMsg||'')))this.fail(new Error('无法选择音频，请从微信文件中选择'));}});
    },
    uploadAgentFiles(files){
      return this.run(async()=>{
        const sid=await this.ensureAgentSession();
        for(const file of files){
          const max=file.kind==='video'?100:10;
          if(file.size>max*1024*1024)throw new Error((file.kind==='video'?'视频':'文件')+'不能超过 '+max+'MB');
          if((this.data.agentAttachments||[]).length>=AGENT_ATTACHMENT_LIMIT)break;
          const result=await api.upload(IP12_API+'/upload',file.path,{session_id:sid});
          this.addAgentAttachment({fileId:result.file_id,name:file.name||result.name,kind:result.kind||file.kind,preview:file.kind==='image'?file.path:'',url:result.url||''});
        }
      });
    },
    removeAgentAttachment(e){
      const index=Number(e.currentTarget.dataset.index);
      this.setData({agentAttachments:(this.data.agentAttachments||[]).filter((_,i)=>i!==index)});
    },
    toggleAgentAssets(){
      if(this.data.agentSheet==='assets')return this.setData({agentSheet:'',agentAssetsOpen:false});
      return this.run(async()=>{
        const sid=await this.ensureAgentSession();
        const data=await api.request(IP12_API+'/assets?session_id='+encodeURIComponent(sid)+'&limit=10&offset=0');
        const assets=(data.assets||[]).slice(0,10).map(item=>Object.assign({},item,{kind:/\.(?:mp3|wav|m4a|aac|ogg)$/i.test(item.name||'')?'audio':'image',displayThumb:''}));
        await Promise.all(assets.map(async item=>{if(item.thumb)item.displayThumb=await api.mediaSource(api.mediaURL(ip12MediaPath(item.thumb))).catch(()=>'');}));
        this.setData({agentAssets:assets,agentAssetsOpen:true,agentSheet:'assets'});
      });
    },
    useAgentAsset(e){
      const item=this.data.agentAssets[Number(e.currentTarget.dataset.index)];
      if(!item)return;
      return this.run(async()=>{
        const result=await api.request(IP12_API+'/assets/use','POST',{session_id:this.data.agentSessionId,asset_id:item.id});
        let preview='';if(result.kind==='image')preview=await api.mediaSource(api.mediaURL(ip12MediaPath(result.url))).catch(()=>'');
        this.addAgentAttachment({fileId:result.file_id,name:result.name||item.name,kind:result.kind||item.kind,preview,url:result.url||''});
        this.setData({agentAssetsOpen:false,agentSheet:''});
      });
    },
    switchAgentSession(){
      const sessions=this.data.agentSessions||[];
      if(!sessions.length)return this.toast('还没有以前的对话');
      wx.showActionSheet({itemList:sessions.map(item=>(item.preview||'以前的对话').slice(0,28)),success:result=>{const item=sessions[result.tapIndex];if(item)this.run(()=>this.restoreAgent(item.sid));}});
    },
    exportAgentConversation(){
      const sid=this.data.agentSessionId;
      if(!sid)return this.toast('请先开始一段对话');
      if(!wx.shareFileMessage)return this.toast('当前微信版本不支持导出，请升级微信后重试');
      return this.run(async()=>{
        const file=await api.mediaSource(api.mediaURL(IP12_API+'/export/'+encodeURIComponent(sid)+'.jsonl'));
        const date=new Date().toISOString().slice(0,10).replace(/-/g,'');
        await new Promise((resolve,reject)=>wx.shareFileMessage({filePath:file,fileName:'黄雀对话-'+date+'.jsonl',success:resolve,fail:error=>/cancel/i.test(String(error&&error.errMsg||''))?resolve():reject(new Error('导出失败，请稍后重试'))}));
      });
    },
    agentApproval(e){
      const card=this.data.agentDelegations.find(item=>item.key===e.currentTarget.dataset.key);
      if(!card||!card.quoteId)return;
      const decision=e.currentTarget.dataset.decision;
      const send=()=>this.run(async()=>{
        const latest=await api.request(IP12_API+'/state/'+encodeURIComponent(this.data.agentSessionId));
        const current=latest[card.domain];
        if(!current||current.state!=='needs_approval'||current.quote_id!==card.quoteId)throw new Error('报价已经变化，请刷新后重新确认');
        return true;
      }).then(ok=>{if(ok)this.sendAgentMessage(decision==='confirm'?'确认执行':'先不执行',{domain:card.domain,quote_id:card.quoteId,decision});});
      if(decision==='cancel')return send();
      wx.showModal({title:'确认使用积分',content:'本次将使用 '+card.cost+' 积分，当前余额 '+card.points+' 积分。确认后才会执行。',confirmText:'确认执行',success:result=>{if(result.confirm)send();}});
    },
    previewAgentImage(e){
      const item=this.data.agentMessages[Number(e.currentTarget.dataset.message)],current=item&&item.images[Number(e.currentTarget.dataset.image)];
      if(current)wx.previewImage({current,urls:item.images});
    },
    openAgentIpDrawer(){this.setData({agentIpDrawerOpen:true,agentAssetsOpen:false,agentSheet:''});},
    closeAgentIpDrawer(){this.setData({agentIpDrawerOpen:false});},
    keepAgentIpDrawer(){},
    chooseAgentIpItem(e){
      const kind=e.currentTarget.dataset.ipKind;
      if(kind==='report'){this.closeAgentIpDrawer();return this.openAgentReport();}
      const text=kind==='topics'?'请把我已经确认的选题列出来。':'请把我已经确认的口播稿列出来。';
      this.agentDraft=text;this.setData({promptInput:text,agentHasText:true,agentIpDrawerOpen:false});this.toast('已放到输入框，确认后发送');
    },
    openAgentReport(){
      const raw=this.data.agentReport&&this.data.agentReport.files&&this.data.agentReport.files.pdf;
      if(!raw)return this.toast('报告还在整理中');
      const url=String(raw).startsWith('api/')?'/workbench/ip12/'+raw:raw;
      this.run(async()=>{const file=await api.mediaSource(api.mediaURL(url));await new Promise((resolve,reject)=>wx.openDocument({filePath:file,fileType:'pdf',showMenu:true,success:resolve,fail:reject}));});
    },
    confirmAgentReport(){
      if(!this.data.agentSessionId)return;
      wx.showModal({title:'确认前四步资料？',content:'确认后，主 Agent 会继续进行选题和文案。',confirmText:'确认并继续',success:result=>{if(result.confirm)this.run(async()=>{const data=await api.request(IP12_API+'/confirm','POST',{session_id:this.data.agentSessionId});if(data.seq!==undefined){api.save({ip12Waiting:{sid:this.data.agentSessionId,seq:data.seq}});this.setData({agentThinking:true});await this.pollAgent(this.data.agentSessionId,data.seq);}});}});
    },
    stopThought(){this.setData({stopped:!this.data.stopped});},
    confirmPlan(){if(!this.requireLogin())return;this.run(async()=>{creation.payload(this.draft());api.save({draft:this.draft()});this.navigate('confirm');});},
    async loadQuote(){const draft=api.read().draft;if(!draft)throw new Error('请先填写创作需求');const q=await creation.quote(draft);if(this.alive)this.setData({quote:q,promptInput:draft.prompt,kind:draft.kind,kindName:creation.format(draft.kind).name,formatDetail:q.detail});},
    startGeneration(){this.run(async()=>{if(!this.data.quote)throw new Error('请先取得当前报价');try {await creation.submit(api.read().draft,this.data.quote.cost);}catch(e){this.setData({attempt:api.read().attempt||null});if(e.code==='price_changed')await this.loadQuote();throw e;}this.navigate('processing');});},
    recover(){this.run(async()=>{await creation.submit(null,null,true);this.navigate('processing');});},
    async refreshJob(){clearTimeout(this.timer);const s=api.read().selected;if(!s||(!s.id&&!s.asset))throw new Error('请从作品列表选择一个任务');const owner=api.session()&&api.session().user.username;let job;if(s.asset)job=Object.assign({},s.asset);else{const data=await api.request('/api/gen/job/'+encodeURIComponent(s.id));job=creation.jobView(data,s.kind);if(s.kind==='video'){job.kind='video';job.ratio=(data.result&&data.result.ratio)||job.ratio||'';job.videoHeight=videoHeight(job.ratio);}}if(!this.alive||!api.session()||owner!==api.session().user.username)return;job.displayUrls=await Promise.all((job.urls||[job.url]).filter(Boolean).map(api.mediaSource));job.displayUrl=job.displayUrls[0]||'';if(!this.alive||!api.session()||owner!==api.session().user.username)return;this.setData({job});if(this.visible&&this.properties.pageId==='processing'&&!job.done&&!job.failed)this.timer=setTimeout(()=>this.refreshJob().catch(e=>this.fail(e)),4000);},
    refreshTask(){this.run(()=>this.refreshJob());},
    openWork(e){const key=e.currentTarget.dataset.key,job=this.data.works.find(j=>j.key===key);if(!job)return;this.run(async()=>{api.save({selected:job.kind==='video'&&job.done?{asset:job}:{id:job.jobId||job.id,kind:job.kind}});this.navigate(job.done?job.kind+'-detail':job.failed?'failed':'processing');});},
    viewResult(){const j=this.data.job;if(j&&j.done)this.navigate(j.kind+'-detail');},
    retry(){this.run(async()=>{const local=api.read();if(!local.draft||!local.attempt||Number(local.attempt.jobId)!==Number(this.data.job&&this.data.job.id))throw new Error('这件作品的原始需求未保存在此设备，请回首页填写后重新确认');this.navigate('confirm');});},
    applyFilter(){const q=this.data.search.trim().toLowerCase(),page=this.properties.pageId,filter=this.data.filter;this.setData({visibleWorks:this.data.works.filter(w=>{const allowed=page!=='card-works'||(w.done&&['image','video'].includes(w.kind));const matched=page==='works'?(filter==='all'||filter==='done'&&w.done||filter==='failed'&&w.failed||filter==='processing'&&!w.done&&!w.failed):(filter==='all'||w.kind===filter);return allowed&&matched&&(!q||w.title.toLowerCase().includes(q));})});},
    selectFilter(e){this.setData({filter:e.currentTarget.dataset.filter});this.applyFilter();},
    clearSearch(){this.setData({search:'',filter:'all'});this.applyFilter();},
    chooseReference(){if(!['image','text'].includes(this.data.kind))return this.toast('请在图片或文案创作中添加参考图');wx.chooseMedia({count:1,mediaType:['image'],success:r=>{const f=r.tempFiles[0];if(f.size>5*1024*1024)return this.toast('参考图请小于 5 MB');wx.getFileSystemManager().readFile({filePath:f.tempFilePath,encoding:'base64',success:x=>{const mime=x.data.startsWith('iVBOR')?'image/png':x.data.startsWith('UklGR')?'image/webp':x.data.startsWith('/9j/')?'image/jpeg':'';if(!mime)return this.toast('请选择 PNG、JPG 或 WebP 图片');this.reference='data:'+mime+';base64,'+x.data;this.setData({referencePath:f.tempFilePath});},fail:()=>this.toast('无法读取这张图片')});},fail:e=>{if(!/cancel/.test(e.errMsg||''))this.toast('无法打开相册，请检查授权');}});},
    removeReference(){this.reference='';this.setData({referencePath:''});},
    async loadVoices(){const r=await api.request('/api/gen/audio/voices');const voices=(r.items||[]).filter(v=>v.ready).map(v=>({key:v.voice_key,name:v.display_name}));if(this.alive)this.setData({voices});},
    chooseVoice(e){const v=this.data.voices[Number(e.detail.value)];if(v)this.setData({voice:v.key||v.id||v.voice,voiceName:v.name||v.title});},
    preview(){if(this.data.job&&this.data.job.urls.length)wx.previewImage({current:this.data.job.displayUrl,urls:this.data.job.displayUrls});},
    saveImage(){const url=this.data.job&&this.data.job.url;if(!url)return;this.run(()=>new Promise((resolve,reject)=>wx.downloadFile({url,header:api.mediaHeaders(url),success:r=>{if(r.statusCode!==200)return reject(new Error('图片下载失败，请刷新作品后重试'));wx.saveImageToPhotosAlbum({filePath:r.tempFilePath,success:()=>{this.toast('已保存到相册');resolve();},fail:()=>reject(new Error('保存失败，请检查相册权限'))});},fail:()=>reject(new Error('下载失败，请检查网络或下载域名配置'))})));},
    playAudio(){const url=this.data.job&&this.data.job.displayUrl;if(!url)return this.toast('作品还没有可播放的音频');if(!this.audio){this.audio=wx.createInnerAudioContext();this.audio.onPlay(()=>this.setData({playing:true}));this.audio.onPause(()=>this.setData({playing:false}));this.audio.onEnded(()=>this.setData({playing:false}));this.audio.onTimeUpdate(()=>this.setData({audioTime:Math.floor(this.audio.currentTime),audioDuration:Math.floor(this.audio.duration)}));this.audio.onError(()=>{this.setData({playing:false});this.fail(new Error('音频暂时无法播放，请刷新作品后重试'));});}if(this.data.playing)this.audio.pause();else{this.audio.src=url;this.audio.play();}},
    mediaError(){this.fail(new Error('媒体暂时无法加载，请刷新作品后重试'));},
    toggleScript(){this.setData({scriptOpen:!this.data.scriptOpen});},
    copyText(){const text=this.data.job&&this.data.job.text;if(!text)return this.toast('当前没有可复制的文稿');wx.setClipboardData({data:typeof text==='string'?text:JSON.stringify(text),fail:()=>this.toast('复制失败，可长按文稿选择文字')});},
    saveCard(){this.run(async()=>{const c=this.data.card;if(!c.name.trim())throw new Error('请填写展示名称');if(c.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email))throw new Error('请填写有效邮箱');const body={};['name','headline','company','bio','email','address'].forEach(k=>body[k]=String(c[k]||'').trim());const r=await api.request('/api/auth/card/me','PUT',body);this.setData({card:r.card});this.toast('名片已保存');this.navigate('card');});},
    privacyToggle(e){const key=e.currentTarget.dataset.key;const previous=!!this.data.card[key];this.run(async()=>{try {const key=e.currentTarget.dataset.key;if(!['email_public','address_public'].includes(key))return;const r=await api.request('/api/auth/card/me','PUT',{[key]:!!e.detail.value});this.setData({card:r.card});}catch(error){this.setData({['card.'+key]:!!e.detail.value});this.setData({['card.'+key]:previous});throw error;}});},
    publishCard(){wx.showModal({title:this.data.card.published?'收起公开名片？':'发布这张名片？',content:'发布后他人可查看名片中公开的资料与精选作品。邮箱和地址按隐私开关展示。',success:r=>{if(r.confirm)this.run(async()=>{const out=await api.request('/api/auth/card/'+(this.data.card.published?'unpublish':'publish'),'POST',{});this.setData({card:out.card||this.data.card});await this.load();});}});},
    toggleFeatured(e){this.run(async()=>{
      if(!this.requireLogin())return;
      const job=this.data.works.find(j=>j.key===e.currentTarget.dataset.key);
      if(!job||!job.done||!job.url||!['image','video'].includes(job.kind))throw new Error('请选择已完成的图片或视频');
      const token=api.session().token;
      const current=await api.request('/api/auth/card/me?create=0').catch(e=>{if(e.status===404)return {card:null};throw e;});
      const list=(current.card&&current.card.works)||[];
      const slot=[1,2,3].find(n=>!list.some(w=>w.type===job.kind&&Number(w.slot)===n));
      if(!slot)throw new Error('同类作品最多三件，请先移除一件');
      const data=await new Promise((resolve,reject)=>wx.downloadFile({url:job.url,header:api.mediaHeaders(job.url),success:r=>{
        if(r.statusCode!==200)return reject(new Error('作品下载失败，请刷新后重试'));
        const file=wx.getFileSystemManager();
        const clean=()=>file.unlink({filePath:r.tempFilePath,fail:()=>{}});
        file.getFileInfo({filePath:r.tempFilePath,success:info=>{
          if(info.size>(job.kind==='image'?4:20)*1024*1024){clean();return reject(new Error('名片图片需小于 4 MB，视频需小于 20 MB'));}
          file.readFile({filePath:r.tempFilePath,encoding:'base64',success:out=>{clean();resolve(out.data);},fail:()=>{clean();reject(new Error('无法读取作品文件'));}});
        },fail:()=>{clean();reject(new Error('无法读取文件大小'));}});
      },fail:()=>reject(new Error('下载失败，请检查下载域名配置'))}));
      if(!api.session()||api.session().token!==token)throw new Error('登录状态已变化，请重试');
      const mime=job.kind==='video'?'video/mp4':data.startsWith('iVBOR')?'image/png':data.startsWith('UklGR')?'image/webp':data.startsWith('/9j/')?'image/jpeg':'';
      if(!mime)throw new Error('这张图片的格式暂不支持');
      const r=await api.request('/api/auth/card/media','POST',{field:'work_'+job.kind+'_'+slot,data:'data:'+mime+';base64,'+data,title:job.title.slice(0,160)});
      this.setData({card:r.card});this.toast('已加入名片');
    });},
    removeFeatured(e){this.run(async()=>{const key=e.currentTarget.dataset.key;if(!key)return;const r=await api.request('/api/auth/card/me','PUT',{works:(this.data.card.works||[]).filter(w=>w.key!==key)});this.setData({card:r.card});});},
    contact(){const c=this.data.publicCard;if(c&&c.email)wx.setClipboardData({data:c.email});},
    copyInvite(){const d=this.data.invite;const code=d&&(d.code||d.invite_code||(d.invite&&d.invite.code));if(!code)return this.toast('当前没有可用的邀请码');wx.setClipboardData({data:String(code)});},
    notifyToggle(e){const key=e.currentTarget.dataset.key;if(!['finished','failed','activity'].includes(key))return;this.run(async()=>{const notifications=Object.assign({},this.data.notifications,{[key]:!!e.detail.value});api.save({notifications});this.setData({notifications});});},
    feedbackType(e){this.setData({feedbackType:e.currentTarget.dataset.type});},
    submitFeedback(){this.run(async()=>{const content=this.data.feedbackInput.trim();if(content.length<5)throw new Error('请至少填写五个字');const rows=api.read().feedback||[];api.save({feedback:rows.concat({content,type:this.data.feedbackType,at:Date.now()})});this.setData({feedbackSent:true});});},
    newFeedback(){this.setData({feedbackSent:false,feedbackInput:''});},
    faq(e){const i=Number(e.currentTarget.dataset.index);this.setData({openFaq:this.data.openFaq===i?-1:i});},
    info(e){const kind=e.currentTarget.dataset.info;const copy={login:'使用已有黄雀账号登录。密码仅用于本次验证，不保存在设备。登录凭证会保存到本机，退出时清除。',privacy:'名片资料保存于黄雀服务端；只有已发布名片及你允许公开的联系方式对外展示。',notice:'当前仅保存此设备的通知偏好；尚未接入微信订阅授权。',payment:'会员购买尚未接入此版本。已有会员权益与余额来自你的真实账号。',share:'可将作品整理进名片，再发布名片分享给朋友。',data:'账号登录凭证、创作草稿和任务恢复记录保存在此设备。云端作品不会因退出登录而删除。'};wx.showModal({title:'黄雀',content:copy[kind]||'此项功能正在接入。',showCancel:false});}
  }
});
