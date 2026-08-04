const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let pageDefinition;
global.Page = function (definition) { pageDefinition = definition; };

const network = require('../miniprogram/pages/network/network.js');
const planetService = require('../miniprogram/services/invite-planet.js');
const api = require('../miniprogram/utils/api.js');

test('loads the granted user as the initial planet center', async () => {
  const originalGetPlanet = planetService.getPlanet;
  const originalGetToken = api.getToken;
  let requestOptions;
  api.getToken = () => 'token';
  planetService.getPlanet = (options) => {
    requestOptions = options;
    return Promise.resolve({
      viewer: { membership_tier: 'experience', can_explore_others: true },
      center: { node_id: 'target', name: '目标用户', membership_tier: 'experience' },
      upline: null,
      downlines: [],
      stats: { direct: 0, indirect: 0, total: 0 },
      page: { next_cursor: '' }
    });
  };
  const page = {
    data: Object.assign({}, pageDefinition.data),
    setData(change) { Object.assign(this.data, change); },
    load: pageDefinition.load
  };
  try {
    await pageDefinition.onLoad.call(page, { grant: 'grant/target' });
    assert.deepEqual(requestOptions, { grant: 'grant/target', limit: 50 });
    assert.equal(page.data.focusUser.name, '目标用户');
    assert.equal(page.data.focusUser.is_viewer, false);
  } finally {
    planetService.getPlanet = originalGetPlanet;
    api.getToken = originalGetToken;
  }
});

test('maps the four membership identities and fails closed for nonmembers', () => {
  assert.deepEqual(network.membershipIdentity({ membership_tier: 'initiator', membership_status: 'active', membership_active: true }), { key: 'initiator', name: '发起人' });
  assert.deepEqual(network.membershipIdentity({ membership_tier: 'partner', membership_status: 'active', membership_active: true }), { key: 'partner', name: '合伙人' });
  assert.deepEqual(network.membershipIdentity({ membership_tier: 'experience', membership_status: 'active', membership_active: true }), { key: 'experience', name: '体验官' });
  assert.deepEqual(network.membershipIdentity({ membership_tier: 'initiator', membership_status: 'expired', membership_active: false }), { key: 'nonmember', name: '非会员' });
  assert.deepEqual(network.membershipIdentity({ identity_class: 'initiator', membership_status: 'expired', membership_active: false }), { key: 'nonmember', name: '非会员' });
  assert.equal(network.canExploreNetwork({ membership_status: 'none', membership_active: false }), false);
  assert.equal(network.canExploreNetwork({ membership_tier: 'experience', membership_status: 'active', membership_active: true }), true);
});

test('blocks nonmembers before requesting another user network', () => {
  let modal;
  global.wx = { showModal(options) { modal = options; } };
  pageDefinition.focusNode.call({
    data: { graphNodes: [{ node_id: 'other', role: 'descendant' }], selectedNode: null, viewerCanExplore: false, focusLoading: false }
  }, { currentTarget: { dataset: { node: 'other' } } });
  assert.equal(modal.title, '权限不够');
  assert.equal(modal.content, '需要体验官及以上权限');
  assert.equal(modal.showCancel, false);
});

test('blocks nonmembers from expanding another user in relationship-list mode', () => {
  let modal;
  global.wx = { showModal(options) { modal = options; } };
  pageDefinition.loadBranch.call({
    data: { viewerCanExplore: false, children: [{ node_id: 'other', has_children: true }] }
  }, { currentTarget: { dataset: { index: 0 } } });
  assert.equal(modal.title, '权限不够');
  assert.match(modal.content, /体验官及以上/);
});

test('uses the customer card avatar when the login profile has no avatar', () => {
  assert.deepEqual(
    network.viewerProfile(
      { username: '微信用户', membership_tier: 'experience' },
      { name: '客户名片', avatar: 'https://example.test/customer-avatar.jpg', public_id: 'card-1' }
    ),
    {
      username: '微信用户',
      membership_tier: 'experience',
      name: '客户名片',
      title: '',
      avatar: 'https://example.test/customer-avatar.jpg',
      public_id: 'card-1',
      is_viewer: true
    }
  );
  assert.equal(network.viewerProfile({ avatar: '/login-avatar.jpg' }, { avatar: '/card-avatar.jpg' }).avatar, '/login-avatar.jpg');
});

test('normalizes invite nodes without changing the existing public-card contract', () => {
  const node = network.nodeView({ user_id: 'u-1', public_id: 'public-1', display_name: '张三', avatar_url: '/a.jpg', children_count: 2 }, 1, 'parent');
  assert.deepEqual(
    [node.node_id, node.public_id, node.name, node.avatar, node.depth, node.parent_id, node.children_count],
    ['u-1', 'public-1', '张三', '/a.jpg', 1, 'parent', 2]
  );
});

test('builds a deterministic orbit with self at the center', () => {
  const ancestors = [network.nodeView({ node_id: 'up', name: '上线' })];
  const descendants = [
    network.nodeView({ node_id: 'a', name: '一级 A', children_count: 1 }, 0, 'self'),
    network.nodeView({ node_id: 'b', name: '一级 B', children_count: 0 }, 0, 'self'),
    network.nodeView({ node_id: 'a1', name: '二级 A1', children_count: 0 }, 1, 'a')
  ];
  const first = network.buildOrbitGraph(ancestors, descendants);
  const second = network.buildOrbitGraph(ancestors, descendants);
  assert.deepEqual(first, second);
  assert.equal(first.graphNodes.length, 5);
  assert.equal(first.graphLinks.length, 4);
  assert.ok(first.graphLinks.some((link) => link.id === 'up>self'));
  assert.ok(first.graphLinks.some((link) => link.id === 'self>a'));
  assert.ok(first.graphLinks.some((link) => link.id === 'self>a1'));
  const self = first.graphNodes.find((node) => node.node_id === 'self');
  const upline = first.graphNodes.find((node) => node.node_id === 'up');
  assert.deepEqual([self.x, self.y], [first.centerX, first.centerY]);
  first.graphLinks.forEach((link) => {
    assert.deepEqual([link.left, link.top], [first.centerX, first.centerY]);
  });
  assert.equal(first.graphLinks[0].flow_delay, '0.00');
  assert.ok(upline.y < self.y);
  assert.equal(first.orbitRings.length, 1);
  first.graphNodes.filter((node) => node.node_id !== 'self').forEach((node) => {
    assert.ok(Math.abs(Math.hypot(node.x - self.x, node.y - self.y) - 320) <= 1);
  });
  first.graphNodes.forEach((node) => {
    assert.ok(node.x >= 0 && node.x <= first.graphWidth);
    assert.ok(node.y >= 0 && node.y <= first.graphHeight);
  });
});

test('fits the complete plane into the viewport and can return to self', () => {
  const graph = network.buildOrbitGraph([], [
    network.nodeView({ node_id: 'a' }, 0, 'self'),
    network.nodeView({ node_id: 'b' }, 0, 'self'),
    network.nodeView({ node_id: 'c' }, 1, 'a')
  ]);
  const all = network.fitView(graph, false);
  const self = network.fitView(graph, true);
  assert.ok(all.graphScale >= 0.12 && all.graphScale <= 0.9);
  assert.equal(self.graphScale, 0.9);
  assert.notDeepEqual([all.graphX, all.graphY], [self.graphX, self.graphY]);
});

test('allows the current center to open its own action sheet', () => {
  const center = { node_id: 'self', role: 'self', name: '我', relation_label: '当前中心', public_id: 'mine' };
  const page = {
    data: { graphNodes: [center], focusUser: null, displayChildren: [], children: [], graphLinks: [] },
    setData(change) { Object.assign(this.data, change); }
  };
  pageDefinition.selectNode.call(page, { currentTarget: { dataset: { node: 'self' } } });
  assert.equal(page.data.selectedNode, center);
  assert.equal(page.data.selectedPath, '我 · 当前星球中心');
});

test('uses a lightweight render mode only while the graph is moving', () => {
  const changes = [];
  const page = {
    data: { graphInteracting: false },
    setData(change) { changes.push(change); Object.assign(this.data, change); }
  };
  pageDefinition.beginGraphInteraction.call(page);
  pageDefinition.beginGraphInteraction.call(page);
  pageDefinition.endGraphInteraction.call(page);
  pageDefinition.endGraphInteraction.call(page);
  assert.deepEqual(changes, [{ graphInteracting: true }, { graphInteracting: false }]);
});

test('keeps the complete customer name for avatar fallback rendering', () => {
  const node = network.nodeView({ node_id: 'u-long', name: '上海星河文化传播工作室' });
  assert.equal(node.avatar_label, '上海星河文化传播工作室');
  assert.equal(node.name_size, 'tiny');
});

test('keeps native drag, pinch and simulator wheel transforms in sync', () => {
  assert.equal(network.graphScaleAfterWheel(0.5, -120), 0.64);
  assert.equal(network.graphScaleAfterWheel(0.5, 120), 0.36);
  assert.equal(network.graphScaleAfterWheel(2.4, -120), 2.4);
  assert.equal(network.graphScaleAfterWheel(0.12, 120), 0.12);

  const page = {
    data: { graphInteracting: false, graphScale: 0.5 },
    setData(change) { Object.assign(this.data, change); }
  };
  pageDefinition.onGraphMove.call(page, { detail: { x: 24.4, y: -17.6 } });
  pageDefinition.onGraphScale.call(page, { detail: { x: 30, y: -12, scale: 0.72 } });
  pageDefinition.endGraphInteraction.call(page);
  assert.deepEqual(
    [page.data.graphX, page.data.graphY, page.data.graphScale, page.data.graphInteracting],
    [30, -12, 0.72, false]
  );
});

test('shows only the direct upline and adds rings for larger groups', () => {
  const ancestors = Array.from({ length: 6 }, (_, index) => network.nodeView({ node_id: `up-${index}` }));
  const descendants = Array.from({ length: 13 }, (_, index) => network.nodeView({ node_id: `down-${index}` }));
  const graph = network.buildOrbitGraph(ancestors, descendants);
  assert.equal(graph.graphNodes.filter((node) => node.role === 'ancestor').length, 1);
  assert.ok(graph.graphNodes.every((node) => node.role !== 'ancestor' || node.y < graph.centerY));
  assert.equal(graph.orbitRings.length, 2);
});

test('returns the visible invitation path and stops on malformed cycles', () => {
  const nodes = [
    network.nodeView({ node_id: 'a', name: '张三' }, 0, 'self'),
    network.nodeView({ node_id: 'b', name: '李四' }, 1, 'a')
  ];
  assert.deepEqual(network.pathToNode(nodes, 'b'), ['我', '张三', '李四']);
  const cyclic = [
    network.nodeView({ node_id: 'x', name: '甲' }, 0, 'y'),
    network.nodeView({ node_id: 'y', name: '乙' }, 1, 'x')
  ];
  assert.deepEqual(network.pathToNode(cyclic, 'x'), ['我', '乙', '甲']);
});

test('builds the visible upline chain when focusing a second-level downline', () => {
  const rootAncestors = [network.nodeView({ node_id: 'root-up', name: '我的上线' })];
  const nodes = [
    network.nodeView({ node_id: 'direct', name: '周一鸣' }, 0, 'self'),
    network.nodeView({ node_id: 'second', name: '苏远' }, 1, 'direct')
  ];
  const ancestors = network.focusAncestors(nodes, 'second', rootAncestors);
  assert.deepEqual(ancestors.map((node) => node.name), ['周一鸣', '我', '我的上线']);
  assert.equal(ancestors[0].node_id, 'direct');
});

test('uses invite dashboard totals and falls back to visible direct nodes', () => {
  assert.deepEqual(network.dashboardStats({ valid_invites: 4, indirect_invites: 7 }, []), { direct: 4, indirect: 7, total: 11 });
  assert.deepEqual(network.dashboardStats({ valid_invites: 0, indirect_invites: 0 }, [{}, {}]), { direct: 0, indirect: 0, total: 0 });
  assert.deepEqual(network.dashboardStats({}, [{}, {}]), { direct: 2, indirect: 0, total: 2 });
});

test('opens the launched card feature from invitation planet actions', () => {
  assert.deepEqual(network.cardDestination({ is_viewer: true }), { method: 'switchTab', url: '/pages/my-card/my-card' });
  assert.deepEqual(
    network.cardDestination({ role: 'self', is_viewer: false, public_id: 'public/苏远' }),
    { method: 'navigateTo', url: '/pages/card/card?id=public%2F%E8%8B%8F%E8%BF%9C' }
  );
  assert.equal(network.cardDestination({ is_viewer: false }), null);

  const calls = [];
  global.wx = {
    switchTab(options) { calls.push(['switchTab', options.url]); },
    navigateTo(options) { calls.push(['navigateTo', options.url]); },
    showToast(options) { calls.push(['showToast', options.title]); }
  };
  pageDefinition.openNodeCard.call({}, { is_viewer: true });
  pageDefinition.openNodeCard.call({}, { public_id: 'public-1', is_viewer: false });
  pageDefinition.openNodeCard.call({}, { is_viewer: false });
  assert.deepEqual(calls, [
    ['switchTab', '/pages/my-card/my-card'],
    ['navigateTo', '/pages/card/card?id=public-1'],
    ['showToast', '对方暂未公开名片']
  ]);

  const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/network/network.wxml'), 'utf8');
  assert.match(wxml, /class="card-button" bindtap="openSelectedCard"/);
  assert.match(wxml, /selectedNode\.is_viewer \? '查看我的名片' : '查看名片'/);
  assert.match(wxml, /权限不够，需要体验官及以上权限/);
  assert.match(wxml, /class="planet-avatar fallback name-\{\{item\.name_size\}\}">\{\{item\.name\}\}<\/view>/);
  assert.match(wxml, /wx:if="\{\{selectedNode\.role !== 'self'\}\}" class="focus-button/);
  assert.match(wxml, /class="galaxy-background" src="\/assets\/network-galaxy-v1\.jpg" mode="aspectFill"/);
  assert.match(wxml, /catchwheel="onGraphWheel"/);
  assert.match(wxml, /bindchange="onGraphMove" bindscale="onGraphScale"/);
  assert.match(wxml, /class="identity-item"><view class="identity-dot initiator"><\/view><text>发起人<\/text>/);
  assert.match(wxml, /class="identity-item"><view class="identity-dot partner"><\/view><text>合伙人<\/text>/);
  assert.match(wxml, /class="identity-item"><view class="identity-dot experience"><\/view><text>体验官<\/text>/);
  assert.match(wxml, /class="identity-item"><view class="identity-dot nonmember"><\/view><text>非会员<\/text>/);

  const wxss = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/network/network.wxss'), 'utf8');
  assert.match(wxss, /identity-dot\.initiator[\s\S]*background: #f2c45f !important/);
  assert.match(wxss, /identity-dot\.partner[\s\S]*background: #ed5eae !important/);
  assert.match(wxss, /identity-dot\.experience[\s\S]*background: #5d9cff !important/);
  assert.match(wxss, /identity-dot\.nonmember[\s\S]*background: #8791a3 !important/);
});

test('lays out 50 direct downlines without production preview fixtures', () => {
  const tiers = ['initiator', 'partner', 'experience', 'nonmember'];
  const ancestor = network.nodeView({ node_id: 'up-1', membership_tier: 'partner', membership_status: 'active', membership_active: true });
  const children = Array.from({ length: 50 }, (_, index) => {
    const tier = tiers[index % tiers.length];
    return network.nodeView({
      node_id: 'down-' + index,
      public_id: 'public-' + index,
      name: '星友' + index,
      membership_tier: tier,
      membership_status: tier === 'nonmember' ? 'none' : 'active',
      membership_active: tier !== 'nonmember'
    }, 0, 'self');
  });
  const center = network.nodeView({ node_id: 'viewer', name: '我', is_viewer: true, membership_tier: 'initiator', membership_status: 'active', membership_active: true });
  const graph = network.buildOrbitGraph([ancestor], children, center);
  assert.equal(graph.graphNodes.length, 52);
  assert.equal(graph.orbitRings.length, 6);
  assert.equal(graph.graphNodes[0].is_viewer, true);
  assert.deepEqual(new Set(graph.graphNodes.map((node) => node.identity_class)), new Set(tiers));
});
