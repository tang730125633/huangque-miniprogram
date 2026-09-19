const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let component;
const store = new Map();
global.wx = {
  getStorageSync: k => store.get(k),
  setStorageSync: (k, v) => store.set(k, v),
  removeStorageSync: k => store.delete(k),
  showToast() {},
  vibrateShort() {}
};
global.getApp = () => ({ globalData: { apiBase: 'https://huangquechuanmei.com' } });
global.Component = value => { component = value; };

const api = require('../miniprogram/paper/services/api');
require('../miniprogram/paper/components/screen/index');

function setData(patch) {
  for (const [key, value] of Object.entries(patch)) {
    const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
    let node = this.data;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node[parts[i]]) node[parts[i]] = {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = value;
  }
}

test('Codex-style queue panel: attached inside compact-composer in WXML', () => {
  const wxmlPath = path.join(__dirname, '../miniprogram/paper/components/screen/index.wxml');
  const wxml = fs.readFileSync(wxmlPath, 'utf8');
  
  // Verify agent-queue-panel and agent-queue-editbar are positioned inside compact-composer
  const composerIdx = wxml.indexOf('class="hq-view agent-composer compact-composer"');
  const queuePanelIdx = wxml.indexOf('class="hq-view agent-queue-panel"');
  const queueEditbarIdx = wxml.indexOf('class="hq-view agent-queue-editbar"');
  const composerRowIdx = wxml.indexOf('class="hq-view compact-composer-row"');
  
  assert.ok(composerIdx !== -1, 'compact-composer exists in WXML');
  assert.ok(queuePanelIdx > composerIdx && queuePanelIdx < composerRowIdx, 'agent-queue-panel is inside compact-composer before composer row');
  assert.ok(queueEditbarIdx > composerIdx && queueEditbarIdx < composerRowIdx, 'agent-queue-editbar is inside compact-composer before composer row');

  // Verify sleek tags and buttons in queue panel
  assert.match(wxml, /tag-head/, 'Contains tag-head for currently replying item');
  assert.match(wxml, /tag-wait/, 'Contains tag-wait for queued items');
  assert.match(wxml, /排队/);
});

test('Interactive chooseAgentWidget: updates pending count, badge, and auto-collapses when complete', async () => {
  const savedReq = api.request;
  api.request = async () => ({ ok: true });
  const screen = {
    alive: true,
    data: {
      agentSessionId: 'sid-choose-test',
      busy: false,
      agentThinking: false,
      agentTaskCollapsed: false,
      agentTaskPendingCount: 2,
      agentTaskBadgeText: '2 项待选',
      agentWidgets: [
        {
          key: 'av@1',
          domId: 'agent-widget-0',
          type: 'avatar_pick',
          kind: 'avatar',
          title: '数字人形象',
          selectedId: '',
          answered: false,
          expanded: false,
          items: [{ id: 'av_1', title: '本人形象' }]
        },
        {
          key: 'vo@1',
          domId: 'agent-widget-1',
          type: 'voice_pick',
          kind: 'voice',
          title: '声音克隆槽位',
          selectedId: '',
          answered: false,
          expanded: false,
          items: [{ id: 'vo_1', title: '我的克隆音色' }]
        }
      ]
    },
    setData,
    maybeSubmitAgentPicks() {}
  };

  // Pick widget 0 (avatar)
  await component.methods.chooseAgentWidget.call(screen, {
    currentTarget: { dataset: { widget: 0, option: 0 } }
  });
  assert.equal(screen.data.agentWidgets[0].selectedId, 'av_1');
  assert.equal(screen.data.agentWidgets[0].answered, true);
  assert.equal(screen.data.agentWidgets[0].selectedTitle, '本人形象');
  assert.equal(screen.data.agentTaskPendingCount, 1, '1 item pending after picking 1 of 2');
  assert.equal(screen.data.agentTaskBadgeText, '1 项待选');
  assert.equal(screen.data.agentTaskCollapsed, false, 'Not collapsed while 1 is still pending');

  // Pick widget 1 (voice)
  await component.methods.chooseAgentWidget.call(screen, {
    currentTarget: { dataset: { widget: 1, option: 0 } }
  });
  assert.equal(screen.data.agentWidgets[1].selectedId, 'vo_1');
  assert.equal(screen.data.agentWidgets[1].answered, true);
  assert.equal(screen.data.agentWidgets[1].selectedTitle, '我的克隆音色');
  assert.equal(screen.data.agentTaskPendingCount, 0, '0 items pending after picking both');
  assert.equal(screen.data.agentTaskBadgeText, '已选齐');
  assert.equal(screen.data.agentTaskCollapsed, true, 'Auto-collapses task card when all choices are answered');

  api.request = savedReq;
});

test('Task card: collapse toggle and dismiss work even during agentThinking', () => {
  const screen = {
    alive: true,
    data: {
      agentThinking: true, // Agent is thinking / generating
      busy: false,
      agentTaskId: '7681',
      agentTaskCollapsed: false,
      agentTaskDismissed: false
    },
    setData
  };

  // Toggling collapse should NOT be blocked during thinking
  component.methods.toggleAgentTaskCollapse.call(screen);
  assert.equal(screen.data.agentTaskCollapsed, true, 'Successfully toggles collapse during thinking');

  component.methods.toggleAgentTaskCollapse.call(screen);
  assert.equal(screen.data.agentTaskCollapsed, false, 'Successfully expands during thinking');

  // Dismissing task bar should NOT be blocked during thinking
  component.methods.dismissAgentTaskBar.call(screen);
  assert.equal(screen.data.agentTaskDismissed, true, 'Successfully dismisses task card during thinking');
});

test('Queue actions: jump, edit, cancel and save queue items', async () => {
  let requested = null;
  const savedReq = api.request;
  api.request = async (path, method, body) => {
    requested = { path, method, body };
    return { ok: true };
  };

  const screen = {
    alive: true,
    data: {
      agentSessionId: 'sid-queue-1',
      promptInput: '',
      agentHasText: false,
      agentEditQueueSeq: '',
      agentQueue: [
        { seq: '101', message: 'First message', status: 'queued', domId: 'd1' },
        { seq: '102', message: 'Second message', status: 'queued', domId: 'd2' },
        { seq: '103', message: 'Third message', status: 'queued', domId: 'd3' }
      ],
      agentMessages: []
    },
    setData,
    run: fn => fn(),
    toast: () => {}
  };

  // Jump seq 103 to top
  await component.methods.jumpQueueItem.call(screen, {
    currentTarget: { dataset: { seq: '103' } }
  });
  assert.equal(requested.path, '/workbench/ip12/api/v4/queue/sid-queue-1/jump');
  assert.equal(screen.data.agentQueue[0].seq, '103', 'Seq 103 jumped to the top of queue');

  // Start editing seq 102
  component.methods.editQueueItem.call(screen, {
    currentTarget: { dataset: { seq: '102' } }
  });
  assert.equal(screen.data.agentEditQueueSeq, '102');
  assert.equal(screen.data.promptInput, 'Second message');
  assert.equal(screen.data.agentHasText, true);

  // Cancel edit
  component.methods.cancelQueueEdit.call(screen);
  assert.equal(screen.data.agentEditQueueSeq, '');
  assert.equal(screen.data.promptInput, '');

  // Edit and Save
  component.methods.editQueueItem.call(screen, {
    currentTarget: { dataset: { seq: '102' } }
  });
  screen.data.promptInput = 'Updated message 102';
  screen.agentDraft = 'Updated message 102';
  await component.methods.saveQueueEdit.call(screen);
  assert.equal(requested.path, '/workbench/ip12/api/v4/queue/sid-queue-1/edit');
  assert.equal(requested.body.message, 'Updated message 102');
  assert.equal(screen.data.agentQueue.find(x => x.seq === '102').message, 'Updated message 102');
  assert.equal(screen.data.agentEditQueueSeq, '');

  api.request = savedReq;
});
