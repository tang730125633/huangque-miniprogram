const test = require('node:test');
const assert = require('node:assert/strict');

const rewards = require('../miniprogram/utils/invite-rewards.js');
const notifications = require('../miniprogram/utils/notifications.js');

test('waits for the reward modal before checking platform announcements', async () => {
  const originalReward = rewards.showNextRewardNotice;
  const originalAnnouncement = notifications.checkLatest;
  const calls = [];
  let closeReward;
  rewards.showNextRewardNotice = () => {
    calls.push('reward');
    return new Promise((resolve) => { closeReward = resolve; });
  };
  notifications.checkLatest = () => {
    calls.push('announcement');
    return Promise.resolve();
  };
  let appDefinition;
  global.App = (definition) => { appDefinition = definition; };
  try {
    require('../miniprogram/app.js');
    const pending = appDefinition.onShow.call(appDefinition, {});
    assert.deepEqual(calls, ['reward']);
    closeReward(null);
    await pending;
    assert.deepEqual(calls, ['reward', 'announcement']);
  } finally {
    rewards.showNextRewardNotice = originalReward;
    notifications.checkLatest = originalAnnouncement;
  }
});
