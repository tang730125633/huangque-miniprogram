const pages = require('./pages');
const api = require('../../services/api');
const creation = require('../../services/creation');
const titles = {}; pages.forEach(p => { titles[p.id] = p.title; });
const emptyCard = { name: '', headline: '', company: '', bio: '', email: '', address: '', email_public: false, address_public: false, works: [] };
Component({
  properties: { pageId: { type: String, value: 'home' } },
  data: {
    title: '', statusTop: 24, navHeight: 48, safeRight: 104, user: null, busy: false, loading: false, error: '',
    promptInput: '', kind: 'image', formats: creation.formats, kindName: '图片', formatDetail: creation.formats[0].detail,
    username: '', password: '', consent: false, quote: null, attempt: null, job: null,
    works: [], visibleWorks: [], search: '', filter: 'all', hasMore: false,
    filters: [{id:'all',name:'全部'}, ...creation.formats],
    card: emptyCard, publicCard: null, points: [], pointFilter: 'all', invite: null, voices: [], voice: '', voiceName: '',
    referencePath: '', chatView: 'proposal', scriptOpen: false, stopped: false,
    notifications: { finished: true, failed: true, activity: false },
    notificationItems: [{key:'finished',title:'作品完成提醒'},{key:'failed',title:'任务异常提醒'},{key:'activity',title:'产品与活动消息'}],
    feedbackInput: '', feedbackType: '体验建议', feedbackSent: false, openFaq: -1,
    helpItems: [
      {q:'怎样开始一次创作？',a:'选择作品形式并描述需求，确认当前价格后提交。图片、文案、配音和视频分别创建任务。'},
      {q:'生成失败后，积分会怎样？',a:'任务状态和退回状态分别显示。仅当服务端确认退回时显示已退回；重试前需再次确认。'},
      {q:'网络中断后要重新生成吗？',a:'先恢复上次提交。恢复沿用相同请求编号，避免重复创建付费任务。'},
      {q:'谁能看到我的作品和联系方式？',a:'创作记录按账号隔离。名片只有发布后才公开，邮箱与地址由你分别控制。'}
    ]
  },
  lifetimes: {
    attached() {
      this.alive = true; this.visible = true;
      let statusTop=24, navHeight=48, safeRight=104;
      try { const w=wx.getWindowInfo(); const c=wx.getMenuButtonBoundingClientRect(); statusTop=w.statusBarHeight||24; navHeight=Math.max(44,(c.top-statusTop)*2+c.height); safeRight=w.windowWidth-c.left+12; } catch (_) {}
      const draft=api.read().draft||{}; this.reference=draft.reference||'';
      const f=creation.formats.find(f=>f.id===draft.kind)||creation.formats[0];
      this.setData({title:titles[this.properties.pageId],statusTop,navHeight,safeRight,promptInput:draft.prompt||'',kind:f.id,kindName:f.name,formatDetail:f.detail,voice:draft.voice||'',referencePath:draft.reference||'',attempt:api.read().attempt||null,notifications:api.read().notifications||this.data.notifications});
      this.load();
    },
    detached() { this.alive=false; clearTimeout(this.timer); if(this.audio)this.audio.destroy(); }
  },
  pageLifetimes: { show() { this.visible=true; if(this.alive)this.load(); }, hide() { this.visible=false; clearTimeout(this.timer); if(this.audio)this.audio.pause(); } },
  methods: {
    toast(title) { wx.showToast({title,icon:'none'}); },
    fail(error) { if(!this.alive)return; const patch={error:error.message||'暂时无法完成，请重试'};if(error.status===401)Object.assign(patch,{user:null,works:[],visibleWorks:[],job:null,card:emptyCard,publicCard:null,points:[]});this.setData(patch); },
    async run(fn) { if(this.data.busy)return;this.setData({busy:true,error:''});try { return await fn(); }catch(e){this.fail(e);}finally{if(this.alive)this.setData({busy:false});} },
    async load() {
      if(this.loading)return;this.loading=true;
      const token=api.session()&&api.session().token;
      const valid=()=>this.alive&&token===(api.session()&&api.session().token);
      this.setData({loading:true,error:'',user:api.session()&&api.session().user,attempt:api.read().attempt||null});
      if(this.owner&&(!api.session()||api.session().user.username!==this.owner))this.setData({works:[],visibleWorks:[],job:null,card:emptyCard,publicCard:null,points:[],promptInput:'',referencePath:'',attempt:null});
      const page=this.properties.pageId;
      try {
        if(!token || page==='login')return;
        const identity=await api.request('/api/auth/me');if(!valid())return;
        api.rememberIdentity(token,identity.user);
        const saved=api.read();
        if(!this.owner||this.owner!==identity.user.username){this.owner=identity.user.username;const d=saved.draft||{};const f=creation.formats.find(x=>x.id===d.kind)||creation.formats[0];this.reference=d.reference||'';this.setData({promptInput:d.prompt||'',kind:f.id,kindName:f.name,formatDetail:f.detail,voice:d.voice||'',referencePath:d.reference||'',attempt:saved.attempt||null});}
        this.setData({user:identity.user});
        if(['home','works','messages','card-works'].includes(page))await this.loadWorks(valid);
        if(['card','card-edit','privacy','card-works','card-public'].includes(page)) {
          const data=await api.request('/api/auth/card/me?create=0').catch(e=>{if(e.status===404)return {card:null};throw e;}); if(valid())this.setData({card:Object.assign({},emptyCard,data.card||{}),publicCard:null});
          if(page==='card-public'&&data.card&&data.card.published) { const pub=await api.request('/api/auth/card/public?id='+encodeURIComponent(data.card.public_id));if(valid())this.setData({publicCard:pub.card||null}); }
        }
        if(page==='points') { const data=await api.request('/api/gen/points/history?page_size=50');if(valid())this.setData({points:(data.items||[]).map(x=>Object.assign({},x,{date:new Date(x.created_at*1000).toLocaleDateString()}))}); }
        if(page==='invite') { const data=await api.request('/api/invite/dashboard');if(valid())this.setData({invite:data}); }
        if(page==='membership'||page==='benefits') { const data=await api.request('/api/gen/pricing');if(valid())this.setData({prices:(data.items||[]).filter(p=>p.key.startsWith('membership.'))}); }
        if(page==='confirm')await this.loadQuote();
        if(['processing','failed','image-detail','audio-detail','video-detail','text-detail'].includes(page))await this.refreshJob();
        if(page==='chat'&&this.data.kind==='audio')await this.loadVoices();
      } catch(e){if(this.alive)this.fail(e);} finally {this.loading=false;if(this.alive)this.setData({loading:false});}
    },
    async loadWorks(valid=()=>this.alive) {
      const kinds=['image','copy','audio','xiaole_video'];
      const batches=await Promise.all(kinds.map(kind=>api.request('/api/gen/history?kind='+kind+'&include_failed=1&limit=30').then(r=>(r.items||[]).map(x=>creation.jobView(Object.assign({},x,{kind,result:{url:x.url,text:x.text,prompt:x.prompt}}))))));
      const map=new Map();batches.flat().forEach(j=>map.set(j.id,j));
      const pending=api.read().jobIds||[];
      const tracked=await Promise.all(pending.slice(0,12).filter(id=>!map.has(id)).map(id=>api.request('/api/gen/job/'+encodeURIComponent(id)).then(creation.jobView).catch(e=>{if(e.status===404)return null;throw e;})));
      tracked.filter(Boolean).forEach(j=>map.set(j.id,j));
      const works=[...map.values()].sort((a,b)=>b.id-a.id);
      const page=this.properties.pageId;
      const images=(page==='home'?works.slice(0,3):page==='messages'?[]:works).filter(j=>j.kind==='image'&&j.url);
      for(let i=0;i<images.length;i+=4)await Promise.all(images.slice(i,i+4).map(async j=>{j.displayUrl=await api.mediaSource(j.url).catch(()=> '');}));
      if(valid()){this.setData({works,hasMore:batches.some(b=>b.length>=30)});this.applyFilter();}
    },
    field(e) { const key=e.currentTarget.dataset.field;if(['promptInput','username','password','feedbackInput','search'].includes(key)){this.setData({[key]:e.detail.value});if(key==='search')this.applyFilter();} },
    cardField(e) {const key=e.currentTarget.dataset.field;if(['name','headline','company','bio','email','address'].includes(key))this.setData({['card.'+key]:e.detail.value});},
    openLegacy(e){const routes={home:'/pages/home/home',recharge:'/pages/recharge/recharge',invite:'/pages/invite/invite',card:'/pages/my-card/my-card'};const id=e.currentTarget.dataset.legacy;const url=routes[id];if(!url)return;if(id==='home')wx.switchTab({url});else wx.navigateTo({url});},
    go(e){this.navigate(e.currentTarget.dataset.route);},
    navigate(id){if(!pages.some(p=>p.id===id))return;if(id==='login'){wx.navigateTo({url:'/pages/login/login?redirect=paper'});return;}const url='/paper/pages/'+id+'/index';if(['home','works','profile'].includes(id))wx.reLaunch({url});else wx.navigateTo({url,fail:()=>wx.redirectTo({url})});},
    back(){if(getCurrentPages().length>1)wx.navigateBack();else this.navigate('home');},
    requireLogin(){if(api.session())return true;this.navigate('login');return false;},
    consentChange(e){this.setData({consent:e.detail.value.includes('agree')});},
    login(){this.run(async()=>{if(!this.data.consent)throw new Error('请阅读并同意账号登录说明');if(!this.data.username.trim()||!this.data.password)throw new Error('请填写账号与密码');await api.login(this.data.username,this.data.password);this.setData({password:''});this.navigate('home');});},
    logout(){this.run(async()=>{try{await api.request('/api/auth/logout','POST',{});}catch(_){}api.setSession(null);this.setData({user:null,password:'',works:[],card:emptyCard});this.navigate('login');});},
    chooseKind(e){const kind=e.currentTarget.dataset.kind;const f=creation.format(kind);this.setData({kind,kindName:f.name,formatDetail:f.detail,quote:null});if(kind==='audio'&&api.session())this.run(()=>this.loadVoices());},
    draft(){return {kind:this.data.kind,prompt:this.data.promptInput,voice:this.data.voice,reference:this.reference||''};},
    startChat(){if(!this.requireLogin())return;this.run(async()=>{if(!this.data.promptInput.trim())throw new Error('先写下一点想法吧');api.save({draft:this.draft()});this.navigate('chat');});},
    sendPrompt(){this.run(async()=>{if(!this.data.promptInput.trim())throw new Error('请填写创作需求');api.save({draft:this.draft()});this.setData({chatView:'proposal',stopped:false});});},
    stopThought(){this.setData({stopped:!this.data.stopped});},
    confirmPlan(){if(!this.requireLogin())return;this.run(async()=>{creation.payload(this.draft());api.save({draft:this.draft()});this.navigate('confirm');});},
    async loadQuote(){const draft=api.read().draft;if(!draft)throw new Error('请先填写创作需求');const q=await creation.quote(draft);if(this.alive)this.setData({quote:q,promptInput:draft.prompt,kind:draft.kind,kindName:creation.format(draft.kind).name,formatDetail:q.detail});},
    startGeneration(){this.run(async()=>{if(!this.data.quote)throw new Error('请先取得当前报价');try {await creation.submit(api.read().draft,this.data.quote.cost);}catch(e){this.setData({attempt:api.read().attempt||null});if(e.code==='price_changed')await this.loadQuote();throw e;}this.navigate('processing');});},
    recover(){this.run(async()=>{await creation.submit(null,null,true);this.navigate('processing');});},
    async refreshJob(){clearTimeout(this.timer);const s=api.read().selected;if(!s||!s.id)throw new Error('请从作品列表选择一个任务');const owner=api.session()&&api.session().user.username;const data=await api.request('/api/gen/job/'+encodeURIComponent(s.id));if(!this.alive||!api.session()||owner!==api.session().user.username)return;const job=creation.jobView(data,s.kind);job.displayUrls=await Promise.all(job.urls.map(api.mediaSource));job.displayUrl=job.displayUrls[0]||'';if(!this.alive||!api.session()||owner!==api.session().user.username)return;this.setData({job});if(this.visible&&this.properties.pageId==='processing'&&!job.done&&!job.failed)this.timer=setTimeout(()=>this.refreshJob().catch(e=>this.fail(e)),4000);},
    refreshTask(){this.run(()=>this.refreshJob());},
    openWork(e){const id=Number(e.currentTarget.dataset.id),job=this.data.works.find(j=>Number(j.id)===id);if(!job)return;this.run(async()=>{api.save({selected:{id,kind:job.kind}});this.navigate(job.done?job.kind+'-detail':job.failed?'failed':'processing');});},
    viewResult(){const j=this.data.job;if(j&&j.done)this.navigate(j.kind+'-detail');},
    retry(){this.run(async()=>{const local=api.read();if(!local.draft||!local.attempt||Number(local.attempt.jobId)!==Number(this.data.job&&this.data.job.id))throw new Error('这件作品的原始需求未保存在此设备，请回首页填写后重新确认');this.navigate('confirm');});},
    applyFilter(){const q=this.data.search.trim().toLowerCase();this.setData({visibleWorks:this.data.works.filter(w=>(this.properties.pageId!=='card-works'||(w.done&&['image','video'].includes(w.kind)))&&(this.data.filter==='all'||w.kind===this.data.filter)&&(!q||w.title.toLowerCase().includes(q)))});},
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
      const job=this.data.works.find(j=>Number(j.id)===Number(e.currentTarget.dataset.id));
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
