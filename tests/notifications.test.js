const assert = require('assert');
const fs = require('fs');

const notifications = require('../miniprogram/utils/notifications.js');
const now = 200;
assert.strictEqual(notifications.eligible({ kind: 'announcement', read_at: 0, popup_until: 300, popup_snoozed_until: 0 }, now), true);
assert.strictEqual(notifications.eligible({ kind: 'announcement', read_at: 1, popup_until: 300, popup_snoozed_until: 0 }, now), false);
assert.strictEqual(notifications.eligible({ kind: 'system', read_at: 0, popup_until: 300, popup_snoozed_until: 0 }, now), false);
assert.strictEqual(notifications.eligible({ kind: 'announcement', read_at: 0, popup_until: 300, popup_snoozed_until: 250 }, now), false);

const app = JSON.parse(fs.readFileSync('miniprogram/app.json', 'utf8'));
assert.ok(app.pages.includes('pages/notifications/notifications'));
const page = fs.readFileSync('miniprogram/pages/notifications/notifications.js', 'utf8');
const profile = fs.readFileSync('miniprogram/pages/profile/profile.wxml', 'utf8');
assert.match(page, /event_type === EVENT_TYPE/);
assert.match(page, /requestSubscribeMessage/);
assert.match(page, /tmplIds: \[templateId\]/);
assert.match(page, /\/api\/auth\/subscription\/choices/);
assert.match(page, /\/api\/auth\/notifications\/read-all/);
assert.match(profile, /消息中心/);
assert.match(profile, /unread-badge/);

console.log('notification center checks passed');
