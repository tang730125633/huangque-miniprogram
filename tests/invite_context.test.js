const assert = require('assert');

const storage = {};
global.wx = {
  getStorageSync(key) { return storage[key]; },
  setStorageSync(key, value) { storage[key] = value; },
  removeStorageSync(key) { delete storage[key]; }
};

const context = require('../miniprogram/utils/invite-context.js');

context.clear();
assert.strictEqual(context.current(1000), null);

assert.strictEqual(context.saveLink({
  code: 'abcd23',
  inviter: { name: '邀请人 A', account_id: 'HQ-A' },
  validated_at: 100,
  expires_at: 100 + 7 * 24 * 3600
}), true);
assert.deepStrictEqual(context.current(101000), {
  source: 'link',
  code: 'ABCD23',
  inviter: { name: '邀请人 A', account_id: 'HQ-A' },
  attribution_token: '',
  validated_at: 100000,
  expires_at: (100 + 7 * 24 * 3600) * 1000
});
assert.deepStrictEqual(context.registrationPayload(101000), { invite_code: 'ABCD23' });

assert.strictEqual(context.saveCard({
  code: 'efgh45',
  inviter: { name: '邀请人 B', account_id: 'HQ-B' },
  attribution_token: 'signed-card-token',
  validated_at: 200,
  expires_at: 200 + 7 * 24 * 3600
}), true);
assert.strictEqual(context.current(201000).source, 'card');
assert.strictEqual(context.current(201000).code, 'EFGH45');
assert.strictEqual(context.current(201000).inviter.name, '邀请人 B');
assert.deepStrictEqual(context.registrationPayload(201000), {
  invite_code: 'EFGH45',
  invite_attribution_token: 'signed-card-token'
});

assert.strictEqual(context.saveCard({
  code: 'JKLM67',
  inviter: { name: '缺少签名' },
  validated_at: 300,
  expires_at: 400
}), false);
assert.strictEqual(context.current(201000).code, 'EFGH45');

storage[context.STORAGE_KEY] = {
  source: 'link', code: 'BAD010', inviter: { name: '无效' },
  validated_at: 100000, expires_at: 200000
};
assert.strictEqual(context.current(150000), null);
assert.strictEqual(storage[context.STORAGE_KEY], undefined);

context.saveLink({
  code: 'NPQR89', inviter: { name: '已过期' },
  validated_at: 100, expires_at: 200
});
assert.strictEqual(context.current(200001), null);
assert.strictEqual(storage[context.STORAGE_KEY], undefined);

context.saveLink({
  code: 'STUV23', inviter: { name: '有效' },
  validated_at: 100, expires_at: 100 + 30 * 24 * 3600
});
assert.strictEqual(
  context.current(101000).expires_at,
  (100 + 7 * 24 * 3600) * 1000,
  'client must cap a server expiry to seven days from validation'
);

context.clear();
assert.strictEqual(context.current(), null);
assert.strictEqual(storage[context.STORAGE_KEY], undefined);

console.log('invite context tests passed');
