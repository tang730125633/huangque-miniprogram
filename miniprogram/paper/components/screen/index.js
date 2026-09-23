const pages = require('./pages');
const api = require('../../services/api');
const creation = require('../../services/creation');
const workSubscription = require('../../services/work-subscription');
const taskQueue = require('../../services/task-queue');
const QueueController = require('../../services/task-queue-controller');
const titles = {}; pages.forEach(p => { titles[p.id] = p.title; });
const emptyCard = { name: '', headline: '', company: '', bio: '', email: '', address: '', email_public: false, address_public: false, works: [] };
const IP12_API = '/workbench/ip12/api/v4';
const IP12_SESSION_KEY = 'hq-v4-session-id';
const IP12_NEW_SESSION = '__new__';
const AGENT_MESSAGE_LIMIT = 30;
const AGENT_IMAGE_LIMIT = 10;
const AGENT_ATTACHMENT_LIMIT = 10;
const AGENT_WATCH_INTERVAL = 4000;
// 报告在服务端后台生成，不会往会话里追加消息：只能主动拉 /api/report/<sid>，
// 否则「报告已完成」在页面上永远不出现（网页端已有 pollReport，小程序端缺失）。
const REPORT_POLL_INTERVAL = 5000;
const REPORT_POLL_MAX_IDLE = 60;
// 样音组件（voice_sample）走后端结构化协议：跟读稿 script、动作 actions 全部由
// 后端下发的卡提供，前端只按结构渲染与提交 widget_action，无任何 id 前缀/正则/兜底稿。
const AGENT_SAMPLE_LIMIT_BYTES = 10 * 1024 * 1024; // 样音 ≤10MB（平台契约）
const AGENT_QUICK_PHRASES = ['帮我做一张商品图','帮我做一条短视频','帮我写一段文案','看看我的 IP 报告','我不太会用，请一步一步教我'];
const AGENT_QUICK_KEY_PREFIX = 'hq-agent-quick-phrases-v1:';
// 封面图识别：官方成片封面（video-covers/<job>.jpg）或文件名以 _cover/-cover 结尾的图片。
// 成片交付消息里的封面图从普通图片卡里摘出，只留一张、小尺寸渲染（2026-09-16 老板实录：
// 任务 9262 交付塞了两张封面大图——官方截帧 + 平台封面，另加配音 mp3 与重复视频卡）。
const AGENT_COVER_IMAGE_RE = /(?:video-covers\/|[_\-]cover\.(?:jpe?g|png|webp|gif)(?:[?#]|$))/i;
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
  const content=String(value||''),images=[],videos=[],audios=[],pdfs=[],known=[];
  (content.match(/(?:https:\/\/huangquechuanmei\.com\/workbench\/ip12\/)?\/?api\/download\/[^\s<>"']+?\.pdf(?:\?[^\s<>"']*)?/gi)||[]).forEach(url=>{pdfs.push(url);known.push(url);});
  (content.match(/(?:https?:\/\/|\/api\/v4\/)[^\s<>"']+/g)||[]).forEach(raw=>{
    const url=raw.replace(/[)）\]}>*_，。；;]+$/,'');
    if(/\.(?:jpe?g|png|webp|gif)(?:[?#]|$)/i.test(url)){images.push(url);known.push(url);}
    else if(/\.(?:mp4|mov|webm|m3u8)(?:[?#]|$)|\/api\/v4\/render\/[0-9a-f]{32}(?:[?#]|$)/i.test(url)){videos.push(url);known.push(url);}
    else if(/\.(?:mp3|wav|m4a|aac|ogg)(?:[?#]|$)/i.test(url)){audios.push(url);known.push(url);}
  });
  const clean=known.reduce((text,url)=>text.split(url).join(''),content).replace(/\[([^\]]*)\]\(\s*\)/g,'$1').replace(/<\s*>/g,'');
  return {
    content:clean.split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!/^(?:成片|成片链接|视频|视频链接|模板小样|小样视频|预览视频|缩略图|音频|音频链接|录音|试听)[：:]?$/.test(line.replace(/[)）\]}>*_，。；;]+$/,''))).join('\n').trim(),
    images:[...new Set(images)], videos:[...new Set(videos)], audios:[...new Set(audios)], pdfs:[...new Set(pdfs)]
  };
}
function agentInlineNodes(value) {
  const text=String(value||''),nodes=[];
  const pattern=/(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https:\/\/[^)\s]+)\))/g;
  let cursor=0,match;
  while((match=pattern.exec(text))){
    if(match.index>cursor)nodes.push({type:'text',text:text.slice(cursor,match.index)});
    if(match[2])nodes.push({name:'strong',children:[{type:'text',text:match[2]}]});
    else if(match[3])nodes.push({name:'span',attrs:{style:'font-family:monospace;background:#f1ede5;padding:2px 4px;border-radius:4px;'},children:[{type:'text',text:match[3]}]});
    else nodes.push({name:'a',attrs:{href:match[5],style:'color:#75501b;text-decoration:underline;'},children:[{type:'text',text:match[4]}]});
    cursor=pattern.lastIndex;
  }
  if(cursor<text.length)nodes.push({type:'text',text:text.slice(cursor)});
  return nodes.length?nodes:[{type:'text',text:text}];
}
function agentRichNodes(value) {
  const nodes=[],code=[];let fenced=false;
  const push=(text,style)=>nodes.push({name:'div',attrs:{style},children:agentInlineNodes(text)});
  const pushCode=text=>nodes.push({name:'div',attrs:{style:'margin:6px 0 10px;padding:10px 12px;border-radius:8px;background:#f1ede5;font-family:monospace;white-space:pre-wrap;'},children:[{type:'text',text}]});
  String(value||'').split(/\r?\n/).forEach(raw=>{
    const line=raw.trim();
    if(/^```/.test(line)){if(fenced){pushCode(code.join('\n'));code.length=0;}fenced=!fenced;return;}
    if(fenced){code.push(raw);return;}
    if(!line){nodes.push({name:'div',attrs:{style:'height:8px;'},children:[]});return;}
    let match=line.match(/^(#{1,3})\s+(.+)$/);if(match)return push(match[2],'margin:8px 0 5px;font-size:'+(match[1].length===1?'18px':'16px')+';font-weight:700;line-height:1.5;');
    match=line.match(/^>\s?(.*)$/);if(match)return push(match[1],'margin:6px 0;padding:7px 10px;border-left:3px solid #c49a55;background:#f7f0e3;color:#5f574c;line-height:1.7;');
    match=line.match(/^[-*+]\s+(.+)$/);if(match)return push('• '+match[1],'margin:3px 0;padding-left:4px;line-height:1.7;');
    match=line.match(/^(\d+)[.)、]\s+(.+)$/);if(match)return push(match[1]+'．'+match[2],'margin:3px 0;padding-left:4px;line-height:1.7;');
    push(line,'margin:2px 0;line-height:1.75;');
  });
  if(code.length)pushCode(code.join('\n'));
  return nodes;
}
function ip12MediaPath(value) {
  const raw=String(value||'');
  return /^\/?api\/(?:v4|download)\//.test(raw)?'/workbench/ip12/'+raw.replace(/^\//,''):raw;
}
async function shareLocalPath(value) {
  const source=await api.mediaSource(value);
  if(!/^https:\/\//i.test(source))return source;
  return new Promise((resolve,reject)=>wx.downloadFile({url:source,success:result=>result.statusCode===200&&result.tempFilePath?resolve(result.tempFilePath):reject(new Error('作品下载失败')),fail:()=>reject(new Error('作品下载失败'))}));
}
function mediaBase(url) {
  return String(url||'').split('?')[0].split('/').filter(Boolean).pop().toLowerCase();
}
function agentMessages(items) {
  // 上一条助手消息的媒体文件名集合：连续两条助手消息（中间的系统事件被后端过滤掉了）
  // 出现同名媒体=自动收尾轮把成片重贴一遍（老板实录：点不开的第二张卡），判重剔除；
  // 用户主动要重发时中间隔着用户消息，此集合已清空，不会被误剔。
  let prevAssistantBases=null;
  return (Array.isArray(items)?items:[]).map((item,index)=>{
    const isAssistant=!item||item.role!=='user';
    const media=mediaFromContent(item&&item.content);
    // 后端结构化 videos（{url,cover}）优先；文本里提取出的 URL 合并去重，拿不到封面的保持空
    const byUrl=new Map();
    (Array.isArray(item&&item.videos)?item.videos:[]).forEach(v=>{
      if(v&&(v.url||v.src))byUrl.set(v.url||v.src,v);
    });
    media.videos.forEach(url=>{if(!byUrl.has(url))byUrl.set(url,{url});});
    let videos=[...byUrl.values()].map((v,videoIndex)=>({
      url:v.url||v.src||'',cover:(v&&v.cover)||'',src:'',loading:false,domId:'agent-video-'+index+'-'+videoIndex
    }));
    const images=[...new Set((Array.isArray(item&&item.images)?item.images:[]).concat(media.images))];
    // 封面图从图片卡里摘出：只留一张、小尺寸渲染（官方 video-covers 优先），
    // 不再整张撑满气泡、也不出现两张一样的封面卡。
    const coverImages=images.filter(url=>AGENT_COVER_IMAGE_RE.test(url))
      .sort((a,b)=>(/video-covers\//i.test(b)?1:0)-(/video-covers\//i.test(a)?1:0));
    let covers=coverImages.slice(0,1);
    let keptImages=images.filter(url=>coverImages.indexOf(url)<0);
    let audios=media.audios.map((url,audioIndex)=>({url,src:'',loading:false,playing:false,domId:'agent-audio-'+index+'-'+audioIndex}));
    // 成片消息里的 mp3 是配音副产品（老板实录：多余文件）：同一消息已有视频卡时
    // 不再渲染音频卡；纯音频产品（配乐/配音任务）的消息没有视频，照常渲染。
    if(videos.length)audios=[];
    if(isAssistant&&prevAssistantBases){
      videos=videos.filter(v=>!prevAssistantBases.has(mediaBase(v.url)));
      keptImages=keptImages.filter(url=>!prevAssistantBases.has(mediaBase(url)));
      covers=covers.filter(url=>!prevAssistantBases.has(mediaBase(url)));
      audios=audios.filter(a=>!prevAssistantBases.has(mediaBase(a.url)));
    }
    const bases=new Set();
    videos.forEach(v=>bases.add(mediaBase(v.url)));
    covers.forEach(url=>bases.add(mediaBase(url)));
    keptImages.forEach(url=>bases.add(mediaBase(url)));
    audios.forEach(a=>bases.add(mediaBase(a.url)));
    prevAssistantBases=isAssistant?(bases.size?bases:prevAssistantBases):null;
    return {
      domId:'agent-message-'+index,
      role:isAssistant?'assistant':'user', content:media.content, richNodes:agentRichNodes(media.content),
      images:keptImages,
      covers,
      videos,
      audios,
      pdfs:media.pdfs.map((url,pdfIndex)=>({url,domId:'agent-pdf-'+index+'-'+pdfIndex})), attachments:[]
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
    coverFile:item.cover_url||item.image_file||'', coverUrl:item.cover_url||'', ratio:item.ratio||'', videoHeight:videoHeight(item.ratio),
    done:['done','completed'].includes(status), failed:['error','failed'].includes(status),
    label:['done','completed'].includes(status)?'已完成':['error','failed'].includes(status)?'生成失败':'正在处理'
  };
}
function formatBytes(value) {
  const bytes=Math.max(0,Number(value)||0);
  if(bytes>=1024*1024*1024)return (bytes/1024/1024/1024).toFixed(1)+'GB';
  if(bytes>=1024*1024)return (bytes/1024/1024).toFixed(1)+'MB';
  if(bytes>=1024)return Math.round(bytes/1024)+'KB';
  return bytes?bytes+'B':'未知大小';
}
function agentAssetView(item) {
  const kind=['image','video','audio','avatar'].includes(String(item&&item.kind||''))?String(item.kind):'image';
  return Object.assign({},item,{kind,kindLabel:kind==='video'?'视频':kind==='audio'?'音频':kind==='avatar'?'数字人':'图片',sizeLabel:formatBytes(item&&item.size),displayThumb:'',selected:false});
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
// 卡片是否上屏：只由后端每轮下发的 cards 决定（批次收敛 + 跨轮续挂），
// 前端不再自己记「已关闭的卡」——以前发消息就把当前卡组整批记成永久关闭，
// 用户点选过的文案卡因此再也回不来（报障台 #10：打字改选后文案卡消失）。
function agentWidgets(value,film,selections) {
  const selected=selections&&typeof selections==='object'?selections:{};
  // 渲染不做 film 门控：后端每轮返回的就是当前该渲染的卡（批次收敛 + 模板目录卡、
  // 音色/形象跨轮续挂），网页端同口径（出片/非出片两套都渲染）；按 film 过滤会让
  // film=false 的模板目录卡/样音卡在出片轮整张消失（与后端「任何轮都渲染」的契约相悖）。
  // film 只随点选回传后端，不决定渲染。
  return (Array.isArray(value)?value:[]).filter(widget=>{
    return !widget.superseded&&['avatar_pick','voice_pick','script_pick','option_pick','voice_sample'].includes(String(widget&&widget.type||''));
  }).slice(-4).map((widget,widgetIndex)=>{
    const type=String(widget.type),kind=type==='avatar_pick'?'avatar':type==='voice_pick'?'voice':type==='voice_sample'?'voice_sample':'script';
    // 模板目录卡：后端注册的是 {type:'option_pick', id:'template_catalog'}（按 id 识别、
    // 不带 layout 字段）；旧协议只认 layout 会退化成普通列表。两个都认。
    const layout=(widget.layout==='template_catalog'||widget.id==='template_catalog')?'template_catalog':'list';
    const items=(Array.isArray(widget.items)?widget.items:[]).map((item,itemIndex)=>{
      const rawTitle=String(item.title||item.name||item.label||'这个选项').slice(0,120);
      let parsedName=rawTitle;
      let summary=String(item.summary||item.description||'').slice(0,300);
      let parsedTag=String(item.tag||'').trim().slice(0,16);
      const tagMatch=rawTitle.match(/^([^(（·]+)[(（·]\s*([^()）]+)\s*[)）]?$/);
      if(tagMatch){
        const candName=tagMatch[1].trim();
        const candTag=tagMatch[2].trim();
        if(candTag.length>0 && candTag.length<=8 && !/^(副标题|说明|备注|提示)/i.test(candTag)){
          parsedName=candName;
          parsedTag=candTag;
        }else if(/^(副标题|说明|备注|提示)/i.test(candTag)){
          parsedName=candName;
          if(!summary){
            summary=candTag;
          }
        }
      }
      return {
        key:String(item.id||itemIndex).slice(0,200),id:String(item.id||itemIndex).slice(0,200),title:rawTitle,
        parsedName,parsedTag,
        summary,body:String(item.body||'').slice(0,1200),imageUrl:String(item.image_url||'').slice(0,2000),displayImage:'',
        previewUrl:String(item.preview_url||'').slice(0,2000),slotId:String(item.slot_id||'').slice(0,200),createdAt:String(item.created_at||'').slice(0,100),recommended:Boolean(item.recommended),
        selected:false,playing:false,expanded:false
      };
    }).slice(0,layout==='template_catalog'?40:12);
    // actions：优先来自卡结构（无硬编码限制），支持自定义 label 与 prompt
    const actions=type==='voice_sample'?(Array.isArray(widget.actions)?widget.actions:[]).map(action=>({
      mode:action&&action.mode==='upload'?'upload':action&&action.mode==='record'?'record':'',
      label:String(action&&action.label||(action&&action.mode==='upload'?'上传录音文件':'开始录音')).slice(0,20)
    })).filter(action=>action.mode):(Array.isArray(widget.actions)?widget.actions:[]).map(action=>({
      mode:String(action&&action.mode||'prompt'),
      label:String((action&&(action.label||action.title))||'执行操作').slice(0,30),
      prompt:String((action&&action.prompt)||(action&&action.label)||'').slice(0,200)
    })).filter(a=>a.label);
    // 多选卡（selection_mode=multiple，2026-09-13 老板定调「该多选的地方要多选」）：
    // 勾选式 + 「确认选择」一次提交，消息形如「【点选】标题：甲、乙」。勾选数下限默认 1。
    const selectionMode=String(widget.selection_mode||'')==='multiple'?'multiple':'single';
    const minSelected=selectionMode==='multiple'?Math.max(1,Number(widget.min_selected==null?1:widget.min_selected)||1):0;
    const maxSelected=selectionMode==='multiple'?Math.max(0,Number(widget.max_selected==null?0:widget.max_selected)||0):0;
    const selChoice=(selected[kind]||selected[type]||selected[widget.id]||null);
    const directSelectedId=String((widget&&(widget.selectedId||widget.selected_id))||(selChoice&&selChoice.id)||'');
    const directPicked=directSelectedId?(items.find(item=>String(item.id)===String(directSelectedId))):null;
    const directAnswered=Boolean(directSelectedId&&layout!=='template_catalog');
    return {
      id:String(widget.id||type+'-'+widgetIndex),gen:Math.max(1,Number(widget.gen)||1),domain:String(widget.domain||''),consumed:Boolean(widget.consumed),key:String(widget.id||type+'-'+widgetIndex)+'@'+Math.max(1,Number(widget.gen)||1),domId:'agent-widget-'+widgetIndex,type,kind,film:widget.film!==false,
      title:String(widget.title||'请选择').slice(0,80),hint:String(widget.hint||'').slice(0,240),selectedId:directSelectedId,
      // 已选卡收成一行（2026-09-16 老板实录：选过的单选卡一直挂在下面很怪）：
      // selectedId 非空即 answered（restore 时按选择回填），点徽标 expanded 展开改选。
      answered:Boolean(widget.consumed)||directAnswered,expanded:false,selectedTitle:widget.consumed?(widget.selected_labels||[]).join('、'):(directPicked?directPicked.title:''),
      script:type==='voice_sample'?String(widget.script||'').slice(0,600):'',
      selectionMode,minSelected,maxSelected,selectedCount:0,
      layout,catalogExpanded:false,itemCount:items.length,items,actions
    };
  }).filter(widget=>(widget.items.length||widget.type==='voice_sample'&&widget.actions.length||widget.actions.length));
}
function agentBackgroundActive(value) {
  const delegations=value&&value.delegations&&typeof value.delegations==='object'?value.delegations:{};
  return Boolean((value&&value.visual_preprocess&&value.visual_preprocess.processing_count)||(value&&Array.isArray(value.jobs)&&value.jobs.length)||Object.keys(delegations).some(domain=>['running','submitting','queued'].includes(String(delegations[domain]&&delegations[domain].state||''))));
}
function fmtWorkElapsed(ms) {
  const s=Math.max(0,Math.floor(ms/1000));
  return s<60?s+' 秒':Math.floor(s/60)+' 分 '+(s%60)+' 秒';
}
function agentDeliverySignature(value) {
  return JSON.stringify((value&&Array.isArray(value.deliveries)?value.deliveries:[]).map(item=>[item&&item.job&&String(item.job.job_id||item.job.id||''),String(item&&item.reply||'').length,(item&&item.images||[]).length]));
}
Component({
  properties: { pageId: { type: String, value: 'home' } },
  data: {
    agentQueueTasks:[], agentQueueReconnecting:false,
    title: '', statusTop: 24, navHeight: 48, safeRight: 104, chatNavOffset: 72, user: null, busy: false, loading: false, error: '',
    promptInput: '', kind: 'image', formats: creation.formats, kindName: '图片', formatDetail: creation.formats[0].detail,
    username: '', password: '', consent: false, quote: null, attempt: null, job: null,
    works: [], visibleWorks: [], search: '', filter: 'all', hasMore: false,
    filters: [{id:'all',name:'全部'}, ...creation.formats], agentAssetKindFilters: [{key:'all',name:'全部'},{key:'image',name:'图片'},{key:'video',name:'视频'},{key:'audio',name:'音频'}],
    workFilters: [{id:'all',name:'全部'},{id:'processing',name:'进行中'},{id:'done',name:'已完成'},{id:'failed',name:'失败'}],
    card: emptyCard, publicCard: null, points: [], pointFilter: 'all', invite: null, voices: [], voice: '', voiceName: '',
    referencePath: '', chatView: 'proposal', scriptOpen: false, stopped: false,
    agentMessages: [], agentSessionId: '', agentSessions: [], agentHistorySessions: [], agentHistoryManage: false, agentHistorySelectedCount: 0, agentTargetLabel: '新对话', agentPending: null, agentScrollTarget: '', agentThinking: false, agentProgress: '',
    agentDelegations: [], agentWidgets: [], agentTaskCollapsed: false, agentTaskId: '01', agentTaskTitle: '方案建议准备就绪', agentTaskDesc: '', agentTaskCollapsedDesc: '', agentWidgetsSummary: '', agentTaskPendingCount: 0, agentTaskBadgeText: '', agentTaskDismissed: false, agentTaskManualExpanded: false, agentTaskManualCollapsed: false, agentPicksCanConfirm: false, agentVoiceFlow: null, agentReport: {}, agentReportNotice: null, agentReportOpening: false, agentHiddenCount: 0, agentImageHiddenCount: 0, agentBackgroundWorking: false, agentVisualStatus: '', agentDeliverySubNotice: false,
    agentQueue: [], agentEditQueueSeq: '',
    agentAttachments: [], agentUploads: [], agentAssets: [], agentVisibleAssets: [], agentAssetsOpen: false, agentAssetKind: 'all', agentAssetSource: 'all', agentAssetTotal: 0, agentAssetQuota: '', agentAssetQuotaRemaining: -1, agentAssetHasMore: false, agentAssetManage: false, agentAssetSelectedCount: 0, agentAssetUploadText: '', agentIpDrawerOpen: false, agentSheet: '', agentQuickPhrases: AGENT_QUICK_PHRASES, agentHasText: false,
    notifications: { finished: true, failed: true, activity: false }, workSubscriptionConfigured: false, workSubscriptionRemaining: 0,
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
      const sess=api.session();
      const initialUser=sess&&sess.user&&sess.user.username?sess.user:null;
      if(initialUser&&!this.owner)this.owner=initialUser.username;
      this.setData({title:titles[this.properties.pageId],statusTop,navHeight,safeRight,chatNavOffset:statusTop+navHeight,user:initialUser,promptInput:draft.prompt||'',agentHasText:Boolean(String(draft.prompt||'').trim()),kind:f.id,kindName:f.name,formatDetail:f.detail,voice:draft.voice||'',referencePath:draft.reference||'',attempt:api.read().attempt||null,notifications:api.read().notifications||this.data.notifications});
      this._lastLoadTime = Date.now();
      this.load();
      this.loadWorkSubscription();
    },
    detached() { if(this.stopReportPoll)this.stopReportPoll();if(this.stopAgentPoll)this.stopAgentPoll();if(this.stopHomeAgent)this.stopHomeAgent(); if(this.stopTaskQueue)this.stopTaskQueue();if(this.detachAgentUploads)this.detachAgentUploads();this.alive=false; clearTimeout(this.timer);clearTimeout(this.agentWatchTimer);if(this.disposeAgentVoice)this.disposeAgentVoice();if(this.audio)this.audio.destroy();if(this.agentAudio)this.agentAudio.destroy();if(this.agentAssetAudio)this.agentAssetAudio.destroy(); }
  },
  pageLifetimes: { show() { this.homeEntering=false;this.visible=true; if(this.alive&&(!this._lastLoadTime||Date.now()-this._lastLoadTime>350))this.load(); }, hide() { if(this.stopReportPoll)this.stopReportPoll();if(this.stopAgentPoll)this.stopAgentPoll();if(this.stopHomeAgent)this.stopHomeAgent(); if(this.stopTaskQueue)this.stopTaskQueue();this.visible=false; clearTimeout(this.timer);clearTimeout(this.agentWatchTimer);if(this.data.agentVoiceFlow&&this.data.agentVoiceFlow.stage==='recording'&&this.agentVoiceRecorder)this.agentVoiceRecorder.stop();if(this.agentVoicePlayer)this.agentVoicePlayer.pause();if(this.audio)this.audio.pause();if(this.agentAudio)this.agentAudio.pause();if(this.agentAssetAudio)this.agentAssetAudio.pause(); } },
  methods: {
    refreshTaskQueue(e){if(!this.queueController)this.queueController=new QueueController({scope:()=>({alive:this.alive,visible:this.visible!==false,sid:this.data.agentSessionId,token:api.session()&&api.session().token}),tasks:()=>this.data.agentQueueTasks,request:path=>api.request(path,'GET',null,{timeout:5000}),update:(tasks,reconnecting)=>this.setData({agentQueueTasks:tasks,agentQueueReconnecting:reconnecting})});return this.queueController.refresh(e&&e.detail&&e.detail.id);},
    stopTaskQueue(){if(this.queueController)this.queueController.stop();},
    async queueOpenResult(e){const id=String(e.detail&&e.detail.id||''),sid=this.data.agentSessionId,token=api.session()&&api.session().token;if(!this.data.agentQueueTasks.some(t=>t.id===id&&t.sid===sid))return;return this.run(async()=>{const job=await api.request('/api/gen/job/'+encodeURIComponent(id));if(!this.alive||sid!==this.data.agentSessionId||token!==(api.session()&&api.session().token))return;const task=taskQueue.view(job,sid);if(!task||task.status!=='done')return this.toast('结果尚未完成，请稍后查看');const kind=({copy:'text',xiaole_video:'video'})[job.kind]||job.kind;if(!['text','image','video','audio'].includes(kind))return this.toast('此类型请在作品栏查看');api.save({selected:{id:Number(id),kind}});this.navigate(kind+'-detail');});},
    queueGoWorks(){this.navigate('works');},
    toast(title) { wx.showToast({title,icon:'none'}); },
    loadWorkSubscription(){return workSubscription.preload().then(status=>{if(this.alive)this.setData({workSubscriptionConfigured:status.configured,workSubscriptionRemaining:status.remaining});});},
    requestWorkSubscription(showResult=true){return workSubscription.request().then(result=>{const status=result.status||{};if(this.alive)this.setData({workSubscriptionConfigured:Boolean(status.configured),workSubscriptionRemaining:Number(status.remaining||0)});if(showResult&&this.alive){const choice=result.choice;const tips={accept:'已订阅一次作品完成提醒',unavailable:'微信完成提醒暂未开通',cancel:'本次没有开启微信提醒',reject:'没开成。退出小程序重新进来，还能再点一次',ban:'微信不再弹这个框了，重新进入小程序后再试',filter:'微信不再弹这个框了，重新进入小程序后再试'};this.toast(tips[choice]||'本次没有开启微信提醒');}return result;});},
    fail(error) { if(!this.alive)return; const patch={error:error.message||'暂时无法完成，请重试'};if(error.status===401)Object.assign(patch,{user:null,works:[],visibleWorks:[],job:null,card:emptyCard,publicCard:null,points:[]});this.setData(patch); },
    async run(fn) { if(this.data.busy)return;this.setData({busy:true,error:''});try { return await fn(); }catch(e){this.fail(e);}finally{if(this.alive)this.setData({busy:false});} },
    async load() {
      if(this.owner&&(!api.session()||api.session().user.username!==this.owner))this.setData({agentQueueTasks:[],agentQueueReconnecting:false});
      if(this.loading)return;this.loading=true;
      this._lastLoadTime = Date.now();
      const token=api.session()&&api.session().token;
      const valid=()=>this.alive&&token===(api.session()&&api.session().token);
      const currentUser=api.session()&&api.session().user&&api.session().user.username?api.session().user:null;
      this.setData({loading:true,error:'',user:currentUser,attempt:api.read().attempt||null});
      if(this.owner&&(!api.session()||api.session().user.username!==this.owner)){if(this.detachAgentUploads)this.detachAgentUploads();this.agentDraft='';this.setData({works:[],visibleWorks:[],job:null,card:emptyCard,publicCard:null,points:[],promptInput:'',referencePath:'',attempt:null,agentMessages:[],agentSessionId:'',agentSessions:[],agentHistorySessions:[],agentTargetLabel:'新对话',agentPending:null,agentDelegations:[],agentWidgets:[],agentReport:{},agentReportNotice:null,agentReportOpening:false,agentAttachments:[],agentUploads:[],agentAssets:[],agentVisibleAssets:[],agentAssetsOpen:false,agentIpDrawerOpen:false,agentSheet:'',agentQuickPhrases:AGENT_QUICK_PHRASES,agentHasText:false,agentBackgroundWorking:false});}
      const page=this.properties.pageId;
      try {
        if(!token || page==='login')return;
        const identityTask = api.request('/api/auth/me').then(identity => {
          if (!valid()) return null;
          api.rememberIdentity(token, identity.user);
          const saved = api.read();
          if (!this.owner || this.owner !== identity.user.username) {
            this.owner = identity.user.username;
            const d = saved.draft || {};
            const f = creation.formats.find(x => x.id === d.kind) || creation.formats[0];
            this.reference = d.reference || '';
            this.setData({ promptInput: d.prompt || '', kind: f.id, kindName: f.name, formatDetail: f.detail, voice: d.voice || '', referencePath: d.reference || '', attempt: saved.attempt || null });
          }
          this.setData({ user: identity.user });
          return identity;
        });

        if (page === 'home') {
          await Promise.all([identityTask, this.loadWorks(valid), this.loadAgent(valid)]);
        } else if (['works', 'messages', 'card-works'].includes(page)) {
          await Promise.all([identityTask, this.loadWorks(valid)]);
        } else if (page === 'chat') {
          await Promise.all([identityTask, this.loadAgent(valid)]);
        } else {
          await identityTask;
        }

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
      const saved=wx.getStorageSync(IP12_SESSION_KEY),forceNew=saved===IP12_NEW_SESSION;
      const wantedSid=saved;
      const current=forceNew?null:(sessions.find(item=>item.sid===wantedSid)||sessions[0]);
      this.setData({agentSessions:sessions.slice(0,8),agentHistorySessions:sessions.slice(0,50).map(item=>Object.assign({},item,{selected:false}))});
      if(current&&this.properties.pageId==='chat')await this.restoreAgent(current.sid,valid);
      else if(current){wx.setStorageSync(IP12_SESSION_KEY,current.sid);this.setData({agentSessionId:current.sid,agentTargetLabel:agentSessionLabel(current)});}
      else this.setData({agentMessages:[],agentSessionId:'',agentTargetLabel:'新对话',agentDelegations:[],agentWidgets:[],agentReport:{},agentReportNotice:null,agentReportOpening:false,agentBackgroundWorking:false});
      if(!valid())return;
      const activeWaiting=waiting&&waiting.sid===this.data.agentSessionId;
      const homeDraft=local.ip12HomeDraft;
      if(this.properties.pageId==='chat'&&homeDraft&&homeDraft.sid===this.data.agentSessionId){this.agentDraft=homeDraft.message||'';this.setData({promptInput:this.agentDraft,agentHasText:!!this.agentDraft});api.save({ip12HomeDraft:null});}
      this.setData({agentPending:pending,agentThinking:!!activeWaiting,agentHomeAction:activeWaiting?'查看进度':'开始',agentProgress:activeWaiting?'正在恢复处理进度…':''});
      if((this.data.pageId||this.properties.pageId)==='home'&&this.refreshHomeAgent)this.refreshHomeAgent();
      if(this.properties.pageId==='chat'&&waiting&&waiting.sid===this.data.agentSessionId)setTimeout(()=>this.resumeAgentQueue(this.data.agentSessionId,waiting.seq).catch(error=>this.fail(error)),0);
      else if(this.properties.pageId==='chat'&&outgoing&&outgoing.status==='queued'){
        this.agentDraft=outgoing.message||'';this.setData({promptInput:this.agentDraft});
        const target=outgoing.newConversation?saved===IP12_NEW_SESSION&&!this.data.agentSessionId:saved===outgoing.sid&&this.data.agentSessionId===outgoing.sid;
        const age=Date.now()-Number(outgoing.createdAt||0),latest=api.read().ip12Outgoing;
        const same=latest&&latest.status==='queued'&&latest.createdAt===outgoing.createdAt&&latest.sid===outgoing.sid&&latest.message===outgoing.message;
        if(same){
          api.save({ip12Outgoing:null,ip12HomeDraft:{message:outgoing.message,sid:this.data.agentSessionId}});
          if(target&&age>=0&&age<=5*60*1000){
            const sid=this.data.agentSessionId,token=api.session()&&api.session().token;
            setTimeout(()=>{const w=api.read().ip12Waiting;if(!valid()||this.visible===false||sid!==this.data.agentSessionId||token!==(api.session()&&api.session().token)||wx.getStorageSync(IP12_SESSION_KEY)!==saved||(w&&w.sid===sid))return;api.save({ip12HomeDraft:null});this.sendAgent(false);},0);
          }else this.setData({error:'上次没有发送的文字已保留，请确认目标后再点发送'});
        }
      }
    },
    async restoreAgent(sid,valid=()=>this.alive) {
      const switching=sid!==this.data.agentSessionId;
      if(switching){if(this.detachAgentUploads)this.detachAgentUploads();if(this.stopAgentPoll)this.stopAgentPoll();if(this.stopTaskQueue)this.stopTaskQueue();this.setData({agentQueueTasks:[],agentQueueReconnecting:false,agentQueue:[],agentEditQueueSeq:''});}
      const data=await agentRead(IP12_API+'/restore/'+encodeURIComponent(sid)+'?limit='+AGENT_MESSAGE_LIMIT);
      if(!valid())return;
      const items=agentMessages(data.history);
      const imageHidden=limitAgentImages(items);
      // 待回复消息尚未结束时，恢复历史不能重新挂回旧操作卡。
      const awaitingReply=(this.data.agentQueue||[]).length>0||Boolean(this.data.agentPending);
      const widgets=awaitingReply?[]:agentWidgets(data.widgets,data.film,data.selected_choices);
      // 已选卡收成一行：selectedId 非空即 answered，跨轮续挂的卡也保持收起，
      // 用户点徽标展开才能改选——绝不让选过的单选卡一直挂在对话下面。
      widgets.forEach(widget=>{
        if(!widget.selectedId&&this._agentManualPicks&&this._agentManualPicks[widget.key]){
          widget.selectedId=String(this._agentManualPicks[widget.key]);
        }
        if(!widget.selectedId||widget.type==='voice_sample'||widget.layout==='template_catalog')return;
        const picked=(widget.items||[]).find(item=>String(item.id)===String(widget.selectedId));
        widget.answered=true;
        if(picked)widget.selectedTitle=picked.title;
      });
      for(const item of items){
        const resolve=raw=>api.mediaSource(api.mediaURL(ip12MediaPath(raw))).catch(()=>'');
        if(item.images.length)item.images=(await Promise.all(item.images.map(resolve))).filter(Boolean);
      }
      await Promise.all(widgets.flatMap(widget=>widget.items.map(async item=>{
        if(item.imageUrl)item.displayImage=await api.mediaSource(api.mediaURL(ip12MediaPath(item.imageUrl))).catch(()=>'');
      })));
      if(!valid())return;
      if(switching){if(this.data.agentVoiceFlow)this.closeAgentVoiceFlow();if(this.agentAudio)this.agentAudio.destroy();if(this.agentAssetAudio)this.agentAssetAudio.destroy();this.agentAudio=null;this.agentAssetAudio=null;this.agentAudioMeta=null;}
      wx.setStorageSync(IP12_SESSION_KEY,sid);
      // 勾选暂存维护：卡组换血后清掉已不在屏上的手动勾选记录
      if(!awaitingReply&&this._agentManualPicks){
        const liveKeys=new Set(widgets.map(w=>w.key));
        Object.keys(this._agentManualPicks).forEach(k=>{if(!liveKeys.has(k))delete this._agentManualPicks[k];});
      }
      const task=(data&&data.task&&typeof data.task==='object')?data.task:{};
      const agentTaskId=String(task.id||data.task_id||(sid?sid.slice(-4):'01'));
      const pendingWidgets=widgets.filter(w=>w.layout!=='template_catalog'&&!w.answered&&!w.selectedId);
      const agentTaskPendingCount=pendingWidgets.length;
      const allAnswered=widgets.length>0&&agentTaskPendingCount===0;
      const agentTaskBadgeText=agentTaskPendingCount>0?(agentTaskPendingCount+' 项待选'):'已选齐';
      const isNewTask=this._lastHandledTaskId!==agentTaskId;
      if(isNewTask){
        this._lastHandledTaskId=agentTaskId;
        this._taskDismissedForId='';
      }
      let agentTaskCollapsed=this.data.agentTaskCollapsed;
      if(isNewTask){
        agentTaskCollapsed=allAnswered;
      }else if(allAnswered&&!this.data.agentTaskManualExpanded){
        agentTaskCollapsed=true;
      }else if(!allAnswered&&agentTaskPendingCount>0&&!this.data.agentTaskManualCollapsed){
        agentTaskCollapsed=false;
      }
      if(allAnswered&&!this.data.agentTaskManualExpanded){
        agentTaskCollapsed=true;
      }
      const agentTaskDismissed=Boolean(this._taskDismissedForId&&this._taskDismissedForId===agentTaskId);
      const agentWidgetsSummary=widgets.map(w=>w.title).filter(Boolean).join(' · ');
      const agentTaskTitle=String(task.title||data.task_title||(widgets.length>1?'方案建议准备就绪':'')).slice(0,60);
      const agentTaskDesc=String(task.desc||data.task_desc||agentWidgetsSummary||'轻触可整体收起组件卡，保持对话整洁').slice(0,120);
      const defaultCollapsedDesc=allAnswered?('方案配置已就绪 · 点击展开可修改 '+widgets.length+' 项组件卡'):('方案已收起 · 点击展开 '+widgets.length+' 项组件卡');
      const agentTaskCollapsedDesc=String(task.collapsed_desc||data.task_collapsed_desc||defaultCollapsedDesc).slice(0,120);
      this.setData(Object.assign({agentMessages:items,agentSessionId:sid,agentDelegations:delegationCards(data.delegations),agentWidgets:widgets,agentTaskId,agentTaskTitle,agentTaskDesc,agentTaskCollapsedDesc,agentWidgetsSummary,agentTaskPendingCount,agentTaskBadgeText,agentTaskCollapsed,agentTaskDismissed,agentReport:data.report||null,agentHiddenCount:Math.max(0,Number(data.history_total||items.length)-items.length),agentImageHiddenCount:imageHidden,agentDeliverySubNotice:(Array.isArray(data.deliveries)?data.deliveries.length:0)>0},switching?{agentAttachments:[],agentUploads:[],agentAssets:[],agentAssetsOpen:false,agentReportNotice:null}:{}));
      // 思考结束补交：思考期间勾齐的选择，回复到达（本帧）后自动一次提交
      setTimeout(()=>{if(this.alive)this.settleAgentPicks();},0);
      this.scrollAgent(widgets.length?widgets:items);
      if(this.syncReportNotice)this.syncReportNotice(sid,data.report||null);
      if(this.startReportPoll)this.startReportPoll(sid);
      if(this.startAgentWatch)this.startAgentWatch(data.delegations);
      if(this.refreshTaskQueue)this.refreshTaskQueue();
      return data;
    },
    scrollAgent(items=this.data.agentMessages) {
      const last=items[items.length-1];
      if(!last||!this.alive)return;
      if(this.data.agentScrollTarget===last.domId)return;
      setTimeout(()=>{if(this.alive&&this.data.agentScrollTarget!==last.domId)this.setData({agentScrollTarget:last.domId});},30);
    },
    async loadWorks(valid=()=>this.alive) {
      const page=this.data.pageId||this.properties.pageId,limit=page==='home'?6:120;
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
      const covers=(page==='home'?works.slice(0,3):page==='messages'?[]:works).filter(j=>j.kind==='video'&&(j.coverUrl||j.coverFile));
      for(let i=0;i<covers.length;i+=4)await Promise.all(covers.slice(i,i+4).map(async j=>{
        if(j.coverUrl){j.displayCover=api.mediaURL(j.coverUrl);return;}   // 视频帧封面：https 直链直接显示，不走 downloadFile 域名白名单
        j.displayCover=await api.mediaSource(api.mediaURL('/api/gen/file/'+j.coverFile)).catch(()=>'');
      }));
      if(valid()){
        const q=(this.data.search||'').trim().toLowerCase(),filter=this.data.filter||'all';
        const visibleWorks=works.filter(w=>{
          const allowed=page!=='card-works'||(w.done&&['image','video'].includes(w.kind));
          const matched=page==='works'?(filter==='all'||filter==='done'&&w.done||filter==='failed'&&w.failed||filter==='processing'&&!w.done&&!w.failed):(filter==='all'||w.kind===filter);
          return allowed&&matched&&(!q||w.title.toLowerCase().includes(q));
        });
        this.setData({works,visibleWorks,hasMore:page==='works'&&batches.some(b=>b.length>=limit)});
        if(page==='home'){
          const previews=works.slice(0,2).filter(j=>j.kind==='video'&&!j.displayCover&&j.url);
          Promise.all(previews.map(async j=>{j.previewVideo=await api.mediaSource(j.url).catch(()=>'');})).then(()=>{if(valid())this.setData({works});});
        }
      }
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
    closeAgentSheet(){this.setData({agentSheet:'',agentAssetsOpen:false,agentHistoryManage:false,agentHistorySelectedCount:0,agentAssetManage:false,agentAssetSelectedCount:0});},
    keepAgentSheet(){},
    openAgentAvatar(){this.closeAgentSheet();wx.navigateTo({url:'/pages/clone/clone'});},
    cardField(e) {const key=e.currentTarget.dataset.field;if(['name','headline','company','bio','email','address'].includes(key))this.setData({['card.'+key]:e.detail.value});},
    openLegacy(e){const routes={recharge:'/pages/recharge/recharge',invite:'/pages/invite/invite',card:'/pages/my-card/my-card',inspiration:'/pages/inspiration/inspiration',ip12:'/pages/ip12/ip12'};const url=routes[e.currentTarget.dataset.legacy];if(url)wx.navigateTo({url});},
    homeShortcut(e){this.setData({promptInput:e.currentTarget.dataset.prompt||''});},
    switchTab(route){
      if(!['home','works','profile'].includes(route))return;
      const current=this.data.pageId||this.properties.pageId;
      if(current===route){
        if(typeof wx !== 'undefined' && typeof wx.pageScrollTo === 'function'){
          try{wx.pageScrollTo({scrollTop:0,duration:300});}catch(_){}
        }
        return;
      }
      if(this.stopHomeAgent)this.stopHomeAgent();
      if(typeof wx !== 'undefined' && typeof wx.pageScrollTo === 'function'){
        try{wx.pageScrollTo({scrollTop:0,duration:0});}catch(_){}
      }
      const patch={pageId:route,title:titles[route]||''};
      if(route==='works'){
        const q=(this.data.search||'').trim().toLowerCase(),filter=this.data.filter||'all';
        patch.visibleWorks=(this.data.works||[]).filter(w=>{
          const matched=(filter==='all'||filter==='done'&&w.done||filter==='failed'&&w.failed||filter==='processing'&&!w.done&&!w.failed);
          return matched&&(!q||w.title.toLowerCase().includes(q));
        });
      }
      this.setData(patch);
      if(this.properties)this.properties.pageId=route;
      const valid=()=>this.alive&&(this.data.pageId||this.properties.pageId)===route;
      if(route==='home'){
        this.loadAgent(valid);
        if(this.refreshHomeAgent)this.refreshHomeAgent();
      }else if(route==='works'){
        this.loadWorks(valid);
      }else if(route==='profile'){
        api.request('/api/auth/me').then(res=>{if(valid()&&res&&res.user)this.setData({user:res.user});}).catch(()=>{});
      }
    },
    go(e){this.navigate(e.currentTarget.dataset.route);},
    navigate(id){
      if(!pages.some(p=>p.id===id))return;
      if(this.stopHomeAgent)this.stopHomeAgent();
      const current=this.data.pageId||this.properties.pageId;
      if(['home','works','profile'].includes(id)&&['home','works','profile'].includes(current)){
        this.switchTab(id);
        return;
      }
      const navigationToken=api.session()&&api.session().token,outgoing=api.read().ip12Outgoing;
      const failed=()=>{
        this.homeEntering=false;
        if(navigationToken!==(api.session()&&api.session().token))return;
        const latest=api.read().ip12Outgoing;
        if((this.data.pageId||this.properties.pageId)==='home'&&outgoing&&latest&&latest.createdAt===outgoing.createdAt&&latest.sid===outgoing.sid&&latest.message===outgoing.message)api.save({ip12Outgoing:null});
        if(!this.alive||this.visible===false)return;
        this.setData({error:'打开页面失败，请重试；你的草稿已保留'});
        if((this.data.pageId||this.properties.pageId)==='home'&&this.refreshHomeAgent)this.refreshHomeAgent();
      };
      if(id==='login'){wx.navigateTo({url:'/pages/login/login?redirect=paper',fail:failed});return;}
      const url='/paper/pages/'+id+'/index';
      if(['home','works','profile'].includes(id))wx.redirectTo({url,fail:()=>wx.reLaunch({url,fail:failed})});
      else wx.navigateTo({url,fail:()=>wx.redirectTo({url,fail:failed})});
    },
    back(){if(getCurrentPages().length>1)wx.navigateBack();else this.navigate('home');},
    requireLogin(){if(api.session())return true;this.navigate('login');return false;},
    consentChange(e){this.setData({consent:e.detail.value.includes('agree')});},
    login(){this.run(async()=>{if(!this.data.consent)throw new Error('请阅读并同意账号登录说明');if(!this.data.username.trim()||!this.data.password)throw new Error('请填写账号与密码');await api.login(this.data.username,this.data.password);this.setData({password:''});this.navigate('home');});},
    logout(){this.run(async()=>{try{await api.request('/api/auth/logout','POST',{});}catch(_){}api.setSession(null);this.setData({user:null,password:'',works:[],card:emptyCard});this.navigate('login');});},
    chooseKind(e){const kind=e.currentTarget.dataset.kind;const f=creation.format(kind);this.setData({kind,kindName:f.name,formatDetail:f.detail,quote:null});if(kind==='audio'&&api.session())this.run(()=>this.loadVoices());},
    draft(){return {kind:this.data.kind,prompt:this.data.promptInput,voice:this.data.voice,reference:this.reference||''};},
    startChat(){
      if(this.data.busy||this.homeEntering)return;
      if(!this.requireLogin())return;
      const message=this.data.promptInput.trim();
      const sid=this.data.agentSessionId||'';
      const waiting=api.read().ip12Waiting;
      wx.setStorageSync(IP12_SESSION_KEY,sid||IP12_NEW_SESSION);
      if((waiting&&waiting.sid===sid)||this.data.agentHomeAction&&this.data.agentHomeAction!=='开始'){
        api.save({ip12Outgoing:null,ip12HomeDraft:{message,sid}});
      }else if(message)api.save({ip12HomeDraft:null,ip12Outgoing:{message,sid,newConversation:!sid,status:'queued',createdAt:Date.now()}});
      else api.save({ip12Outgoing:null,ip12HomeDraft:null});
      this.stopHomeAgent();this.homeEntering=true;
      this.navigate('chat');
    },
    stopHomeAgent(){clearTimeout(this.homeAgentTimer);this.homeAgentTimer=null;this.homeAgentEpoch=(this.homeAgentEpoch||0)+1;},
    clearAgentWaiting(sid,seq){const current=api.read().ip12Waiting;if(current&&current.sid===sid&&Number(current.seq)===Number(seq)){api.save({ip12Waiting:null});return true;}return false;},
    async refreshHomeAgent(){
      this.stopHomeAgent();const epoch=this.homeAgentEpoch,sid=this.data.agentSessionId,waiting=api.read().ip12Waiting,token=api.session()&&api.session().token;
      if((this.data.pageId||this.properties.pageId)!=='home'||!this.alive||this.visible===false||!waiting||waiting.sid!==sid)return;
      const valid=()=>this.alive&&this.visible!==false&&(this.data.pageId||this.properties.pageId)==='home'&&epoch===this.homeAgentEpoch&&sid===this.data.agentSessionId&&token===(api.session()&&api.session().token);
      let delay=5000;
      try{
        const state=await api.request(IP12_API+'/poll/'+encodeURIComponent(sid),'GET',null,{timeout:5000});if(!valid())return;
        let complete=(state.state==='done'||state.state==='error')&&Number(state.seq)>=Number(waiting.seq);
        if(state.state==='idle'){
          const restored=await agentRead(IP12_API+'/restore/'+encodeURIComponent(sid)+'?limit='+AGENT_MESSAGE_LIMIT);if(!valid())return;
          // Only an explicit sequence watermark proves this particular reply was saved.
          complete=Number(restored.seq)>=Number(waiting.seq)&&Array.isArray(restored.history)&&restored.history.some(item=>item.role==='assistant');
        }
        if(complete&&this.clearAgentWaiting(sid,waiting.seq)){this.setData({agentThinking:false,agentHomeAction:'查看回复',agentProgress:''});this.settleAgentPicks();return;}
        this.setData({agentThinking:state.state==='working',agentHomeAction:state.state==='working'?'查看进度':'查看对话',agentProgress:state.state==='working'?'黄雀正在回复…':'暂时无法确认回复进度，可进入对话查看'});
      }catch(_){if(!valid())return;delay=15000;this.setData({agentThinking:false,agentHomeAction:'查看对话',agentProgress:'暂时无法获取进度，可进入对话查看'});}
      if(valid())this.homeAgentTimer=setTimeout(()=>this.refreshHomeAgent(),delay);
    },
    freezeRecentVideoPreview(e){
      const player=wx.createVideoContext&&wx.createVideoContext(e.currentTarget.id,this);
      if(player)setTimeout(()=>player.pause(),120);
    },
    chooseHomeAgentTarget(){
      const sessions=this.data.agentSessions||[];
      const labels=['＋ 开始新对话'].concat(sessions.map(item=>((item.sid===this.data.agentSessionId?'当前 · ':'')+(item.preview||'以前的对话').replace(/\s+/g,' ')+(item.turns?' · '+item.turns+'轮':'')).slice(0,28)));
      wx.showActionSheet({itemList:labels,success:result=>{if(result.tapIndex===0)return this.useNewHomeAgentSession();const item=sessions[result.tapIndex-1];if(item){api.save({ip12Outgoing:null,ip12HomeDraft:null});wx.setStorageSync(IP12_SESSION_KEY,item.sid);this.stopHomeAgent();this.setData({agentSessionId:item.sid,agentTargetLabel:agentSessionLabel(item),agentThinking:false,agentHomeAction:'开始',agentProgress:''});this.refreshHomeAgent();}}});
    },
    useNewHomeAgentSession(){
      api.save({ip12Outgoing:null,ip12HomeDraft:null});wx.setStorageSync(IP12_SESSION_KEY,IP12_NEW_SESSION);
      this.stopHomeAgent();this.setData({agentSessionId:'',agentTargetLabel:'新对话',agentThinking:false,agentHomeAction:'开始',agentProgress:''});
    },
    sendPrompt(){return this.sendAgent(false);},
    sendAgent() {
      if(!this.requireLogin())return;
      if(this.data.agentEditQueueSeq)return this.saveQueueEdit();
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
    sendAgentMessage(message,approval,widgetAction,displayText) {
      return this.run(async()=>{
        const sid=await this.ensureAgentSession();
        // 发消息只把上一轮的卡先让位（清屏），绝不记成「永久关闭」：
        // 卡片是否回来由后端每轮下发的卡组决定（批次收敛 + 跨轮续挂）。
        // 旧写法把整批卡记进 ip12DismissedWidgets，用户点选过的文案卡/续挂卡
        // 从此再也不上屏——打字改选后「文案卡消失」就是这么来的（报障台 #10）。
        if(!approval&&this.data.agentWidgets&&this.data.agentWidgets.length)this.setData({agentWidgets:[]});
        if(!approval&&!widgetAction)this.setData({agentTaskCollapsed:true,agentTaskManualExpanded:false});
        const body={session_id:sid,message:String(message||'').trim()};
        const attachments=approval?[]:(this.data.agentAttachments||[]).slice();
        if(attachments.length)body.attachments=attachments.map(item=>item.fileId);
        if(approval)body.approval=approval;
        if(widgetAction)body.widget_action=widgetAction;
        const pending={sid,body,attachments,status:'sending',createdAt:Date.now()};
        const domId='agent-local-'+Date.now();
        api.save({ip12Pending:pending,ip12Outgoing:null});if(!approval)this.agentDraft='';this.setData({agentPending:pending,agentThinking:true,promptInput:approval?this.data.promptInput:'',agentHasText:approval?this.data.agentHasText:false,agentAttachments:[],agentAssetsOpen:false,agentIpDrawerOpen:false,agentSheet:'',agentMessages:this.data.agentMessages.concat({domId,role:'user',content:displayText||body.message,images:[],videos:[],attachments})});
        this.scrollAgent();
        await this.executeAgent(pending,domId);
      });
    },
    async executeAgent(pending,domId) {
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
      // 消息队列：后端按到达顺序排队跑；本地队列只是展示+插队/编辑的操作面板。
      // 队首（含正在回复的那条）完成并被 /poll 交付后才出队，ip12Waiting 始终指向队首。
      const q=(this.data.agentQueue||[]).concat({seq:String(data.seq),message:pending.body.message,ts:Date.now(),status:'queued',domId:domId||''});
      api.save({ip12Pending:null,ip12Waiting:{sid:pending.sid,seq:Number(q[0].seq)}});
      this.setData({agentPending:null,agentQueue:q,agentThinking:true,agentProgress:'正在理解你的要求…'});
      this.agentPoll=this.pollAgent(pending.sid,Number(q[0].seq)).catch(error=>this.fail(error));
    },
    async updateAgentProgress(sid,valid=()=>true){
      let status;
      try{status=await api.request(IP12_API+'/status/'+encodeURIComponent(sid),'GET',null,{timeout:5000});}catch(_){return;}
      if(!valid()||!this.alive||!this.data.agentThinking)return;
      const active=(status.turns||[]).filter(item=>item.state==='working').sort((a,b)=>Number(b.elapsed||0)-Number(a.elapsed||0))[0]||{};
      const elapsed=Math.max(0,Math.floor(Number(active.elapsed||0)));
      const domain=String(status.tool&&status.tool.domain||'');
      const labels={compose:'正在整理视频方案…',image:'正在处理图片…',collect:'正在读取素材…',copy:'正在整理文案…',audio:'正在处理声音…',video:'正在处理视频…'};
      const text=labels[domain]||'正在理解你的要求…';
      this.setData({agentProgress:text+(elapsed>=3?' 已等待 '+elapsed+' 秒':'')});
    },
    // 报告轮询：对齐网页端 pollReport()。报告只在后台生成、且不会追加会话消息，
    // 只能主动拉 /api/report/<sid>，否则小程序永远看不到报告完成。
    // 到 final/confirmed/failed 且选题/口播（m5/m6）都不在生成/校验时才停；
    // 长时间无变化（REPORT_POLL_MAX_IDLE 拍）也停，下次 restoreAgent（加载、每轮对话结束）会重新启动。
    startReportPoll(sid){
      this.stopReportPoll();
      if(!sid)return;
      const token=api.session()&&api.session().token;
      const owner={sid,token,timer:null,idle:0};
      this.reportPollOwner=owner;
      const valid=()=>this.alive&&this.visible!==false&&this.reportPollOwner===owner&&sid===this.data.agentSessionId&&token===(api.session()&&api.session().token);
      const tick=()=>{
        owner.timer=null; // 句柄已消费；只有真要续轮询时才重新排，停下来时状态是干净的
        if(!valid())return;
        api.request('/workbench/ip12/api/report/'+encodeURIComponent(sid),'GET',null,{timeout:5000})
          .then(data=>{
            if(!valid())return;
            const next=data&&typeof data==='object'?data:{};
            const prev=this.data.agentReport||{};
            const changed=JSON.stringify(next)!==JSON.stringify(prev);
            if(changed)this.setData({agentReport:next});
            if(this.syncReportNotice)this.syncReportNotice(sid,next);
            const status=String(next.status||'');
            // 选题/口播（m5/m6）可能晚于定稿才开跑：报告到了 final/confirmed/failed，
            // 只要模块还在生成/校验，轮询就继续，把「口播 · 生成中」这类进度一路跟到完成。
            const modStatus=s=>String((s&&s.status)||'');
            const modActive=/_(generating|validated)$/.test(modStatus(next&&next.m5))||/_(generating|validated)$/.test(modStatus(next&&next.m6));
            const terminal=status==='final'||status==='confirmed'||status==='failed';
            if(terminal&&!modActive)return;
            // 空状态继续计数；模块卡在生成态但长时间无任何变化，也计数（防止永远轮询）。
            owner.idle=(!status&&!modActive)||(modActive&&!changed)?owner.idle+1:0;
            if(owner.idle>REPORT_POLL_MAX_IDLE)return;
            owner.timer=setTimeout(tick,REPORT_POLL_INTERVAL);
          })
          .catch(error=>{
            if(!valid())return;
            if(error&&[401,403,404].includes(error.status))return;
            owner.idle+=1;
            if(owner.idle>REPORT_POLL_MAX_IDLE)return;
            owner.timer=setTimeout(tick,REPORT_POLL_INTERVAL);
          });
      };
      owner.timer=setTimeout(tick,REPORT_POLL_INTERVAL);
    },
    stopReportPoll(){const owner=this.reportPollOwner;this.reportPollOwner=null;if(owner&&owner.timer)clearTimeout(owner.timer);},
    startAgentWatch(delegations){
      clearTimeout(this.agentWatchTimer);
      const active=agentBackgroundActive({delegations});
      this.agentWatchActive=active;this.agentDeliverySignature='';
      // 渲染用时：后端 started_at 优先（刷新页面不重置）；拿不到就本端起算
      if(active&&!this.renderStartTs){
        let ts=0;
        Object.keys(delegations||{}).forEach(d=>{const t=delegations[d]&&delegations[d].started_at;if(typeof t==='number'&&t>0&&(!ts||t<ts))ts=t;});
        this.renderStartTs=ts*1000||Date.now();
      }else if(!active){this.renderStartTs=0;}
      this.setData(Object.assign({agentBackgroundWorking:active,agentDeliverySubNotice:active?false:this.data.agentDeliverySubNotice},active?{agentWorkingElapsed:fmtWorkElapsed(Date.now()-(this.renderStartTs||Date.now()))}:{agentWorkingElapsed:''}));
      if(active&&this.alive&&this.visible!==false)this.agentWatchTimer=setTimeout(()=>this.watchAgent(this.data.agentSessionId),AGENT_WATCH_INTERVAL);
    },
    async watchAgent(sid){
      if(!sid||!this.alive||this.visible===false||sid!==this.data.agentSessionId)return;
      let status;
      try{status=await api.request(IP12_API+'/status/'+encodeURIComponent(sid),'GET',null,{timeout:5000});}
      catch(_){if(this.alive&&sid===this.data.agentSessionId&&!this.data.agentQueueReconnecting)this.setData({agentQueueReconnecting:true});if(this.agentWatchActive)this.agentWatchTimer=setTimeout(()=>this.watchAgent(sid),AGENT_WATCH_INTERVAL);return;}
      if(!this.alive||this.visible===false||sid!==this.data.agentSessionId)return;
      const nextTasks=taskQueue.merge(this.data.agentQueueTasks,taskQueue.collect(status),sid);
      if(JSON.stringify(nextTasks)!==JSON.stringify(this.data.agentQueueTasks)||this.data.agentQueueReconnecting){
        this.setData({agentQueueTasks:nextTasks,agentQueueReconnecting:false});
      }
      const visual=status.visual_preprocess;
      const visualText=visual?('画面素材：'+Number(visual.ready_count||0)+' 个可用镜头'+(visual.processing_count?'，正在后台整理，可继续聊天':'')+(visual.failed_count?'；有原片整理失败，可重试':'')):'';
      if(this.data.agentVisualStatus!==visualText)this.setData({agentVisualStatus:visualText});
      const active=agentBackgroundActive(status),signature=agentDeliverySignature(status);
      const refresh=(this.agentWatchActive&&!active)||Boolean(this.agentDeliverySignature&&signature!==this.agentDeliverySignature);
      this.agentWatchActive=active;this.agentDeliverySignature=signature;
      if(refresh){await this.restoreAgent(sid);return;}
      if(active&&!this.renderStartTs)this.renderStartTs=Date.now();
      if(!active)this.renderStartTs=0;
      const nextElapsed=active?fmtWorkElapsed(Date.now()-(this.renderStartTs||Date.now())):''
      if(this.data.agentBackgroundWorking!==active||this.data.agentWorkingElapsed!==nextElapsed){
        this.setData({agentBackgroundWorking:active,agentWorkingElapsed:nextElapsed});
      }
      if(active)this.agentWatchTimer=setTimeout(()=>this.watchAgent(sid),AGENT_WATCH_INTERVAL);
    },
    async resumeAgentQueue(sid,fallbackSeq){
      // 页面重新打开/刷新后重建消息队列：排队中的消息以后端 /status 的 queue 为准
      // （服务器是权威，页面关了也照样排队跑）；正在跑的那条不在 queue 里，用本地等待记录补。
      let status=null;
      try{status=await api.request(IP12_API+'/status/'+encodeURIComponent(sid),'GET',null,{timeout:5000});}catch(_){}
      if(!this.alive||this.visible===false||sid!==this.data.agentSessionId)return;
      const q=(status&&Array.isArray(status.queue)?status.queue:[]).map(item=>({seq:String(item.seq),message:String(item.message||''),ts:Number(item.ts||0),status:'queued',domId:''}));
      if(q.length){
        api.save({ip12Waiting:{sid,seq:Number(q[0].seq)}});
        this.setData({agentQueue:q,agentThinking:true});
        this.agentPoll=this.pollAgent(sid,Number(q[0].seq)).catch(error=>this.fail(error));
      }else if(fallbackSeq){
        api.save({ip12Waiting:{sid,seq:Number(fallbackSeq)}});
        this.setData({agentQueue:[{seq:String(fallbackSeq),message:'',ts:0,status:'queued',domId:''}],agentThinking:true});
        this.agentPoll=this.pollAgent(sid,Number(fallbackSeq)).catch(error=>this.fail(error));
      }
    },
    stopAgentPoll(){const owner=this.agentPollOwner;this.agentPollOwner=null;if(owner){clearTimeout(owner.timer);if(owner.wake)owner.wake();}},
    pollAgent(sid,target){
      // 消息队列轮询：owner 按目标轮次号管理（新目标接管、旧目标晚到的结果一律丢弃），
      // 消费按队列 FIFO 进行。比队首还早的目标是过时的旧等待，直接不接管。
      const token=api.session()&&api.session().token,old=this.agentPollOwner;
      if(!this.alive||this.visible===false||sid!==this.data.agentSessionId||!token)return Promise.resolve();
      const targetNum=Number(target);
      if(!Number.isFinite(targetNum)||targetNum<=0)return Promise.resolve();
      const q=this.data.agentQueue||[];
      if(q.length&&targetNum<Number(q[0].seq))return Promise.resolve();
      if(!q.some(item=>Number(item.seq)===targetNum)){
        const placeholder={seq:String(targetNum),message:'',ts:0,status:'queued',domId:''};
        this.setData({agentQueue:q.length?q.concat([placeholder]):[placeholder]});
      }
      if(old&&old.sid===sid&&Number(old.target)===targetNum&&old.token===token)return old.promise;
      this.stopAgentPoll();
      const owner={sid,target:targetNum,token,timer:null,wake:null};this.agentPollOwner=owner;
      owner.promise=Promise.resolve().then(()=>this.pollAgentStep(sid,owner,0)).finally(()=>{if(this.agentPollOwner===owner)this.stopAgentPoll();});
      return owner.promise;
    },
    async pollAgentStep(sid,owner,tries) {
      if(!this.alive||this.visible===false||sid!==this.data.agentSessionId)return;
      const token=owner.token;
      const uiValid=()=>{return this.agentPollOwner===owner&&this.alive&&this.visible!==false&&sid===this.data.agentSessionId&&token===(api.session()&&api.session().token)&&(this.data.agentQueue||[]).some(item=>Number(item.seq)===owner.target);};
      if(!uiValid())return;
      if(tries>=240){this.setData({agentThinking:false,agentProgress:'处理时间较长，重新打开可查看进度'});this.settleAgentPicks();return;}
      let data;
      try{data=await api.request(IP12_API+'/poll/'+encodeURIComponent(sid));}
      catch(error){if(!uiValid())return;if(error.status&&error.status<500)throw error;data={state:'working'};}
      if(!uiValid())return;
      if(data.state==='done'||data.state==='error'){
        // /poll 按 FIFO 交付已完成轮次：完成帧的 seq 覆盖到目标轮次时，把队列里
        // seq ≤ 该帧的条目一并消费（连续完成时一次补齐）；晚到的旧帧按 uiValid 丢弃。
        if(Number(data.seq)>=owner.target){
          let q=(this.data.agentQueue||[]).slice();
          while(q.length&&Number(data.seq)>=Number(q[0].seq))q=q.slice(1);
          // 等待记录只跟随被消费的进度走：队列空了但等待记录比本帧更新
          // （别的流程已接管）→ 本帧算过期，丢弃，绝不清、绝不下调。
          const w=api.read().ip12Waiting;
          if(!q.length&&w&&w.sid===sid&&Number(w.seq)>Number(data.seq))return;
          if(q.length)api.save({ip12Waiting:{sid,seq:Number(q[0].seq)}});
          else if(!w||(w.sid===sid&&Number(w.seq)<=Number(data.seq)))api.save({ip12Waiting:null});
          this.setData({agentQueue:q});
          const stillHere=()=>this.alive&&this.visible!==false&&sid===this.data.agentSessionId&&token===(api.session()&&api.session().token);
          await this.restoreAgent(sid,stillHere);
          if(stillHere())this.setData({agentProgress:''});
          if(!q.length){if(stillHere()){this.setData({agentThinking:false});this.settleAgentPicks();}return;}
          if(stillHere()){this.agentPollOwner=null;this.agentPoll=this.pollAgent(sid,Number(q[0].seq)).catch(error=>this.fail(error));}
          return;
        }
      }
      if(data.state==='idle'&&tries>=3){
        await this.restoreAgent(sid,uiValid);
        if(uiValid())this.setData({agentThinking:false,agentProgress:'暂时无法确认回复进度，等待记录已保留'});
        if(uiValid())this.settleAgentPicks();
        return;
      }
      if(tries%2===0)await this.updateAgentProgress(sid,uiValid);
      if(!uiValid())return;
      await new Promise(resolve=>{owner.wake=resolve;owner.timer=setTimeout(resolve,2500);});owner.wake=null;owner.timer=null;
      if(!uiValid())return;
      return this.pollAgentStep(sid,owner,tries+1);
    },
    // ---- 消息队列操作：插队 / 重新编辑 ----
    jumpQueueItem(e){
      const seq=String(e.currentTarget.dataset.seq||'');
      if(!seq)return;
      return this.run(async()=>{
        const sid=this.data.agentSessionId;
        await api.request(IP12_API+'/queue/'+encodeURIComponent(sid)+'/jump','POST',{seq});
        const q=(this.data.agentQueue||[]).slice();
        const idx=q.findIndex(item=>String(item.seq)===seq);
        if(idx>0){const item=q.splice(idx,1)[0];q.unshift(item);this.setData({agentQueue:q});}
        this.toast('已插到最前，下一条就处理它');
      }).catch(error=>{if(error&&error.message)this.toast(error.message);});
    },
    editQueueItem(e){
      const seq=String(e.currentTarget.dataset.seq||'');
      const item=(this.data.agentQueue||[]).find(x=>String(x.seq)===seq);
      if(!item)return;
      this.agentDraft=item.message||'';
      this.setData({agentEditQueueSeq:seq,promptInput:item.message||'',agentHasText:Boolean(item.message)});
    },
    cancelQueueEdit(){
      this.agentDraft='';
      this.setData({agentEditQueueSeq:'',promptInput:'',agentHasText:false});
    },
    saveQueueEdit(){
      const seq=this.data.agentEditQueueSeq;
      if(!seq)return;
      const message=String(this.agentDraft===undefined?this.data.promptInput:this.agentDraft).trim();
      if(!message)return this.toast('内容不能为空');
      return this.run(async()=>{
        const sid=this.data.agentSessionId;
        await api.request(IP12_API+'/queue/'+encodeURIComponent(sid)+'/edit','POST',{seq,message});
        const q=(this.data.agentQueue||[]).map(item=>String(item.seq)===seq?Object.assign({},item,{message}):item);
        // 同步更新这条消息已经渲染的用户气泡，避免「面板改了一句话、气泡还是旧话」
        const msgs=(this.data.agentMessages||[]).map(m=>{
          const hit=q.find(x=>x.domId&&x.domId===m.domId);
          return hit?Object.assign({},m,{content:hit.message}):m;
        });
        this.agentDraft='';
        this.setData({agentQueue:q,agentEditQueueSeq:'',promptInput:'',agentHasText:false,agentMessages:msgs});
        this.toast('已保存修改');
      }).catch(error=>{if(error&&error.message)this.toast(error.message);});
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
      if(this.stopAgentPoll)this.stopAgentPoll();this.stopTaskQueue();if(this.detachAgentUploads)this.detachAgentUploads();this.setData({agentQueueTasks:[],agentQueueReconnecting:false});
      if(this.data.agentVoiceFlow)this.closeAgentVoiceFlow();
      wx.setStorageSync(IP12_SESSION_KEY,sid);api.save({ip12Pending:null,ip12Waiting:{sid,seq:started.seq},ip12Outgoing:null});
      clearTimeout(this.agentWatchTimer);this.agentWatchActive=false;
      const sessions=[{sid,preview:'新对话',turns:0,selected:false}].concat((this.data.agentHistorySessions||[]).filter(item=>item.sid!==sid)).slice(0,50);
      this.agentDraft='';this.setData({agentSessionId:sid,agentMessages:[],promptInput:'',agentHasText:false,agentAttachments:[],agentUploads:[],agentAssets:[],agentVisibleAssets:[],agentAssetsOpen:false,agentIpDrawerOpen:false,agentSheet:'',agentDelegations:[],agentWidgets:[],agentReport:{},agentReportNotice:null,agentReportOpening:false,agentHiddenCount:0,agentImageHiddenCount:0,agentThinking:true,agentProgress:'正在准备新对话…',agentBackgroundWorking:false,agentSessions:sessions.slice(0,8),agentHistorySessions:sessions});
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
      const count=Math.max(1,Math.min(9,AGENT_ATTACHMENT_LIMIT-(this.data.agentAttachments||[]).length));
      wx.chooseMedia({count,mediaType:[kind],sizeType:['original'],sourceType:['album','camera'],maxDuration:60,success:result=>this.uploadAgentFiles((result.tempFiles||[]).map((file,index)=>({path:file.tempFilePath,name:file.name||(kind==='image'?'图片 ':'视频 ')+(index+1),kind,size:Number(file.size||0)}))),fail:error=>{if(!/cancel/i.test(String(error&&error.errMsg||'')))this.fail(new Error('无法选择'+(kind==='image'?'图片':'视频')+'，请检查微信权限'));}});
    },
    chooseAgentAudio(){
      if(this.data.busy||this.data.agentThinking)return;
      this.setData({agentSheet:''});
      wx.chooseMessageFile({count:Math.max(1,Math.min(9,AGENT_ATTACHMENT_LIMIT-(this.data.agentAttachments||[]).length)),type:'file',extension:['mp3','wav','m4a','aac','ogg'],success:result=>this.uploadAgentFiles((result.tempFiles||[]).map(file=>({path:file.path,name:file.name||file.path,kind:'audio',size:Number(file.size||0)}))),fail:error=>{if(!/cancel/i.test(String(error&&error.errMsg||'')))this.fail(new Error('无法选择音频，请从微信文件中选择'));}});
    },
    uploadOwner(sid,token,epoch){const user=api.session()&&api.session().user;return ()=>this.alive!==false&&Number(this.agentUploadEpoch||0)===epoch&&sid===this.data.agentSessionId&&token===(api.session()&&api.session().token)&&(!user||user.username===(api.session()&&api.session().user&&api.session().user.username));},
    detachAgentUploads(){this.agentUploadEpoch=(this.agentUploadEpoch||0)+1;this.agentUploadQueue=[];this.agentUploadSessionPromise=null;},
    updateAgentUpload(id,patch){this.setData({agentUploads:(this.data.agentUploads||[]).map(item=>item.id===id?Object.assign({},item,patch):item)});},
    reservedAgentAttachments(){return (this.data.agentAttachments||[]).length+(this.data.agentUploads||[]).filter(item=>item.attach&&item.status!=='done'&&item.status!=='error').length;},
    pumpAgentUploads(){
      this.agentUploadQueue=this.agentUploadQueue||[];this.agentUploadInFlight=this.agentUploadInFlight||0;
      while(this.agentUploadInFlight<2&&this.agentUploadQueue.length){const item=this.agentUploadQueue.shift();if(!item.active()){item.resolve({detached:true});continue;}this.agentUploadInFlight+=1;this.runAgentUpload(item).finally(()=>{this.agentUploadInFlight-=1;this.pumpAgentUploads();});}
    },
    async runAgentUpload(item){
      if(!item.active())return item.resolve({detached:true});
      this.updateAgentUpload(item.id,{status:'uploading',statusText:'上传中 0%',progress:0});
      try{
        const result=await api.upload(IP12_API+(item.libraryImport?'/assets/import':'/upload'),item.path,{session_id:item.sid},{onProgress:progress=>{if(item.active())this.updateAgentUpload(item.id,{status:progress>=100?'saving':'uploading',statusText:progress>=100?'保存中':'上传中 '+progress+'%',progress});}});
        if(result.kind==='video'&&item.active()&&this.watchAgent){this.setData({agentVisualStatus:'视频已收到，正在后台整理镜头，可以继续聊天'});this.agentWatchActive=true;clearTimeout(this.agentWatchTimer);this.agentWatchTimer=setTimeout(()=>this.watchAgent(item.sid),1000);}
        if(!item.active())return item.resolve({detached:true});
        if(item.libraryImport&&result.asset&&result.asset.quota_exceeded)throw new Error('素材库空间已满');
        if(item.attach)this.addAgentAttachment({fileId:result.file_id,name:item.name||result.name,kind:result.kind||item.kind,preview:item.path,url:result.url||'',status:'done',statusText:'已完成'});
        else if(Number(this.data.agentAssetQuotaRemaining)>=0)this.setData({agentAssetQuotaRemaining:Math.max(0,Number(this.data.agentAssetQuotaRemaining)-item.size)});
        this.updateAgentUpload(item.id,{status:'done',statusText:'已完成',progress:100,error:''});item.resolve({done:true});
      }catch(error){
        if(!item.active())return item.resolve({detached:true});
        const message=error&&error.message||'上传失败，请重试';this.updateAgentUpload(item.id,{status:'error',statusText:'上传失败',error:message,progress:0});item.resolve({error:message});
      }
    },
    async uploadAgentFiles(files,options={}){
      const source=(files||[]).filter(file=>file&&file.path);if(!source.length)return [];
      const sid=this.data.agentSessionId||await (this.agentUploadSessionPromise||(this.agentUploadSessionPromise=Promise.resolve(this.ensureAgentSession()).finally(()=>{this.agentUploadSessionPromise=null;})));if(!this.data.agentSessionId)this.setData({agentSessionId:sid});
      const token=api.session()&&api.session().token,epoch=this.agentUploadEpoch||0,libraryImport=options.attach===false,remaining=Number(this.data.agentAssetQuotaRemaining),reservedBytes=(this.data.agentUploads||[]).filter(item=>item.libraryImport&&['queued','uploading','saving'].includes(item.status)).reduce((sum,item)=>sum+item.size,0),totalBytes=source.reduce((sum,file)=>sum+Math.max(0,Number(file.size)||0),0);
      if(libraryImport&&remaining>=0&&reservedBytes+totalBytes>remaining){const error=new Error('素材库剩余空间不足，请先删除不用的素材');if(this.fail)this.fail(error);return [];}
      const reserved=this.reservedAgentAttachments?this.reservedAgentAttachments():(this.data.agentAttachments||[]).length+(this.data.agentUploads||[]).filter(item=>item.attach&&item.status!=='done'&&item.status!=='error').length,available=Math.max(0,AGENT_ATTACHMENT_LIMIT-reserved),accepted=libraryImport?source:source.slice(0,available);
      if(!accepted.length){this.toast('一次最多发送 10 个素材');return [];}
      const active=this.uploadOwner(sid,token,epoch),base=Date.now(),jobs=accepted.map((file,index)=>{
        const item={id:'upload-'+base+'-'+(this.agentUploadSerial=(this.agentUploadSerial||0)+1),sid,path:file.path,name:file.name||'文件',kind:file.kind||'',size:Math.max(0,Number(file.size)||0),attach:!libraryImport,libraryImport,status:'queued',statusText:'排队中',progress:0,error:'',active,resolve:null};
        const done=new Promise(resolve=>{item.resolve=resolve;});this.agentUploadQueue=(this.agentUploadQueue||[]).concat(item);return done;
      });
      const queued=accepted.map((file,index)=>({id:'upload-'+base+'-'+(this.agentUploadSerial-accepted.length+index+1),sid,path:file.path,name:file.name||'文件',kind:file.kind||'',size:Math.max(0,Number(file.size)||0),attach:!libraryImport,libraryImport,status:'queued',statusText:'排队中',progress:0,error:''}));
      this.setData({agentUploads:(this.data.agentUploads||[]).concat(queued)});this.pumpAgentUploads();
      const settled=await Promise.all(jobs);
      if(libraryImport&&active())await this.loadAgentAssets(true).catch(()=>{});
      if(libraryImport&&active()&&settled.some(item=>item.done))this.toast('已导入 '+settled.filter(item=>item.done).length+' 个素材');
      return settled;
    },
    retryAgentUpload(e){
      const id=e.currentTarget.dataset.id,item=(this.data.agentUploads||[]).find(entry=>entry.id===id);if(!item||item.status!=='error')return;
      if(item.attach&&this.reservedAgentAttachments()>=AGENT_ATTACHMENT_LIMIT)return this.toast('一次最多发送 10 个素材');
      const sid=this.data.agentSessionId,token=api.session()&&api.session().token,epoch=this.agentUploadEpoch||0;if(!sid||item.sid!==sid)return;
      const queued=Object.assign({},item,{status:'queued',statusText:'排队中',progress:0,error:'',active:this.uploadOwner(sid,token,epoch),resolve:()=>{}});this.updateAgentUpload(id,{status:'queued',statusText:'排队中',progress:0,error:''});this.agentUploadQueue=(this.agentUploadQueue||[]).concat(queued);this.pumpAgentUploads();
    },
    removeAgentAttachment(e){
      const index=Number(e.currentTarget.dataset.index);
      this.setData({agentAttachments:(this.data.agentAttachments||[]).filter((_,i)=>i!==index)});
    },
    previewAgentAttachment(e){
      const item=this.data.agentAttachments[Number(e.currentTarget.dataset.index)];if(!item||!item.preview)return;
      if(this.agentAssetAudio)this.agentAssetAudio.destroy();const audio=wx.createInnerAudioContext();this.agentAssetAudio=audio;audio.obeyMuteSwitch=false;audio.src=item.preview;audio.play();this.toast('正在播放音频');
    },
    toggleAgentAssets(){if(this.data.agentSheet==='assets')return this.closeAgentSheet();this.setData({agentSheet:'assets',agentAssetsOpen:true,agentAssetManage:false,agentAssetSelectedCount:0});return this.run(()=>this.loadAgentAssets(true));},
    async loadAgentAssets(reset){
      const sid=await this.ensureAgentSession(),source=this.data.agentAssetSource||'all',offset=reset?0:(this.data.agentAssets||[]).length;
      const data=await api.request(IP12_API+'/assets?session_id='+encodeURIComponent(sid)+'&filter='+encodeURIComponent(source)+'&limit=24&offset='+offset);
      if(sid!==this.data.agentSessionId||source!==(this.data.agentAssetSource||'all'))return;
      if(data.degraded)throw new Error(data.error||'主站作品暂时读不到，请稍后重试');
      const next=(data.assets||[]).map(agentAssetView);
      await Promise.all(next.map(async item=>{if(item.thumb&&item.kind!=='audio')item.displayThumb=await api.mediaSource(api.mediaURL(ip12MediaPath(item.thumb))).catch(()=>'');}));
      const assets=reset?next:(this.data.agentAssets||[]).concat(next),quota=data.quota||{};
      this.setData({agentAssets:assets,agentAssetTotal:Number(data.total)||assets.length,agentAssetQuota:quota.limit?'已用 '+formatBytes(quota.used)+' / '+formatBytes(quota.limit):'主站作品单独管理',agentAssetQuotaRemaining:quota.limit?Math.max(0,Number(quota.limit)-Number(quota.used||0)):-1,agentAssetHasMore:assets.length<Number(data.total||0),agentAssetManage:false,agentAssetSelectedCount:0});
      this.applyAgentAssetFilter();
    },
    applyAgentAssetFilter(){const kind=this.data.agentAssetKind||'all';this.setData({agentVisibleAssets:(this.data.agentAssets||[]).filter(item=>kind==='all'||item.kind===kind)});},
    selectAgentAssetKind(e){if(this.data.busy)return;this.setData({agentAssetKind:e.currentTarget.dataset.kind||'all',agentAssetSelectedCount:0,agentAssets:this.data.agentAssets.map(item=>Object.assign({},item,{selected:false}))});this.applyAgentAssetFilter();},
    selectAgentAssetSource(e){if(this.data.busy)return;this.setData({agentAssetSource:e.currentTarget.dataset.source||'all',agentAssets:[],agentVisibleAssets:[],agentAssetManage:false,agentAssetSelectedCount:0});return this.run(()=>this.loadAgentAssets(true));},
    loadMoreAgentAssets(){if(this.data.agentAssetHasMore&&!this.data.busy)return this.run(()=>this.loadAgentAssets(false));},
    chooseAgentAssetImport(e){
      const kind=e.currentTarget.dataset.kind;
      if(kind==='audio')return wx.chooseMessageFile({count:9,type:'file',extension:['mp3','wav','m4a','aac','ogg'],success:result=>this.uploadAgentFiles((result.tempFiles||[]).map(file=>({path:file.path,name:file.name||file.path,kind:'audio',size:Number(file.size||0)})),{attach:false}),fail:error=>{if(!/cancel/i.test(String(error&&error.errMsg||'')))this.fail(new Error('无法选择音频'));}});
      wx.chooseMedia({count:9,mediaType:[kind],sizeType:['original'],sourceType:['album','camera'],maxDuration:60,success:result=>this.uploadAgentFiles((result.tempFiles||[]).map((file,index)=>({path:file.tempFilePath,name:file.name||(kind==='video'?'视频 ':'图片 ')+(index+1),kind,size:Number(file.size||0)})),{attach:false}),fail:error=>{if(!/cancel/i.test(String(error&&error.errMsg||'')))this.fail(new Error('无法选择'+(kind==='video'?'视频':'图片')));}});
    },
    useAgentAsset(e){
      const item=(this.data.agentAssets||[]).find(asset=>asset.id===e.currentTarget.dataset.id);
      if(!item)return;
      return this.run(async()=>{
        const result=await api.request(IP12_API+'/assets/use','POST',{session_id:this.data.agentSessionId,asset_id:item.id});
        let preview='';if(result.kind==='image')preview=await api.mediaSource(api.mediaURL(ip12MediaPath(result.url))).catch(()=>'');
        this.addAgentAttachment({fileId:result.file_id,name:result.name||item.name,kind:result.kind||item.kind,preview,url:result.url||''});
        this.setData({agentAssetsOpen:false,agentSheet:''});
      });
    },
    previewAgentAsset(e){
      if(this.data.agentAssetManage)return this.toggleAgentAssetSelection(e);
      const item=(this.data.agentAssets||[]).find(asset=>asset.id===e.currentTarget.dataset.id);if(!item)return;
      const sid=this.data.agentSessionId,id=item.id,active=()=>this.alive&&this.visible!==false&&sid===this.data.agentSessionId&&this.data.agentSheet==='assets'&&(this.data.agentAssets||[]).some(asset=>asset.id===id);
      if(item.kind==='image'||item.kind==='avatar')return this.run(async()=>{const url=await api.mediaSource(api.mediaURL(ip12MediaPath(item.url)));if(active())wx.previewImage({current:url,urls:[url]});});
      if(item.kind==='video')return this.run(async()=>{const url=await api.mediaSource(api.mediaURL(ip12MediaPath(item.url)));if(active())wx.previewMedia({sources:[{url,type:'video'}],current:0});});
      return this.run(async()=>{const url=await api.mediaSource(api.mediaURL(ip12MediaPath(item.url)));if(!active())return;if(this.agentAssetAudio)this.agentAssetAudio.destroy();const audio=wx.createInnerAudioContext();this.agentAssetAudio=audio;audio.obeyMuteSwitch=false;audio.src=url;audio.play();this.toast('正在播放音频');});
    },
    toggleAgentAssetManage(){this.setData({agentAssetManage:!this.data.agentAssetManage,agentAssetSelectedCount:0,agentAssets:this.data.agentAssets.map(item=>Object.assign({},item,{selected:false}))});this.applyAgentAssetFilter();},
    toggleAgentAssetSelection(e){const id=e.currentTarget.dataset.id,assets=this.data.agentAssets.map(item=>item.id===id?Object.assign({},item,{selected:!item.selected}):item);this.setData({agentAssets:assets,agentAssetSelectedCount:assets.filter(item=>item.selected).length});this.applyAgentAssetFilter();},
    deleteAgentAssets(){
      const selected=this.data.agentAssets.filter(item=>item.selected);if(!selected.length)return this.toast('请先选择素材');
      wx.showModal({title:'删除 '+selected.length+' 个素材？',content:'会从素材库移除选中项，历史对话不会删除。删除后不可恢复。',confirmText:'确认删除',confirmColor:'#a34235',success:result=>{if(!result.confirm)return;this.run(async()=>{const data=await api.request(IP12_API+'/assets/delete','POST',{session_id:this.data.agentSessionId,items:selected.map(item=>({id:item.id,main_kind:item.main_kind,main_delete_id:item.main_delete_id}))});await this.loadAgentAssets(true);this.toast((data.failed||[]).length?'部分素材未删除':'已删除 '+(data.deleted||[]).length+' 个素材');});}});
    },
    openAgentHistory(){
      if(!(this.data.agentHistorySessions||[]).length)return this.toast('还没有以前的对话');
      this.setData({agentSheet:'history',agentHistoryManage:false,agentHistorySelectedCount:0,agentHistorySessions:this.data.agentHistorySessions.map(item=>Object.assign({},item,{selected:false}))});
    },
    switchAgentSession(){return this.openAgentHistory();},
    toggleAgentHistoryManage(){this.setData({agentHistoryManage:!this.data.agentHistoryManage,agentHistorySelectedCount:0,agentHistorySessions:this.data.agentHistorySessions.map(item=>Object.assign({},item,{selected:false}))});},
    toggleAgentHistorySelection(e){
      const sid=e.currentTarget.dataset.sid,items=this.data.agentHistorySessions.map(item=>item.sid===sid?Object.assign({},item,{selected:!item.selected}):item);
      this.setData({agentHistorySessions:items,agentHistorySelectedCount:items.filter(item=>item.selected).length});
    },
    selectAllAgentHistory(){
      const select=!(this.data.agentHistorySessions||[]).every(item=>item.selected),items=this.data.agentHistorySessions.map(item=>Object.assign({},item,{selected:select}));
      this.setData({agentHistorySessions:items,agentHistorySelectedCount:select?items.length:0});
    },
    openAgentHistoryItem(e){
      if(this.data.agentHistoryManage)return this.toggleAgentHistorySelection(e);
      const sid=e.currentTarget.dataset.sid;if(!sid)return;
      this.setData({agentSheet:''});return this.run(()=>this.restoreAgent(sid));
    },
    deleteAgentHistory(){
      const ids=(this.data.agentHistorySessions||[]).filter(item=>item.selected).map(item=>item.sid);
      if(!ids.length)return this.toast('请先选择要删除的对话');
      wx.showModal({title:'删除 '+ids.length+' 段对话？',content:'删除后不可恢复。只会删除对话及其中临时上传的附件，不会删除账号素材库和已经生成的作品。',confirmText:'确认删除',confirmColor:'#a34235',success:result=>{if(!result.confirm)return;this.run(async()=>{
        const data=await api.request(IP12_API+'/sessions/delete','POST',{session_ids:ids});
        const deleted=Array.isArray(data.deleted)?data.deleted:[],failed=Array.isArray(data.failed)?data.failed:[];
        const remaining=this.data.agentHistorySessions.filter(item=>!deleted.includes(item.sid)).map(item=>Object.assign({},item,{selected:false}));
        const deletedCurrent=deleted.includes(this.data.agentSessionId);
        this.setData({agentHistorySessions:remaining,agentSessions:remaining.slice(0,8),agentHistorySelectedCount:0,agentHistoryManage:false,agentSheet:failed.length?'history':''});
        if(deletedCurrent){api.save({ip12Outgoing:null,ip12HomeDraft:null});wx.setStorageSync(IP12_SESSION_KEY,IP12_NEW_SESSION);this.agentDraft='';this.setData({agentSessionId:'',agentMessages:[],agentDelegations:[],agentWidgets:[],agentReport:{},agentReportNotice:null,agentReportOpening:false,agentHiddenCount:0,agentImageHiddenCount:0,agentThinking:false,agentProgress:''});await this.startNewAgent();}
        this.toast(failed.length?'已删除 '+deleted.length+' 段，'+failed.length+' 段未删除':'已删除 '+deleted.length+' 段对话');
      });}});
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
    copyAgentConversationLink(){
      const sid=String(this.data.agentSessionId||'');
      if(!/^[0-9a-f]{32}$/.test(sid))return this.toast('请先开始一段对话');
      wx.setClipboardData({data:'https://huangquechuanmei.com/workbench/ip12/?sid='+sid,success:()=>this.toast('对话链接已复制'),fail:()=>this.toast('复制失败，请稍后重试')});
    },
    previewAgentPdf(e){
      const message=this.data.agentMessages[Number(e.currentTarget.dataset.message)],pdf=message&&message.pdfs&&message.pdfs[Number(e.currentTarget.dataset.pdf)];
      if(!pdf||!pdf.url)return this.toast('PDF 暂时无法预览');
      return this.run(async()=>{const file=await api.mediaSource(api.mediaURL(ip12MediaPath(pdf.url)));await new Promise((resolve,reject)=>wx.openDocument({filePath:file,fileType:'pdf',showMenu:true,success:resolve,fail:()=>reject(new Error('PDF 预览失败，请稍后重试'))}));});
    },
    shareAgentImage(e){
      if(!wx.showShareImageMenu)return this.toast('当前微信版本不支持转发图片，请升级后重试');
      const message=this.data.agentMessages[Number(e.currentTarget.dataset.message)],image=message&&message.images[Number(e.currentTarget.dataset.image)];
      if(!image)return this.toast('这张图片暂时无法转发');
      return this.run(async()=>{const path=await shareLocalPath(image);await new Promise((resolve,reject)=>wx.showShareImageMenu({path,needShowEntrance:true,entrancePath:'/paper/pages/chat/index',success:resolve,fail:error=>/cancel/i.test(String(error&&error.errMsg||''))?resolve():reject(new Error('图片转发失败，请稍后重试'))}));});
    },
    previewAgentCover(e){
      const item=this.data.agentMessages[Number(e.currentTarget.dataset.message)],cover=item&&item.covers[Number(e.currentTarget.dataset.cover)];
      if(cover)wx.previewImage({current:cover,urls:[cover]});
    },
    shareAgentCover(e){
      if(!wx.showShareImageMenu)return this.toast('当前微信版本不支持转发图片，请升级后重试');
      const message=this.data.agentMessages[Number(e.currentTarget.dataset.message)],cover=message&&message.covers[Number(e.currentTarget.dataset.cover)];
      if(!cover)return this.toast('这张图片暂时无法转发');
      return this.run(async()=>{const path=await shareLocalPath(cover);await new Promise((resolve,reject)=>wx.showShareImageMenu({path,needShowEntrance:true,entrancePath:'/paper/pages/chat/index',success:resolve,fail:error=>/cancel/i.test(String(error&&error.errMsg||''))?resolve():reject(new Error('图片转发失败，请稍后重试'))}));});
    },
    shareAgentVideo(e){
      if(!wx.shareFileMessage)return this.toast('当前微信版本不支持转发视频，请升级后重试');
      const message=this.data.agentMessages[Number(e.currentTarget.dataset.message)],video=message&&message.videos[Number(e.currentTarget.dataset.video)];
      if(!video)return this.toast('这个视频暂时无法转发');
      return this.run(async()=>{wx.showLoading({title:'正在准备视频'});try{const filePath=await shareLocalPath(video.src||api.mediaURL(ip12MediaPath(video.url)));await new Promise((resolve,reject)=>wx.shareFileMessage({filePath,fileName:'黄雀视频作品.mp4',success:resolve,fail:error=>/cancel/i.test(String(error&&error.errMsg||''))?resolve():reject(new Error('视频转发失败，请稍后重试'))}));}finally{wx.hideLoading();}});
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
    setAgentVoiceFlow(patch){
      if(!this.data.agentVoiceFlow)return;
      this.setData({agentVoiceFlow:Object.assign({},this.data.agentVoiceFlow,patch)});
    },
    initAgentVoiceMedia(withPlayer=false){
      if(!this.agentVoiceRecorder){
        if(!wx.getRecorderManager){this.setAgentVoiceFlow({error:'当前微信版本不支持录音，请升级后重试'});return false;}
        const recorder=wx.getRecorderManager();this.agentVoiceRecorder=recorder;
        recorder.onStart(()=>{if(!this.alive||!this.data.agentVoiceFlow)return;this.agentVoiceSeconds=0;this.setAgentVoiceFlow({stage:'recording',recSec:0,progress:0,error:''});this.startAgentVoiceTimer();});
        recorder.onStop(result=>{this.stopAgentVoiceTimer();if(!this.alive||!this.data.agentVoiceFlow)return;const filePath=result&&result.tempFilePath;if(!filePath)return this.setAgentVoiceFlow({stage:'record',error:'没有取得录音文件，请重试'});this.readAgentVoiceSample(filePath);});
        recorder.onError(()=>{this.stopAgentVoiceTimer();if(this.alive&&this.data.agentVoiceFlow)this.setAgentVoiceFlow({stage:'record',error:'录音失败，请检查麦克风权限'});});
      }
      if(withPlayer&&!this.agentVoicePlayer){
        const player=wx.createInnerAudioContext();this.agentVoicePlayer=player;
        // 试听/回听按钮必须出声：不跟随手机静音键（iOS 静音键会静默吞掉播放，按钮却显示在播）
        player.obeyMuteSwitch=false;
        player.onEnded(()=>{if(this.alive&&this.data.agentVoiceFlow)this.setAgentVoiceFlow({playing:false});});
        player.onError(()=>{if(this.alive&&this.data.agentVoiceFlow)this.setAgentVoiceFlow({playing:false,error:'样音暂时无法播放，请重试'});});
      }
      return true;
    },
    openAgentVoiceFlow(widget,action){
      // 结构化 voice_sample 卡：跟读稿直接取卡上的 script 字段，无「请朗读」正则、
      // 无默认兜底稿；动作完成后的提交走 widget_action（见 submitAgentVoiceSample）。
      const script=String(widget&&widget.script||'').trim();
      if(!script)return this.toast('这张录音卡缺少跟读稿，请让黄雀重新发一张');
      this.setData({agentVoiceFlow:{sid:this.data.agentSessionId,widgetId:String(widget&&widget.id||''),widgetTitle:String(widget&&widget.title||'声音样音'),actionMode:String(action&&action.mode||''),actionLabel:String(action&&action.label||''),stage:'record',script,recSec:0,progress:0,samplePath:'',playing:false,busy:false,error:''}});
      this.initAgentVoiceMedia();
      setTimeout(()=>{if(this.alive&&this.data.agentVoiceFlow)this.setData({agentScrollTarget:'agent-voice-clone-card'});},30);
    },
    startAgentVoiceRecording(){
      const flow=this.data.agentVoiceFlow;if(!flow||flow.stage!=='record'||!this.initAgentVoiceMedia())return;
      this.setAgentVoiceFlow({error:''});
      this.agentVoiceRecorder.start({duration:60000,format:'mp3',sampleRate:16000,numberOfChannels:1,encodeBitRate:48000});
    },
    stopAgentVoiceRecording(){if(this.agentVoiceRecorder&&this.data.agentVoiceFlow&&this.data.agentVoiceFlow.stage==='recording')this.agentVoiceRecorder.stop();},
    startAgentVoiceTimer(){
      this.stopAgentVoiceTimer();
      this.agentVoiceTimer=setInterval(()=>{if(!this.alive||!this.data.agentVoiceFlow)return this.stopAgentVoiceTimer();this.agentVoiceSeconds+=1;this.setAgentVoiceFlow({recSec:this.agentVoiceSeconds,progress:Math.min(100,Math.round(this.agentVoiceSeconds/60*100))});if(this.agentVoiceSeconds>=60)this.agentVoiceRecorder.stop();},1000);
    },
    stopAgentVoiceTimer(){if(this.agentVoiceTimer){clearInterval(this.agentVoiceTimer);this.agentVoiceTimer=null;}},
    readAgentVoiceSample(filePath){
      const seconds=this.agentVoiceSeconds||0;
      if(seconds<30)return this.setAgentVoiceFlow({stage:'record',recSec:seconds,progress:Math.round(seconds/60*100),samplePath:'',error:'录音太短，请连续朗读至少 30 秒'});
      if(this.alive&&this.data.agentVoiceFlow)this.setAgentVoiceFlow({stage:'review',samplePath:filePath,recSec:seconds,progress:Math.min(100,Math.round(seconds/60*100)),error:''});
    },
    playAgentVoiceSample(){
      const flow=this.data.agentVoiceFlow;if(!flow||!flow.samplePath||!this.initAgentVoiceMedia(true))return;
      if(flow.playing){this.agentVoicePlayer.pause();this.setAgentVoiceFlow({playing:false});return;}
      this.agentVoicePlayer.src=flow.samplePath;this.agentVoicePlayer.play();this.setAgentVoiceFlow({playing:true});
    },
    retryAgentVoiceRecording(){if(this.agentVoicePlayer)this.agentVoicePlayer.stop();this.agentVoiceSeconds=0;this.setAgentVoiceFlow({stage:'record',recSec:0,progress:0,samplePath:'',playing:false,error:''});},
    toggleVoicePreview(e){
      if(this.data.busy)return;
      const widgetIndex=Number(e.currentTarget.dataset.widget);
      const optionIndex=Number(e.currentTarget.dataset.option);
      const widget=this.data.agentWidgets[widgetIndex];
      const option=widget&&widget.items[optionIndex];
      if(!widget||!option)return;
      try{if(typeof wx!=='undefined'&&wx.vibrateShort)wx.vibrateShort({type:'light'});}catch(_){}
      const path='agentWidgets['+widgetIndex+'].items['+optionIndex+'].playing';
      if(option.playing){
        if(this.agentVoicePreviewCtx)this.agentVoicePreviewCtx.stop();
        this.setData({[path]:false});
        return;
      }
      if(this.agentVoicePreviewCtx){
        this.agentVoicePreviewCtx.stop();
        this.agentVoicePreviewCtx.destroy();
        this.agentVoicePreviewCtx=null;
      }
      (widget.items||[]).forEach((item,i)=>{
        if(item.playing&&i!==optionIndex){
          this.setData({['agentWidgets['+widgetIndex+'].items['+i+'].playing']:false});
        }
      });
      const url=option.previewUrl;
      if(!url){
        // 试听链接还没下发（如克隆刚完成、卡还没刷新）：如实提示，绝不假装在播
        this.toast('这段试听音频还没生成好，稍后再点');
        return;
      }
      const audio=wx.createInnerAudioContext();
      this.agentVoicePreviewCtx=audio;
      audio.obeyMuteSwitch=false;
      audio.src=url;
      audio.onPlay(()=>{if(this.alive)this.setData({[path]:true});});
      audio.onEnded(()=>{if(this.alive)this.setData({[path]:false});});
      audio.onStop(()=>{if(this.alive)this.setData({[path]:false});});
      audio.onError(()=>{if(this.alive){this.setData({[path]:false});this.toast('试听播放失败');}});
      audio.play();
    },
    triggerAgentWidgetAction(e){
      if(this.data.busy||this.data.agentThinking)return;
      const widgetIndex=Number(e.currentTarget.dataset.widget);
      const actionIndex=Number(e.currentTarget.dataset.action);
      const widget=this.data.agentWidgets&&this.data.agentWidgets[widgetIndex];
      const action=widget&&widget.actions&&widget.actions[actionIndex];
      if(!action)return;
      if(action.mode==='record'||action.mode==='upload'){
        return this.chooseAgentVoiceSampleAction(e);
      }
      const prompt=action.prompt||action.label||'';
      if(prompt){
        return this.sendAgentMessage(prompt);
      }
    },
    requestAgentVoiceClone(){
      // 音色卡下方「＋ 克隆音频」：把克隆需求直接交给后端（音频域），
      // 由后端按需下发 voice_sample 样音采集卡（跟读稿+录音/上传），前端不写死流程。
      if(this.data.busy||this.data.agentThinking)return;
      return this.sendAgentMessage('克隆我的声音');
    },
    requestAgentAvatarCreate(){
      // 数字人形象卡下方「＋ 定制数字人」：把定制需求交给 Agent，
      // 由后端按需下发数字人形象采集引导，或支持录制。
      if(this.data.busy||this.data.agentThinking)return;
      return this.sendAgentMessage('定制我的数字人形象');
    },
    chooseAgentVoiceSampleAction(e){
      if(this.data.busy||this.data.agentThinking)return;
      const widget=this.data.agentWidgets[Number(e.currentTarget.dataset.widget)];
      const mode=String(e.currentTarget.dataset.mode||'');
      if(!widget||widget.type!=='voice_sample'||!['record','upload'].includes(mode))return;
      const action=(widget.actions||[]).find(candidate=>candidate.mode===mode);
      if(!action)return;
      if(mode==='record')return this.openAgentVoiceFlow(widget,action);
      return this.pickAgentVoiceSampleFile(widget,action);
    },
    pickAgentVoiceSampleFile(widget,action){
      if(this.data.busy||this.data.agentThinking)return Promise.resolve();
      this.setData({agentSheet:''});
      return new Promise(resolve=>{
        wx.chooseMessageFile({count:1,type:'file',extension:['mp3','wav','m4a','aac','ogg'],success:result=>{
          const file=(result.tempFiles||[])[0];
          if(!file)return resolve();
          if(Number(file.size||0)>AGENT_SAMPLE_LIMIT_BYTES)return this.toast('样音不能超过 10 MB，请压缩或换一段更短的再传');
          return resolve(this.run(async()=>{
            const sid=await this.ensureAgentSession();
            const uploaded=await api.upload(IP12_API+'/upload',file.path,{session_id:sid});
            if(!uploaded||!uploaded.file_id)throw new Error('样音上传失败，请重试');
            this.addAgentAttachment({fileId:uploaded.file_id,name:file.name||'样音录音',kind:'audio',preview:file.path,url:uploaded.url||''});
            return true;
          }).then(ok=>{if(ok)this.sendAgentVoiceSampleAction(widget,action);}));
        },fail:error=>{
          if(!/cancel/i.test(String(error&&error.errMsg||'')))this.fail(new Error('无法选择音频，请从微信文件中选择'));
          resolve();
        }});
      });
    },
    sendAgentVoiceSampleAction(widget,action){
      // 文本与结构化字段全部来自 voice_sample 卡本身，前端不写死任何一句文案；
      // 后端再按 widget_id + mode 精确解析成「样音动作」。
      const mode=String(action&&action.mode||'');
      const widgetId=String(widget&&widget.id||'');
      if(!['record','upload'].includes(mode)||!widgetId)return;
      const label=String(action&&action.label||(mode==='record'?'开始录音':'上传录音文件'));
      const text='【点选】'+String(widget&&widget.title||'声音样音')+'：'+label;
      return this.sendAgentMessage(text,undefined,{widget_type:'voice_sample',widget_id:widgetId,mode});
    },
    submitAgentVoiceSample(){
      const flow=this.data.agentVoiceFlow;
      if(!flow||flow.busy||flow.stage!=='review'||!flow.samplePath)return;
      this.setAgentVoiceFlow({busy:true,error:''});
      return this.run(async()=>{
        const sid=await this.ensureAgentSession();
        const uploaded=await api.upload(IP12_API+'/upload',flow.samplePath,{session_id:sid});
        if(!uploaded||!uploaded.file_id)throw new Error('样音上传失败，请重试');
        this.addAgentAttachment({fileId:uploaded.file_id,name:'样音录音.mp3',kind:'audio',preview:flow.samplePath,url:uploaded.url||''});
        return true;
      }).then(ok=>{
        if(!ok)return;
        if(!this.alive||!this.data.agentVoiceFlow||this.data.agentVoiceFlow.sid!==flow.sid)return;
        this.closeAgentVoiceFlow();
        this.sendAgentVoiceSampleAction({id:flow.widgetId,title:flow.widgetTitle},{mode:flow.actionMode,label:flow.actionLabel});
      }).catch(error=>{
        if(this.alive&&this.data.agentVoiceFlow&&this.data.agentVoiceFlow.sid===flow.sid)this.setAgentVoiceFlow({busy:false,error:error.message||'样音上传失败，请重试'});
      });
    },
    closeAgentVoiceFlow(){
      const recording=this.data.agentVoiceFlow&&this.data.agentVoiceFlow.stage==='recording';this.setData({agentVoiceFlow:null});this.stopAgentVoiceTimer();if(recording&&this.agentVoiceRecorder)this.agentVoiceRecorder.stop();if(this.agentVoicePlayer)this.agentVoicePlayer.stop();
    },
    disposeAgentVoice(){this.stopAgentVoiceTimer();if(this.agentVoiceRecorder&&this.data.agentVoiceFlow&&this.data.agentVoiceFlow.stage==='recording')this.agentVoiceRecorder.stop();if(this.agentVoicePlayer){this.agentVoicePlayer.destroy();this.agentVoicePlayer=null;}if(this.agentVoicePreviewCtx){this.agentVoicePreviewCtx.stop();this.agentVoicePreviewCtx.destroy();this.agentVoicePreviewCtx=null;}},
    toggleAgentTemplateCatalog(e){
      const index=Number(e.currentTarget.dataset.widget),widget=this.data.agentWidgets[index];
      if(!widget||widget.layout!=='template_catalog')return;
      this.setData({['agentWidgets['+index+'].catalogExpanded']:!widget.catalogExpanded});
    },
    toggleAgentTaskCollapse(){
      try{if(typeof wx!=='undefined'&&wx.vibrateShort)wx.vibrateShort({type:'light'});}catch(_){}
      const next=!this.data.agentTaskCollapsed;
      this.setData({agentTaskCollapsed:next,agentTaskManualExpanded:!next,agentTaskManualCollapsed:next});
    },
    dismissAgentTaskBar(){
      try{if(typeof wx!=='undefined'&&wx.vibrateShort)wx.vibrateShort({type:'light'});}catch(_){}
      this._taskDismissedForId=this.data.agentTaskId;
      this.setData({agentTaskDismissed:true});
    },
    toggleAgentWidgetExpand(e){
      // 已选收起的卡点徽标展开改选；再点收起。
      const index=Number(e.currentTarget.dataset.widget),widget=this.data.agentWidgets[index];
      if(!widget||!widget.answered||widget.consumed)return;
      this.setData({['agentWidgets['+index+'].expanded']:!widget.expanded});
    },
    toggleScriptBodyExpand(e){
      const widgetIndex=Number(e.currentTarget.dataset.widget),optionIndex=Number(e.currentTarget.dataset.option);
      const widget=this.data.agentWidgets[widgetIndex],option=widget&&widget.items[optionIndex];
      if(!widget||!option)return;
      try{if(typeof wx!=='undefined'&&wx.vibrateShort)wx.vibrateShort({type:'light'});}catch(_){}
      const path='agentWidgets['+widgetIndex+'].items['+optionIndex+'].expanded';
      this.setData({[path]:!Boolean(option.expanded)});
    },
    chooseAgentWidget(e){
      if(this.data.busy||this.data.agentThinking)return;
      const widgetIndex=Number(e.currentTarget.dataset.widget),optionIndex=Number(e.currentTarget.dataset.option);
      const widget=this.data.agentWidgets[widgetIndex],item=widget&&widget.items[optionIndex];
      if(!widget||!item||widget.consumed||widget.submitting)return;
      if(widget.type==='option_pick'||(widget.domain==='compose'&&widget.type==='voice_pick'))return this.submitAgentWidgetAction(widgetIndex,[item]);
      try{if(typeof wx!=='undefined'&&wx.vibrateShort)wx.vibrateShort({type:'light'});}catch(_){}
      const prevSelectedId=widget.selectedId||'';
      const choice={id:item.id,label:item.title,image_url:item.imageUrl,preview_url:item.previewUrl,widgetTitle:widget.title,film:widget.film,manual:true,slot_id:item.slotId,created_at:item.createdAt};
      // 勾选暂存（2026-09-16 老板定调「一次选完」）：点卡只做本地勾选 + 后台持久化，
      // 不清空其它卡、不立即发送——多张卡都勾完（或点「确认选择」）才一次性提交。
      this._agentManualPicks=this._agentManualPicks||{};
      this._agentManualPicks[widget.key]=String(item.id);
      widget.selectedId=String(item.id);
      if(widget.layout!=='template_catalog'){
        widget.answered=true;
        widget.selectedTitle=item.title;
        widget.expanded=false;
      }
      const curWidgets=(this.data.agentWidgets||[]);
      const pendingCount=curWidgets.filter(w=>w.layout!=='template_catalog'&&!w.answered&&!w.selectedId).length;
      const allAnswered=curWidgets.length>0&&pendingCount===0;
      const badgeText=pendingCount>0?(pendingCount+' 项待选'):'已选齐';
      const patch={
        ['agentWidgets['+widgetIndex+'].selectedId']:String(item.id),
        agentTaskPendingCount:pendingCount,
        agentTaskBadgeText:badgeText
      };
      if(widget.layout!=='template_catalog'){
        patch['agentWidgets['+widgetIndex+'].answered']=true;
        patch['agentWidgets['+widgetIndex+'].selectedTitle']=item.title;
        patch['agentWidgets['+widgetIndex+'].expanded']=false;
      }
      if(allAnswered){
        patch.agentTaskCollapsed=true;
        patch.agentTaskManualExpanded=false;
      }
      this.setData(patch);
      api.request(IP12_API+'/selection','POST',{session_id:this.data.agentSessionId,kind:widget.kind,choice,widget_id:widget.id||widget.key.split('@')[0],widget_gen:widget.gen||1})
        .then(data=>{
          if(data&&data.invalidated&&widget.type!=='option_pick'){
            this.toast('这个选项已经更新，请重新选择');
            delete this._agentManualPicks[widget.key];
            if(this.alive&&this.data.agentWidgets[widgetIndex])this.setData({['agentWidgets['+widgetIndex+'].selectedId']:prevSelectedId});
          }
        })
        .catch(()=>{});
      return this.maybeSubmitAgentPicks();
    },
    // 勾选后的提交时机：单卡=点选即发（与旧行为一致）；多卡=全部勾齐自动一次发完，
    // 未勾齐则亮出「确认选择」按钮兜底。黄雀思考中只暂存，回复结束自动补交。
    settleAgentPicks(){
      if(!this._agentPicksPendingSubmit)return;
      if(this.data.agentThinking)return;
      this._agentPicksPendingSubmit=false;
      return this.maybeSubmitAgentPicks();
    },
    maybeSubmitAgentPicks(){
      if(this.data.agentThinking){this._agentPicksPendingSubmit=true;return;}
      const widgets=(this.data.agentWidgets||[]).filter(w=>['avatar_pick','voice_pick','script_pick','option_pick'].includes(w.type));
      if(!widgets.length)return;
      const hasChoice=w=>!!w.selectedId||!!(this._agentManualPicks&&this._agentManualPicks[w.key]);
      const required=widgets.filter(w=>w.id!=='template_catalog');
      if(!required.length||required.every(hasChoice)){
        this.setData({agentPicksCanConfirm:false});
        return this.submitAgentPicks();
      }
      const anyManual=widgets.some(w=>!!(this._agentManualPicks&&this._agentManualPicks[w.key]));
      this.setData({agentPicksCanConfirm:anyManual});
    },
    confirmAgentPicksSubmit(){
      if(this.data.busy||this.data.agentThinking)return;
      return this.submitAgentPicks();
    },
    submitAgentPicks(){
      const widgets=(this.data.agentWidgets||[]).slice();
      const lines=[],displayLines=[];
      widgets.forEach(w=>{
        if(!['avatar_pick','voice_pick','script_pick','option_pick'].includes(w.type))return;
        const selId=w.selectedId||'';
        if(!selId)return;
        const item=(w.items||[]).find(i=>String(i.id)===String(selId));
        if(!item)return;
        // 机器文本带 id（后端按「标题+选项+id」解析）；用户气泡只显示选项名，不带
        // 「【点选】」前缀、卡片标题和 id 参数（2026-09-16 老板定调：点选消息里不要露技术参数）。
        lines.push('【点选】'+w.title+'：'+item.title+'（id='+item.id+'）');
        displayLines.push(item.title);
      });
      if(!lines.length)return;
      this._agentManualPicks={};
      this.setData({agentPicksCanConfirm:false});
      return this.sendAgentMessage(lines.join('\n'),undefined,undefined,displayLines.join('\n'));
    },
    async submitAgentWidgetAction(index,picked){
      const widget=this.data.agentWidgets[index];
      if(!widget||widget.consumed||widget.submitting||!picked.length)return;
      const key=widget.key;
      widget.submitting=true;
      this.setData({['agentWidgets['+index+'].submitting']:true,['agentWidgets['+index+'].answered']:true,['agentWidgets['+index+'].expanded']:false,['agentWidgets['+index+'].selectedTitle']:picked.map(item=>item.title).join('、')});
      const action={widget_type:'option_pick',widget_id:widget.id||key.split('@')[0],gen:widget.gen||1,item_ids:picked.map(item=>String(item.id))};
      try{
        await this.sendAgentMessage('【点选】'+widget.title+'：'+picked.map(item=>item.title).join('、'),undefined,action,picked.map(item=>item.title).join('、'));
        widget.consumed=true;
      }catch(error){
        widget.submitting=false;
        const current=this.data.agentWidgets[index];
        if(current&&current.key===key)this.setData({['agentWidgets['+index+'].submitting']:false,['agentWidgets['+index+'].answered']:false});
        if(error.status===409){widget.consumed=true;this.toast('这张卡已更新，请使用当前步骤');}
        else this.fail(error);
      }
    },
    toggleAgentMultiOption(e){
      if(this.data.busy||this.data.agentThinking)return;
      const widgetIndex=Number(e.currentTarget.dataset.widget),optionIndex=Number(e.currentTarget.dataset.option);
      const widget=this.data.agentWidgets[widgetIndex],item=widget&&widget.items[optionIndex];
      if(!widget||!item||widget.consumed||widget.submitting||widget.selectionMode!=='multiple')return;
      try{if(typeof wx!=='undefined'&&wx.vibrateShort)wx.vibrateShort({type:'light'});}catch(_){}
      const path='agentWidgets['+widgetIndex+']';
      let count=widget.selectedCount||0;
      let selected;
      if(item.selected){selected=false;count-=1;}
      else if(widget.maxSelected>0&&count>=widget.maxSelected)return this.toast('最多选 '+widget.maxSelected+' 项，先取消一项再换');
      else{selected=true;count+=1;}
      this.setData({[path+'.items['+optionIndex+'].selected']:selected,[path+'.selectedCount']:count});
    },
    confirmAgentMultiSelection(e){
      if(this.data.busy||this.data.agentThinking)return;
      const widgetIndex=Number(e.currentTarget.dataset.widget);
      const widget=this.data.agentWidgets[widgetIndex];
      if(!widget||widget.consumed||widget.submitting||widget.selectionMode!=='multiple')return;
      const picked=(widget.items||[]).filter(item=>item.selected);
      if(picked.length<widget.minSelected)return this.toast('请至少选择 '+widget.minSelected+' 项');
      // 与网页端多选卡同口径：一次提交所有勾选项，消息形如「【点选】标题：甲、乙」
      if(widget.maxSelected&&picked.length>widget.maxSelected)return this.toast('最多选择 '+widget.maxSelected+' 项');
      return this.submitAgentWidgetAction(widgetIndex,picked);
    },
    previewAgentImage(e){
      const item=this.data.agentMessages[Number(e.currentTarget.dataset.message)],current=item&&item.images[Number(e.currentTarget.dataset.image)];
      if(current)wx.previewImage({current,urls:item.images});
    },
    async loadAgentVideo(e){
      const messageIndex=Number(e.currentTarget.dataset.message),videoIndex=Number(e.currentTarget.dataset.video);
      const message=this.data.agentMessages[messageIndex],video=message&&message.videos[videoIndex];
      if(!video||video.loading||video.src)return;
      const sid=this.data.agentSessionId,url=video.url,path='agentMessages['+messageIndex+'].videos['+videoIndex+']';
      this.setData({[path+'.loading']:true});
      try{
        const src=await api.mediaSource(api.mediaURL(ip12MediaPath(url))),current=this.data.agentMessages[messageIndex]&&this.data.agentMessages[messageIndex].videos[videoIndex];
        if(!this.alive||sid!==this.data.agentSessionId||!current||current.url!==url)return;
        if(this.visible===false){this.setData({[path+'.loading']:false});return;}
        if(!src)throw new Error('视频地址无效');
        this.setData({[path+'.src']:src,[path+'.loading']:false},()=>{const player=wx.createVideoContext&&wx.createVideoContext(video.domId,this);if(player)player.play();});
      }catch(_){const current=this.data.agentMessages[messageIndex]&&this.data.agentMessages[messageIndex].videos[videoIndex];if(this.alive&&sid===this.data.agentSessionId&&current&&current.url===url){this.setData({[path+'.loading']:false});this.fail(new Error('视频加载失败，请检查网络后重试'));}}
    },
    async toggleAgentAudio(e){
      const messageIndex=Number(e.currentTarget.dataset.message),audioIndex=Number(e.currentTarget.dataset.audio);
      const message=this.data.agentMessages[messageIndex],audio=message&&message.audios[audioIndex];
      if(!audio||audio.loading)return;
      const sid=this.data.agentSessionId,url=audio.url,path='agentMessages['+messageIndex+'].audios['+audioIndex+']';
      if(this.agentAudio&&this.agentAudioMeta&&this.agentAudioMeta.sid===sid&&this.agentAudioMeta.message===messageIndex&&this.agentAudioMeta.audio===audioIndex&&audio.playing){this.agentAudio.pause();this.setData({[path+'.playing']:false});return;}
      if(this.agentAudio){this.agentAudio.destroy();this.agentAudio=null;}
      if(this.agentAudioMeta){const old='agentMessages['+this.agentAudioMeta.message+'].audios['+this.agentAudioMeta.audio+'].playing';this.setData({[old]:false});}
      this.setData({[path+'.loading']:true});
      try{
        const src=audio.src||await api.mediaSource(api.mediaURL(ip12MediaPath(url))),current=this.data.agentMessages[messageIndex]&&this.data.agentMessages[messageIndex].audios[audioIndex];
        if(!this.alive||sid!==this.data.agentSessionId||!current||current.url!==url||!src)return;
        if(this.visible===false){this.setData({[path+'.loading']:false});return;}
        const player=wx.createInnerAudioContext();this.agentAudio=player;this.agentAudioMeta={sid,message:messageIndex,audio:audioIndex};
        player.obeyMuteSwitch=false;
        player.src=src;player.onEnded(()=>{if(this.alive&&this.data.agentSessionId===sid&&this.agentAudio===player)this.setData({[path+'.playing']:false});});player.onError(()=>{if(this.alive&&this.data.agentSessionId===sid&&this.agentAudio===player){this.setData({[path+'.loading']:false,[path+'.playing']:false});this.fail(new Error('音频播放失败，请稍后重试'));}});
        this.setData({[path+'.src']:src,[path+'.loading']:false,[path+'.playing']:true});player.play();
      }catch(_){const current=this.data.agentMessages[messageIndex]&&this.data.agentMessages[messageIndex].audios[audioIndex];if(this.alive&&sid===this.data.agentSessionId&&current&&current.url===url){this.setData({[path+'.loading']:false,[path+'.playing']:false});this.fail(new Error('音频加载失败，请检查网络'));}}
    },
    openAgentIpDrawer(){this.setData({agentIpDrawerOpen:true,agentAssetsOpen:false,agentSheet:''});},
    closeAgentIpDrawer(){this.setData({agentIpDrawerOpen:false});},
    keepAgentIpDrawer(){},
    chooseAgentIpItem(e){
      const kind=e.currentTarget.dataset.ipKind;
      if(kind==='report'){this.closeAgentIpDrawer();return this.viewAgentReport();}
      const text=kind==='topics'?'请把我已经确认的选题列出来。':'请把我已经确认的口播稿列出来。';
      this.agentDraft=text;this.setData({promptInput:text,agentHasText:true,agentIpDrawerOpen:false});this.toast('已放到输入框，确认后发送');
    },
    // —— 报告完成提示：抽屉关着也要看得见 ——
    // 报告在服务端后台生成、不往会话追加消息，只靠轮询拉。拉到可看的报告后，
    // 在聊天窗口（输入框上方）给一条常驻提示卡；按「会话 + 报告版本」去重，
    // 避免重复轮询或页面恢复时反复插入。
    reportNoticeState(){const all=api.read().ip12ReportNotices;return all&&typeof all==='object'?all:{};},
    reportNoticeKey(report){const files=(report&&report.files)||{};return [String(report&&report.status||''),String(files.pdf||files.md||files.json||'')].join('|');},
    reportNoticePayload(report){
      const status=String(report&&report.status||'');
      const files=(report&&report.files)||{};
      const pdf=files.pdf;
      // 模块（选题/口播）生成中优先于主报告卡：定稿完成后跑选题/口播时，
      // 用户要看到的是当前这段生成的进度，而不是重复弹出的定稿卡。
      const MOD_GENERATING={
        m5:['选题 · 生成中','正在按你确认的定位方向出选题，稍等一会儿'],
        m6:['口播 · 生成中','正在按确认的选题写口播稿，稍等一会儿'],
      };
      const MOD_VALIDATED={m5:'选题 · 校验中',m6:'口播 · 校验中'};
      for(const name of ['m5','m6']){
        const mod=(report&&report[name])||{};
        const ms=String(mod.status||'');
        if(ms===name+'_generating')return {status:ms,pending:true,label:'生成中…',title:MOD_GENERATING[name][0],desc:MOD_GENERATING[name][1],keySuffix:name+':'+ms};
        if(ms===name+'_validated')return {status:ms,pending:true,label:'生成中…',title:MOD_VALIDATED[name],desc:'内容已生成，正在整理，马上好',keySuffix:name+':'+ms};
      }
      if(pdf&&['draft_ready','final','confirmed'].includes(status)){
        const done=status==='final'||status==='confirmed';
        return {status,title:done?'IP 定位报告 · 定稿已生成':'IP 定位报告 · 初稿已生成',desc:done?'点开查看 PDF，可直接存档或转发。':'点开查看 PDF；挑一套人设方案回我，我就出定稿。',keySuffix:'main|'+status+'|'+String(pdf)};
      }
      // 老板 09-17 定调：后台生成必须让用户看得见进度，绝不无反馈地等。
      // 生成中/校验中/失败都要挂卡；完成后再由上面的 ready/final 卡顶替。
      const PENDING={
        draft_generating:['IP 定位报告 · 初稿生成中','正在整理你的信息，稍等一会儿，好了卡片会自动变成可查看'],
        draft_validated:['IP 定位报告 · 初稿校验中','内容已生成，正在校验排版，马上好'],
        final_generating:['IP 定位报告 · 定稿生成中','已按你选的人设方案出定稿，正在整理，马上好'],
        final_validated:['IP 定位报告 · 定稿校验中','定稿已生成，正在渲染 PDF，马上好'],
      };
      if(PENDING[status]){
        const copy=PENDING[status];
        return {status,pending:true,label:'生成中…',title:copy[0],desc:copy[1],keySuffix:'main:'+status};
      }
      if(status==='failed')return {status,pending:true,label:'',title:'IP 定位报告 · 生成失败',desc:'这次没生成成功，跟我说一声，我帮你重试',keySuffix:'main:'+status};
      return null;
    },
    syncReportNotice(sid,report){
      if(!sid||sid!==this.data.agentSessionId)return;
      const payload=this.reportNoticePayload(report);
      if(!payload){if(this.data.agentReportNotice)this.setData({agentReportNotice:null});return;}
      const key=sid+'@'+String(payload.keySuffix||this.reportNoticeKey(report));
      if(this.reportNoticeState()[sid]===key){if(this.data.agentReportNotice)this.setData({agentReportNotice:null});return;}
      if(this.data.agentReportNotice&&this.data.agentReportNotice.key===key)return;
      this.setData({agentReportNotice:Object.assign({key},payload)});
    },
    // 显式传参：只记录「这一次打开的是哪个会话、哪个版本」，绝不读页面当前状态，
    // 避免把「打开初稿」的结果记到后来才出现的定稿头上。
    markReportNoticeAnnounced(sid,key){
      if(!sid||!key)return;
      const all=Object.assign({},this.reportNoticeState());all[String(sid)]=String(key);api.save({ip12ReportNotices:all});
    },
    // 两个入口统一走这里：提示卡与「IP资料 → IP报告」都必须防重复点击、
    // 给出失败反馈，并在有提示版本时按点击快照结算已读。
    openAgentReportFromUi(requireNotice){
      if(this.data.agentReportOpening)return Promise.resolve(false);
      const notice=this.data.agentReportNotice||null,report=this.data.agentReport||{};
      const snapshot={
        sid:String(this.data.agentSessionId||''),
        key:String(notice&&notice.key||''),
        pdf:String((report.files||{}).pdf||''),
        token:api.session()&&api.session().token,
      };
      if(!snapshot.sid||(requireNotice&&!snapshot.key))return Promise.resolve(false);
      if(!snapshot.pdf){if(this.alive&&this.visible!==false)this.toast('报告还在整理中');return Promise.resolve(false);}
      this.setData({agentReportOpening:true});
      // 两类回写要分开：
      //  - uiSet：本地 UI 状态（按钮的「正在打开」）。隐藏时也必须复位，
      //    否则按钮会永久卡在“正在打开…”且被禁用，用户无法重试。
      //  - settle：结算（清提示 / 写已读）。openDocument 会让页面进入隐藏态，
      //    所以不能用 visible 判断是否成功；只绑定点击时的账号、会话和提示版本。
      const uiSet=patch=>{if(this.alive)this.setData(patch);};
      const canNotify=()=>this.alive&&this.visible!==false;
      return Promise.resolve(this.openAgentReport(snapshot.pdf)).then(result=>{
        if(!result||!result.opened){
          // 失败：不动已读、不清提示，告诉用户可以再点一次
          uiSet({agentReportOpening:false});
          if(canNotify())this.toast(result&&result.reason==='download_failed'?'报告下载失败，请重试':'报告打开失败，请重试');
          return false;
        }
        // 四重核对：组件仍存活、账号没换、会话没换、版本还是点下去那一个。
        // 页面因文档查看器隐藏仍应结算；否则用户每次返回都会重复看到已打开的报告。
        const sessionOk=Boolean(this.alive&&api.session()&&api.session().token===snapshot.token&&snapshot.sid===this.data.agentSessionId);
        const current=this.data.agentReportNotice||null;
        const noticeOk=Boolean(snapshot.key&&current&&current.key&&current.key===snapshot.key);
        if(sessionOk&&noticeOk){
          this.markReportNoticeAnnounced(snapshot.sid,snapshot.key);
          uiSet({agentReportNotice:null});
        }
        // 期间换了账号/会话、组件销毁、提示被关、或已被定稿顶替 —— 一律不结算
        uiSet({agentReportOpening:false});
        return true;
      }).catch(()=>{uiSet({agentReportOpening:false});if(canNotify())this.toast('报告打开失败，请重试');return false;});
    },
    viewAgentReportNotice(){return this.openAgentReportFromUi(true);},
    viewAgentReport(){return this.openAgentReportFromUi(false);},
    dismissAgentReportNotice(){
      const notice=this.data.agentReportNotice||null,sid=this.data.agentSessionId;
      if(!notice||!notice.key||!sid)return;
      this.markReportNoticeAnnounced(String(sid),String(notice.key));
      this.setData({agentReportNotice:null});
    },
    // 明确返回结果：{opened:true} / {opened:false,reason:'download_failed'|'open_failed'|'no_pdf'}
    openAgentReport(pdf){
      const fallback=this.data.agentReport&&this.data.agentReport.files&&this.data.agentReport.files.pdf;
      const raw=String(pdf||fallback||'');
      if(!raw)return Promise.resolve({opened:false,reason:'no_pdf'});
      const url=raw.startsWith('api/')?'/workbench/ip12/'+raw:(/^https?:\/\//i.test(raw)?raw:'/workbench/ip12/'+raw.replace(/^\//,''));
      let gotFile=false;
      return api.mediaSource(api.mediaURL(url)).then(source=>{
        gotFile=true;
        return new Promise((resolve,reject)=>wx.openDocument({filePath:source,fileType:'pdf',showMenu:true,success:resolve,fail:reject}));
      }).then(()=>({opened:true})).catch(()=>({opened:false,reason:gotFile?'open_failed':'download_failed'}));
    },
    confirmAgentReport(){
      if(!this.data.agentSessionId)return;
      wx.showModal({title:'确认前四步资料？',content:'确认后，主 Agent 会继续进行选题和文案。',confirmText:'确认并继续',success:result=>{if(result.confirm)this.run(async()=>{const data=await api.request(IP12_API+'/confirm','POST',{session_id:this.data.agentSessionId});if(data.seq!==undefined){api.save({ip12Waiting:{sid:this.data.agentSessionId,seq:data.seq}});this.setData({agentThinking:true});await this.pollAgent(this.data.agentSessionId,data.seq);}});}});
    },
    stopThought(){this.setData({stopped:!this.data.stopped});},
    confirmPlan(){if(!this.requireLogin())return;this.run(async()=>{creation.payload(this.draft());api.save({draft:this.draft()});this.navigate('confirm');});},
    async loadQuote(){const draft=api.read().draft;if(!draft)throw new Error('请先填写创作需求');const q=await creation.quote(draft);if(this.alive)this.setData({quote:q,promptInput:draft.prompt,kind:draft.kind,kindName:creation.format(draft.kind).name,formatDetail:q.detail});},
    startGeneration(){this.run(async()=>{if(!this.data.quote)throw new Error('请先取得当前报价');const draft=api.read().draft;if(draft&&draft.kind==='video')await this.requestWorkSubscription(false);try {await creation.submit(draft,this.data.quote.cost);}catch(e){this.setData({attempt:api.read().attempt||null});if(e.code==='price_changed')await this.loadQuote();throw e;}this.navigate('processing');});},
    recover(){this.run(async()=>{await creation.submit(null,null,true);this.navigate('processing');});},
    async refreshJob(){clearTimeout(this.timer);const s=api.read().selected;if(!s||(!s.id&&!s.asset))throw new Error('请从作品列表选择一个任务');const owner=api.session()&&api.session().user.username;let job;if(s.asset)job=Object.assign({},s.asset);else{const data=await api.request('/api/gen/job/'+encodeURIComponent(s.id));job=creation.jobView(data,s.kind);if(s.kind==='video'){job.kind='video';job.ratio=(data.result&&data.result.ratio)||job.ratio||'';job.videoHeight=videoHeight(job.ratio);}}if(!this.alive||!api.session()||owner!==api.session().user.username)return;job.displayUrls=await Promise.all((job.urls||[job.url]).filter(Boolean).map(api.mediaSource));job.displayUrl=job.displayUrls[0]||'';if(!this.alive||!api.session()||owner!==api.session().user.username)return;this.setData({job});if(this.visible&&this.properties.pageId==='processing'&&!job.done&&!job.failed)this.timer=setTimeout(()=>this.refreshJob().catch(e=>this.fail(e)),4000);},
    refreshTask(){this.run(()=>this.refreshJob());},
    openWork(e){const key=e.currentTarget.dataset.key,job=this.data.works.find(j=>j.key===key);if(!job)return;this.run(async()=>{api.save({selected:job.kind==='video'&&job.done?{asset:job}:{id:job.jobId||job.id,kind:job.kind}});this.navigate(job.done?job.kind+'-detail':job.failed?'failed':'processing');});},
    viewResult(){const j=this.data.job;if(j&&j.done)this.navigate(j.kind+'-detail');},
    retry(){this.run(async()=>{const local=api.read();if(!local.draft||!local.attempt||Number(local.attempt.jobId)!==Number(this.data.job&&this.data.job.id))throw new Error('这件作品的原始需求未保存在此设备，请回首页填写后重新确认');this.navigate('confirm');});},
    applyFilter(){const q=this.data.search.trim().toLowerCase(),page=this.data.pageId||this.properties.pageId,filter=this.data.filter;this.setData({visibleWorks:this.data.works.filter(w=>{const allowed=page!=='card-works'||(w.done&&['image','video'].includes(w.kind));const matched=page==='works'?(filter==='all'||filter==='done'&&w.done||filter==='failed'&&w.failed||filter==='processing'&&!w.done&&!w.failed):(filter==='all'||w.kind===filter);return allowed&&matched&&(!q||w.title.toLowerCase().includes(q));})});},
    selectFilter(e){this.setData({filter:e.currentTarget.dataset.filter});this.applyFilter();},
    clearSearch(){this.setData({search:'',filter:'all'});this.applyFilter();},
    chooseReference(){if(!['image','text'].includes(this.data.kind))return this.toast('请在图片或文案创作中添加参考图');wx.chooseMedia({count:1,mediaType:['image'],success:r=>{const f=r.tempFiles[0];if(f.size>5*1024*1024)return this.toast('参考图请小于 5 MB');wx.getFileSystemManager().readFile({filePath:f.tempFilePath,encoding:'base64',success:x=>{const mime=x.data.startsWith('iVBOR')?'image/png':x.data.startsWith('UklGR')?'image/webp':x.data.startsWith('/9j/')?'image/jpeg':'';if(!mime)return this.toast('请选择 PNG、JPG 或 WebP 图片');this.reference='data:'+mime+';base64,'+x.data;this.setData({referencePath:f.tempFilePath});},fail:()=>this.toast('无法读取这张图片')});},fail:e=>{if(!/cancel/.test(e.errMsg||''))this.toast('无法打开相册，请检查授权');}});},
    removeReference(){this.reference='';this.setData({referencePath:''});},
    async loadVoices(){const r=await api.request('/api/gen/audio/voices');const voices=(r.items||[]).filter(v=>v.ready).map(v=>({key:v.voice_key,name:v.display_name}));if(this.alive)this.setData({voices});},
    chooseVoice(e){const v=this.data.voices[Number(e.detail.value)];if(v)this.setData({voice:v.key||v.id||v.voice,voiceName:v.name||v.title});},
    preview(){if(this.data.job&&this.data.job.urls.length)wx.previewImage({current:this.data.job.displayUrl,urls:this.data.job.displayUrls});},
    saveImage(){const url=this.data.job&&this.data.job.url;if(!url)return;this.run(()=>new Promise((resolve,reject)=>wx.downloadFile({url,header:api.mediaHeaders(url),success:r=>{if(r.statusCode!==200)return reject(new Error('图片下载失败，请刷新作品后重试'));wx.saveImageToPhotosAlbum({filePath:r.tempFilePath,success:()=>{this.toast('已保存到相册');resolve();},fail:()=>reject(new Error('保存失败，请检查相册权限'))});},fail:()=>reject(new Error('下载失败，请检查网络或下载域名配置'))})));},
    playAudio(){const url=this.data.job&&this.data.job.displayUrl;if(!url)return this.toast('作品还没有可播放的音频');if(!this.audio){this.audio=wx.createInnerAudioContext();this.audio.obeyMuteSwitch=false;this.audio.onPlay(()=>this.setData({playing:true}));this.audio.onPause(()=>this.setData({playing:false}));this.audio.onEnded(()=>this.setData({playing:false}));this.audio.onTimeUpdate(()=>this.setData({audioTime:Math.floor(this.audio.currentTime),audioDuration:Math.floor(this.audio.duration)}));this.audio.onError(()=>{this.setData({playing:false});this.fail(new Error('音频暂时无法播放，请刷新作品后重试'));});}if(this.data.playing)this.audio.pause();else{this.audio.src=url;this.audio.play();}},
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
    info(e){const kind=e.currentTarget.dataset.info;const copy={login:'使用已有黄雀账号登录。密码仅用于本次验证，不保存在设备。登录凭证会保存到本机，退出时清除。',privacy:'名片资料保存于黄雀服务端；只有已发布名片及你允许公开的联系方式对外展示。',notice:'作品完成提醒使用微信原生订阅消息。每次授权可接收一条服务通知，点击通知会进入作品列表。',payment:'会员购买尚未接入此版本。已有会员权益与余额来自你的真实账号。',share:'可将作品整理进名片，再发布名片分享给朋友。',data:'账号登录凭证、创作草稿和任务恢复记录保存在此设备。云端作品不会因退出登录而删除。'};wx.showModal({title:'黄雀',content:copy[kind]||'此项功能正在接入。',showCancel:false});}
  }
});
