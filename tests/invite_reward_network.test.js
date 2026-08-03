const assert = require('assert');
const fs = require('fs');
const path = require('path');

global.wx = global.wx || {};
global.getApp = global.getApp || (() => ({ globalData: {} }));
global.Page = global.Page || (() => {});

const rewards = require('../miniprogram/utils/invite-rewards.js');

const now = 1_700_000_000;
assert.strictEqual(rewards.countdownText(now + 65, now), '1分05秒后到期');
assert.strictEqual(rewards.countdownText(now - 1, now), '已到期');
assert.strictEqual(rewards.rewardStatusText({ reward_status: 'pending_upgrade', reward_points: 240, reward_expires_at: now + 65 }, now), '待升级领取 240 点 · 1分05秒后到期');
assert.strictEqual(rewards.rewardStatusText({ reward_status: 'credited', reward_points: 200 }, now), '已到账 200 点');
assert.strictEqual(rewards.rewardStatusText({ reward_status: '', reward_points: 0 }, now), '暂无奖励');
assert.strictEqual(rewards.noticeCopy({ type: 'reward_unlocked', reward_points: 240 }).title, '升级成功，邀请奖励已解锁');
assert.strictEqual(rewards.noticeCopy({ type: 'reward_unlocked', reward_points: 0 }).content, '邀请权益已自动发放');
assert.deepStrictEqual(rewards.noticeAction({ notice_type: 'pending_upgrade', required_tier: 'experience' }), {
  confirmText: '去开通体验官', url: '/pages/recharge/recharge'
});
assert.deepStrictEqual(rewards.noticeAction({ notice_type: 'pending_upgrade', required_tier: 'partner' }), {
  confirmText: '联系管理员', url: '/pages/recharge/recharge'
});
assert.deepStrictEqual(rewards.noticeAction({ notice_type: 'reward_unlocked' }), {
  confirmText: '查看我的下线', url: '/pages/invite/invite'
});

const root = path.resolve(__dirname, '..');
const inviteJs = fs.readFileSync(path.join(root, 'miniprogram/pages/invite/invite.js'), 'utf8');
const inviteWxml = fs.readFileSync(path.join(root, 'miniprogram/pages/invite/invite.wxml'), 'utf8');
const networkJs = fs.readFileSync(path.join(root, 'miniprogram/pages/network/network.js'), 'utf8');
const networkWxml = fs.readFileSync(path.join(root, 'miniprogram/pages/network/network.wxml'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'miniprogram/app.js'), 'utf8');
const rechargeJs = fs.readFileSync(path.join(root, 'miniprogram/pages/recharge/recharge.js'), 'utf8');

assert.match(inviteJs, /\/api\/auth\/invite\/downlines\?limit=20/);
assert.match(inviteJs, /syncServerTime\(data\.server_time\)/);
assert.match(inviteWxml, /我的下线/);
assert.match(inviteWxml, /bindtap="openDownline"/);
assert.match(inviteWxml, /catchtap="openDownlineCard"/);
assert.match(inviteWxml, /加载更多/);
assert.doesNotMatch(inviteWxml, /奖励记录/);
assert.match(networkJs, /\/api\/auth\/invite\/network\?grant=/);
assert.match(networkWxml, /当前用户/);
assert.match(networkWxml, /上线/);
assert.match(networkWxml, /直接下线/);
assert.match(networkWxml, /catchtap="openCard"/);
assert.match(appJs, /showNextRewardNotice/);
assert.match(rechargeJs, /showNextRewardNotice/);

console.log('invite reward network tests passed');
