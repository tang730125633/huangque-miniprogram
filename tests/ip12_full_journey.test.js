const assert = require('assert');
const fs = require('fs');

const page = fs.readFileSync('miniprogram/pages/ip12/ip12.js', 'utf8');
const view = fs.readFileSync('miniprogram/pages/ip12/ip12.wxml', 'utf8');

assert.match(page, /CONVERSATION_KEY/);
assert.match(page, /loadConversations/);
assert.match(page, /createConversation/);
assert.match(page, /chat-complete/);
assert.match(page, /timeout: 180000/);
assert.match(page, /foundation-report\/.*\.pdf/);
assert.match(page, /showMenu: true/);
assert.match(page, /我已确认模块 1-4 初稿，请开始模块 5/);
assert.match(view, /一次问一个问题/);
assert.match(view, /查看 PDF/);
assert.match(view, /确认初稿/);
assert.match(view, /reportConfirmed[\s\S]*随时回来查看 PDF[\s\S]*bindtap="downloadReport"/);
assert.doesNotMatch(view, /OpenAI|GPT|Structured/i);
console.log('IP12 Hermes journey checks passed');
