const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'miniprogram', 'pages');
const legal = fs.readFileSync(path.join(root, 'legal', 'legal.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'clone', 'clone.wxml'), 'utf8');
const source = fs.readFileSync(path.join(root, 'clone', 'clone.js'), 'utf8');
const videoPage = fs.readFileSync(path.join(root, 'video', 'video.wxml'), 'utf8');
const videoSource = fs.readFileSync(path.join(root, 'video', 'video.js'), 'utf8');
const homePage = fs.readFileSync(path.join(root, 'home', 'home.wxml'), 'utf8');
const homeSource = fs.readFileSync(path.join(root, 'home', 'home.js'), 'utf8');

assert(legal.includes("voiceprint: {"));
assert(legal.includes("title: '声纹授权协议'"));
assert(legal.includes('处理的信息'));
assert(legal.includes('处理目的'));
assert(legal.includes('处理方式'));
assert(legal.includes('保存与删除'));
assert(legal.includes('撤回授权'));
assert(legal.includes('本人的声音'));
assert(legal.includes('数字化 IP 的上传音频功能'));
assert(legal.includes('选择口播音频前'));

assert(page.includes('url="/pages/legal/legal?type=voiceprint"'));
assert(page.includes('bindtap="declineVoiceConsent"'));
assert(page.includes('bindtap="acceptVoiceConsent"'));
assert(page.includes('不同意并退出'));
assert(page.includes('同意并进入'));
assert(page.includes('!voiceConsent'));
assert(page.includes('wx:if="{{consentGateVisible}}" class="consent-gate-mask"'));
assert(page.includes('wx:if="{{!consentGateVisible}}" class="container clone-page"'));
assert(page.indexOf('class="consent-gate-mask"') < page.indexOf('class="container clone-page"'));

assert(source.includes('consentGateVisible: true'));
assert(source.includes('voiceConsent: false'));
assert(source.includes("const VOICE_CONSENT_VERSION = '2026-07-23-v2'"));
assert(source.includes('acceptVoiceConsent'));
assert(source.includes('declineVoiceConsent'));
assert(source.includes('if (this.data.consentGateVisible || !this.data.voiceConsent) return;'));
assert(source.includes('this._initMedia();'));
assert(source.includes('if (!this.data.voiceConsent)'));
assert(source.includes('请先阅读并单独同意《声纹授权协议》'));
assert(source.includes('voice_consent: true'));
assert(source.includes('voice_consent_version: VOICE_CONSENT_VERSION'));
assert(source.includes('voice_consent_at: this.data.voiceConsentAt'));
assert(source.includes("api.request('/api/gen/audio/slots', { method: 'GET', timeout: 12000 })"));

assert(videoPage.includes('黄雀智创 申请'));
assert(videoPage.includes('使用以下声音信息'));
assert(videoPage.includes('口播音频与必要声音特征'));
assert(videoPage.includes('url="/pages/legal/legal?type=voiceprint"'));
assert(videoPage.includes('bindchange="onTalkAudioConsentChange"'));
assert(videoPage.includes('bindtap="cancelTalkAudioConsent"'));
assert(videoPage.includes('bindtap="confirmTalkAudioConsent"'));
assert(videoPage.includes('我已阅读并单独同意《声纹授权协议》'));
assert(videoSource.includes('talkAudioConsentVisible: false'));
assert(videoSource.includes('if (!this.data.talkAudioConsent)'));
assert(videoSource.indexOf('if (!this.data.talkAudioConsent)') < videoSource.indexOf('this._chooseTalkAudioFile();'));
assert(videoSource.includes("body.voice_consent_scope = 'talking_audio'"));
assert(videoSource.includes('body.voice_consent_version = TALK_AUDIO_CONSENT_VERSION'));
assert(videoSource.includes('body.voice_consent_at = this.data.talkAudioConsentAt'));

assert(homePage.includes('<view class="mc-title">一键跟创</view>'));
assert(!homePage.includes('视频灵感拆解'));
assert(homeSource.includes("wx.switchTab({ url: '/pages/inspiration/inspiration' })"));
assert(!homeSource.includes("wx.showToast({ title: '功能即将上线'"));

console.log('voiceprint consent tests passed');
