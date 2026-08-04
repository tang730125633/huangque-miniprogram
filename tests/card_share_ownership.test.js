'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const cardJsPath = path.join(root, 'miniprogram/pages/card/card.js');
const cardWxmlPath = path.join(root, 'miniprogram/pages/card/card.wxml');
const cardSource = fs.readFileSync(cardJsPath, 'utf8');
const cardWxml = fs.readFileSync(cardWxmlPath, 'utf8');

let pageDefinition;
global.Page = function (definition) { pageDefinition = definition; };
global.wx = { hideShareMenu() {}, showShareMenu() {} };
delete require.cache[require.resolve(cardJsPath)];
const cardModule = require(cardJsPath);

test('only the card owner satisfies the share permission', () => {
  assert.equal(cardModule.canShareCard({ isMine: true, shareReady: true }), true);
  assert.equal(cardModule.canShareCard({ isMine: false, shareReady: true }), false);
  assert.equal(cardModule.canShareCard({ isMine: true, shareReady: false }), false);
});

test('a public-card viewer cannot generate another user card share path', () => {
  const result = pageDefinition.onShareAppMessage.call({
    data: {
      isMine: false,
      shareReady: true,
      publicId: 'other-card',
      card: { public_id: 'other-card', invite_code: 'ABCD23', name: '其他用户' },
      shareImageUrl: '/tmp/other-card.jpg'
    }
  });
  assert.equal(result.path, '/pages/home/home');
  assert.doesNotMatch(result.path, /other-card/);
});

test('the owner can still share their own published card', () => {
  const result = pageDefinition.onShareAppMessage.call({
    data: {
      isMine: true,
      shareReady: true,
      publicId: 'my-card',
      card: { public_id: 'my-card', invite_code: 'ABCD23', name: '岳雷' },
      shareImageUrl: '/tmp/my-card.jpg'
    }
  });
  assert.equal(result.path, '/pages/card/card?id=my-card&invite=ABCD23');
});

test('public-card loading never enables sharing and UI remains view-only', () => {
  const publicStart = cardSource.indexOf('  loadPublic(');
  const ownerStart = cardSource.indexOf('  loadMine(', publicStart);
  assert.ok(publicStart >= 0 && ownerStart > publicStart);
  const publicLoader = cardSource.slice(publicStart, ownerStart);
  assert.doesNotMatch(publicLoader, /enableShare/);
  assert.match(cardWxml, /wx:if="\{\{isMine && shareReady\}\}"/);
  assert.match(cardWxml, /名片只允许本人分享/);
  assert.doesNotMatch(cardWxml, /分享这张名片/);
});
