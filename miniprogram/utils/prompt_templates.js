const IMAGE_TEMPLATES = [
  {
    key: 'poster', name: '活动海报', ratio: '9:16',
    template: '{brand}活动海报，主色调{color}，突出“{selling}”，优惠信息“{price}”。高级商业摄影质感，品牌信息层级清晰，主体聚焦，留出中文标题与行动按钮区域，适合手机竖屏展示，无水印。'
  },
  {
    key: 'deal', name: '团购套餐', ratio: '3:4',
    template: '{brand}团购套餐宣传图，{color}配色，核心卖点“{selling}”，价格权益“{price}”。产品与服务项目排版清楚，质感高级，光影干净，适合电商详情页与社交媒体发布，无水印。'
  },
  {
    key: 'screen', name: '门店竖屏', ratio: '9:16',
    template: '{brand}门店竖屏广告，{color}视觉体系，重点展示“{selling}”和“{price}”。空间有层次，品牌标识醒目，商业海报构图，适合门店大屏循环展示，无水印。'
  },
  {
    key: 'grid', name: '朋友圈九宫格', ratio: '1:1',
    template: '{brand}朋友圈九宫格主视觉，{color}统一配色，围绕“{selling}”组织内容，“{price}”作为转化信息。方形构图，社交媒体高级感，视觉统一且便于后续拆分延展，无水印。'
  },
  {
    key: 'ip', name: '数字化 IP 首帧', ratio: '9:16',
    template: '{brand}数字化 IP 视频首帧，人物自然面对镜头，{color}品牌场景，主题“{selling}”，画面可自然带出“{price}”。半身构图，真实皮肤质感，柔和轮廓光，背景简洁高级，口播区域留白，无水印。'
  }
];

const VIDEO_TEMPLATES = [
  {
    key: 'product', name: '产品展示', ratio: '9:16',
    template: '{subject}在{scene}中进行{action}。{style}，镜头从中景缓慢推进到特写，主体始终清晰，材质与细节真实，光影自然流动，动作连贯稳定，商业广告质感，无字幕，无水印。'
  },
  {
    key: 'store', name: '门店探店', ratio: '9:16',
    template: '镜头进入{scene}，围绕{subject}进行{action}。{style}，第一人称顺滑运镜，依次展示环境、服务细节和核心亮点，空间层次清晰，人物动作自然，适合竖屏短视频，无字幕，无水印。'
  },
  {
    key: 'ip', name: '数字化 IP', ratio: '9:16',
    template: '{subject}出现在{scene}，自然完成{action}。{style}，人物保持一致，面部清晰自然，半身镜头轻微推进，眼神与动作稳定，背景有轻微景深，适合作为数字化 IP 品牌短片，无字幕，无水印。'
  },
  {
    key: 'brand', name: '品牌广告', ratio: '16:9',
    template: '{subject}在{scene}中完成{action}。{style}，电影级品牌广告，广角建立场景后切换主体特写，镜头节奏克制高级，构图干净，光影层次丰富，结尾定格品牌主视觉，无字幕，无水印。'
  },
  {
    key: 'cinematic', name: '电影运镜', ratio: '16:9',
    template: '{subject}置身于{scene}并进行{action}。{style}，电影感长镜头，前景遮挡转场，低机位环绕后缓慢拉远，环境光与轮廓光自然变化，运动连贯，细节真实，无字幕，无水印。'
  }
];

function text(value, fallback) {
  const result = String(value == null ? '' : value).trim();
  return result || fallback;
}

function findTemplate(templates, key) {
  return templates.find((item) => item.key === key) || templates[0];
}

function fill(template, fields) {
  return template.replace(/\{(\w+)\}/g, (all, key) => text(fields[key], '未指定'));
}

function buildImagePrompt(key, fields) {
  const item = findTemplate(IMAGE_TEMPLATES, key);
  return { prompt: fill(item.template, fields || {}), ratio: item.ratio };
}

function buildVideoPrompt(key, fields) {
  const item = findTemplate(VIDEO_TEMPLATES, key);
  return { prompt: fill(item.template, fields || {}), ratio: item.ratio };
}

module.exports = {
  IMAGE_TEMPLATES,
  VIDEO_TEMPLATES,
  buildImagePrompt,
  buildVideoPrompt
};
