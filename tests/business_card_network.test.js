const assert = require('assert');
const fs = require('fs');
const path = require('path');

const store = {};
global.wx = {
  getStorageSync(key) { return store[key]; },
  setStorageSync(key, value) { store[key] = value; },
  removeStorageSync(key) { delete store[key]; }
};

const invite = require('../miniprogram/utils/invite.js');
const card = require('../miniprogram/utils/card.js');
assert.strictEqual(invite.cardSharePath('public-1', 'ABCD23'), '/pages/card/card?id=public-1&invite=ABCD23');
assert.strictEqual(invite.cardSharePath('', 'ABCD23'), '/pages/card/card');

const validatedAt = 1700000000000;
card.rememberValidInvite('ABCD23', validatedAt);
assert.strictEqual(card.lastValidInvite(validatedAt + card.ATTRIBUTION_TTL), 'ABCD23');
assert.strictEqual(card.lastValidInvite(validatedAt + card.ATTRIBUTION_TTL + 1), '');
card.rememberValidInvite('ABCD23', 2);
assert.strictEqual(store[card.ATTRIBUTION_KEY].validated_at, 2000);
assert.deepStrictEqual(card.privacy({}), { phone: false, email: false, address: false, wechat_qr: false });
assert.deepStrictEqual(card.privacy({ privacy: { phone: 1, email: true, address: 'yes', wechat_qr: false } }), { phone: true, email: true, address: true, wechat_qr: false });
assert.strictEqual(card.isComplete({ name: '王小明', title: '设计师', company: '黄雀' }), true);

global.Page = function () {};
const login = require('../miniprogram/pages/login/login.js');
const registration = login.buildRegistrationPayload('wang', 'secret', 'ABCD23', { name: '王小明', title: '设计师', company: '黄雀', privacy: { phone: true } });
assert.strictEqual(registration.invite_code, 'ABCD23');
assert.strictEqual(registration.card.name, '王小明');
assert.strictEqual(registration.card.privacy.phone, true);
assert.strictEqual(registration.card.privacy.email, false);

const recharge = require('../miniprogram/pages/recharge/recharge.js');
const experience = recharge.buildRechargeConfig({ membership_status: 'active', membership_active: true, membership_tier: 'experience' }, { items: [] });
assert.strictEqual(experience.packages[0].id, 'membership_experience_renewal');
assert.strictEqual(experience.packages[0].points, 0);
assert.deepStrictEqual(recharge.virtualPaymentPayload('membership_experience_renewal', 499, 'code'), {
  package_id: 'membership_experience_renewal', wx_code: 'code', product_type: 'membership_experience_renewal', order_type: 'membership_experience_renewal'
});
assert.strictEqual(recharge.EXPERIENCE_RENEWAL_PACKAGE.benefit.includes('1000'), false);
assert.strictEqual(recharge.buildRechargeConfig({ membership_status: 'active', membership_active: true, membership_tier: 'partner' }, { items: [] }).contactAdmin, true);

const root = path.resolve(__dirname, '..');
const appJson = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/app.json'), 'utf8'));
['pages/card/card', 'pages/card-edit/card-edit', 'pages/network/network'].forEach((page) => assert.ok(appJson.pages.includes(page)));
const publicCard = fs.readFileSync(path.join(root, 'miniprogram/pages/card/card.js'), 'utf8');
const editCard = fs.readFileSync(path.join(root, 'miniprogram/pages/card-edit/card-edit.wxml'), 'utf8');
const network = fs.readFileSync(path.join(root, 'miniprogram/pages/network/network.js'), 'utf8');
assert.match(publicCard, /\/api\/auth\/card\/public/);
assert.match(publicCard, /data\.invite_valid === true/);
assert.match(publicCard, /rememberValidInvite/);
assert.match(editCard, /card\.privacy\.phone/);
assert.match(editCard, /card\.privacy\.email/);
assert.match(editCard, /card\.privacy\.address/);
assert.match(editCard, /card\.privacy\.wechat_qr/);
assert.match(network, /\/api\/auth\/network\/ancestors/);
assert.match(network, /parent=self/);
assert.match(network, /loadBranch/);
console.log('business card and network tests passed');
