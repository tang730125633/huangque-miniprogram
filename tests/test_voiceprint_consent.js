const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'miniprogram', 'pages');
const legal = fs.readFileSync(path.join(root, 'legal', 'legal.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'clone', 'clone.wxml'), 'utf8');
const source = fs.readFileSync(path.join(root, 'clone', 'clone.js'), 'utf8');

assert(legal.includes("voiceprint: {"));
assert(legal.includes("title: '声纹授权协议'"));
assert(legal.includes('处理的信息'));
assert(legal.includes('处理目的'));
assert(legal.includes('处理方式'));
assert(legal.includes('保存与删除'));
assert(legal.includes('撤回授权'));
assert(legal.includes('本人的声音'));

assert(page.includes('bindchange="onVoiceConsentChange"'));
assert(page.includes('url="/pages/legal/legal?type=voiceprint"'));
assert(page.includes('我已阅读并单独同意《声纹授权协议》'));
assert(page.includes('!voiceConsent'));
assert(page.includes('<view class="voice-consent-panel">'));
assert(!page.includes('wx:if="{{stage!==\'loading\'}}" class="voice-consent-panel"'));
assert(page.indexOf('class="voice-consent-panel"') < page.indexOf('class="voice-library"'));

assert(source.includes('voiceConsent: false'));
assert(source.includes("const VOICE_CONSENT_VERSION = '2026-07-23-v1'"));
assert(source.includes('onVoiceConsentChange'));
assert(source.includes('if (!this.data.voiceConsent)'));
assert(source.includes('请先阅读并单独同意《声纹授权协议》'));
assert(source.includes('voice_consent: true'));
assert(source.includes('voice_consent_version: VOICE_CONSENT_VERSION'));
assert(source.includes('voice_consent_at: this.data.voiceConsentAt'));
assert(source.includes("api.request('/api/gen/audio/slots', { method: 'GET', timeout: 12000 })"));

console.log('voiceprint consent tests passed');
