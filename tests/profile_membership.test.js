const assert = require('assert');
const fs = require('fs');
const path = require('path');
const membership = require('../miniprogram/utils/membership.js');

[
  ['experience', '体验官'],
  ['partner', '合伙人'],
  ['initiator', '发起人']
].forEach(function (entry) {
  const active = membership.buildMembershipView({
    membership_status: 'active',
    membership_active: true,
    membership_tier: entry[0],
    membership_name: entry[1],
    membership_expires_at: 1800000000,
    points_purchase_discount_label: '服务端折扣'
  });
  assert.strictEqual(active.name, entry[1]);
  assert.strictEqual(active.tierClass, entry[0]);
  assert.strictEqual(active.statusText, '有效');
  assert.strictEqual(active.discountText, '服务端折扣');
  assert.strictEqual(active.showNonmemberNotice, false);
});

const expired = membership.buildMembershipView({
  membership_status: 'expired',
  membership_last_tier: 'initiator',
  membership_last_name: '发起人',
  membership_last_expires_at: 1700000000
});
assert.strictEqual(expired.name, '发起人');
assert.strictEqual(expired.statusText, '已过期');
assert.strictEqual(expired.discountText, '当前不可用');
assert.strictEqual(expired.showNonmemberNotice, true);

const nonmember = membership.buildMembershipView({
  membership_status: 'none',
  membership_active: false
});
assert.strictEqual(nonmember.name, '非会员');
assert.strictEqual(nonmember.statusText, '未开通');
assert.strictEqual(nonmember.showNonmemberNotice, true);

const root = path.resolve(__dirname, '..');
const profileJs = fs.readFileSync(path.join(root, 'miniprogram/pages/profile/profile.js'), 'utf8');
const profileWxml = fs.readFileSync(path.join(root, 'miniprogram/pages/profile/profile.wxml'), 'utf8');
assert.match(profileJs, /membership\.buildMembershipView\(user\)/);
assert.match(profileWxml, /membership\.discountText/);
assert.match(profileWxml, /当前小程序不提供充值入口/);
assert.doesNotMatch(profileJs, /7\.5折|5\.5折|7500|5500/);
assert.doesNotMatch(profileJs, /setStorageSync|membership_expires_at\s*[<>]/);
assert.doesNotMatch(profileWxml, /bindtap="goRecharge"|立即开通|立即充值/);

console.log('profile membership tests passed');
