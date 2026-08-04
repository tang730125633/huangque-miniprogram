const api = require('../../utils/api.js');
const planetService = require('../../services/invite-planet.js');

const VIEWPORT_WIDTH = 680;
const VIEWPORT_HEIGHT = 820;
const MIN_GRAPH_SCALE = 0.12;
const NODES_PER_RING = 10;
const FIRST_RING_RADIUS = 320;
const RING_GAP = 200;
const IDENTITY_NAMES = { initiator: '发起人', partner: '合伙人', experience: '体验官', nonmember: '非会员' };
const PERSON_ACTIONS = ['查看名片', '查看他的关系'];

function numberValue(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number(fallback || 0);
}

function graphScaleAfterWheel(current, delta) {
  const scale = numberValue(current, 0.5);
  const wheelDelta = numberValue(delta, 0);
  if (!wheelDelta) return Number(scale.toFixed(2));
  return Number(Math.min(2.4, Math.max(MIN_GRAPH_SCALE, scale + (wheelDelta < 0 ? 0.14 : -0.14))).toFixed(2));
}

function focusViewMode(event) {
  return event && event.currentTarget && event.currentTarget.dataset.mode === 'list' ? 'list' : 'graph';
}

function membershipIdentity(node) {
  node = node || {};
  const status = node.membership_status;
  const inactive = node.membership_active === false || status === 'none' || status === 'expired' || status === 'inactive';
  if (inactive) return { key: 'nonmember', name: IDENTITY_NAMES.nonmember };
  if (node.identity_class && IDENTITY_NAMES[node.identity_class]) {
    return { key: node.identity_class, name: node.identity_name || IDENTITY_NAMES[node.identity_class] };
  }
  const nameMap = { 发起人: 'initiator', 合伙人: 'partner', 体验官: 'experience', 非会员: 'nonmember' };
  const tier = node.membership_tier || node.member_tier || nameMap[node.membership_name] || 'nonmember';
  const validTier = ['initiator', 'partner', 'experience'].indexOf(tier) >= 0;
  const key = validTier && !inactive ? tier : 'nonmember';
  return { key, name: IDENTITY_NAMES[key] };
}

function canExploreNetwork(node) {
  return membershipIdentity(node).key !== 'nonmember';
}

function viewerProfile(user, card) {
  user = user || {};
  card = card || {};
  return Object.assign({}, user, {
    name: user.name || user.display_name || card.name || '我',
    title: user.title || user.occupation || card.title || '',
    avatar: user.avatar || user.avatar_url || card.avatar || card.avatar_url || '',
    public_id: user.public_id || card.public_id || '',
    is_viewer: true
  });
}

function showExplorePermission() {
  const options = {
    title: '权限不够',
    content: '需要体验官及以上权限',
    showCancel: false,
    confirmText: '知道了',
    confirmColor: '#c5a75b'
  };
  if (typeof wx !== 'undefined' && typeof wx.showModal === 'function') {
    wx.showModal(options);
    return options;
  }
  if (typeof wx !== 'undefined' && typeof wx.showToast === 'function') {
    wx.showToast({ title: '需要体验官及以上权限', icon: 'none' });
  }
  return options;
}

function nodeView(node, depth, parentId) {
  node = node || {};
  const rawName = String(node.name || node.display_name || node.card_name || '').trim();
  const name = Object.keys(IDENTITY_NAMES).some((key) => IDENTITY_NAMES[key] === rawName) ? '黄雀用户' : (rawName || '黄雀用户');
  const identity = membershipIdentity(node);
  return {
    node_id: node.node_id || node.id || node.user_id || node.public_id,
    public_id: node.public_id || '',
    is_viewer: node.is_viewer === true,
    name,
    title: node.title || node.occupation || '',
    avatar: node.avatar || node.avatar_url || '',
    membership_tier: node.membership_tier || node.member_tier || '',
    membership_status: node.membership_status || '',
    membership_active: node.membership_active,
    identity_class: identity.key,
    identity_name: identity.name,
    avatar_label: String(name),
    name_size: Array.from(String(name)).length > 8 ? 'tiny' : (Array.from(String(name)).length > 4 ? 'small' : 'normal'),
    node_grant: node.node_grant || node.node_token || '',
    depth: numberValue(depth, 0),
    indent: numberValue(depth, 0) * 36,
    branchIndent: numberValue(depth, 0) * 36 + 92,
    parent_id: parentId || '',
    has_children: node.has_children !== false && numberValue(node.children_count, 1) !== 0,
    children_count: numberValue(node.children_count, 0),
    cursor: node.next_before_id || node.next_cursor || '',
    expanded: false,
    loading: false
  };
}

function branchEnd(nodes, index) {
  const depth = nodes[index].depth;
  let end = index + 1;
  while (end < nodes.length && nodes[end].depth > depth) end += 1;
  return end;
}

function appendBranch(nodes, index, rawItems, nextCursor) {
  const list = nodes.slice();
  const parent = Object.assign({}, list[index]);
  const children = (rawItems || []).map((item) => nodeView(item, parent.depth + 1, parent.node_id));
  const insertAt = branchEnd(list, index);
  list[index] = Object.assign(parent, {
    expanded: true,
    loading: false,
    cursor: nextCursor || '',
    has_children: !!(children.length || nextCursor)
  });
  list.splice.apply(list, [insertAt, 0].concat(children));
  return list;
}

function lineBetween(from, to, id) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const width = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  return {
    id,
    left: Math.round(from.x),
    top: Math.round(from.y),
    width: Math.round(width),
    angle: Math.round(angle),
    active: false
  };
}

function buildOrbitGraph(ancestors, descendants, centerNode) {
  const center = centerNode || { name: '我', avatar_label: '我', public_id: '' };
  const directAncestor = (ancestors || [])[0];
  const neighbors = [];
  if (directAncestor) neighbors.push({ node: directAncestor, role: 'ancestor' });
  (descendants || []).forEach((node) => neighbors.push({ node, role: 'descendant' }));
  const ringCount = Math.max(1, Math.ceil(neighbors.length / NODES_PER_RING));
  const outerRadius = FIRST_RING_RADIUS + (ringCount - 1) * RING_GAP;
  const graphWidth = Math.max(1100, (outerRadius + 180) * 2);
  const graphHeight = graphWidth;
  const centerX = Math.round(graphWidth / 2);
  const centerY = Math.round(graphHeight / 2);
  const CENTER = { x: centerX, y: centerY };
  const graphNodes = [{
    node_id: 'self', source_node_id: center.node_id || 'self', node_grant: center.node_grant || '', name: center.name || '我', avatar_label: center.avatar_label || center.name || '我', name_size: center.name_size || 'normal',
    avatar: center.avatar || '', public_id: center.public_id || '', title: center.title || '', is_viewer: center.is_viewer === true,
    identity_class: membershipIdentity(center).key, identity_name: membershipIdentity(center).name, role: 'self', relation_label: '当前中心', layer: 0,
    x: CENTER.x, y: CENTER.y, left: CENTER.x - 66, top: CENTER.y - 66, size: 132
  }];
  const graphLinks = [];
  const orbitRings = [];
  let offset = 0;
  for (let ringIndex = 0; ringIndex < ringCount; ringIndex += 1) {
    const count = Math.min(NODES_PER_RING, neighbors.length - offset);
    if (count <= 0) break;
    const radius = FIRST_RING_RADIUS + ringIndex * RING_GAP;
    const step = 360 / count;
    orbitRings.push({ id: 'ring-' + ringIndex, left: centerX - radius, top: centerY - radius, size: radius * 2 });
    for (let index = 0; index < count; index += 1) {
      const entry = neighbors[offset + index];
      const angle = -90 + index * step + (ringIndex % 2 ? step / 2 : 0);
      const radians = angle * Math.PI / 180;
      const x = Math.round(centerX + Math.cos(radians) * radius);
      const y = Math.round(centerY + Math.sin(radians) * radius);
      const size = entry.role === 'ancestor' ? 102 : (ringIndex === 0 ? 92 : Math.max(72, 84 - ringIndex * 3));
      const node = Object.assign({}, entry.node, {
        role: entry.role, layer: ringIndex + 1,
        relation_label: entry.role === 'ancestor' ? '直接上线' : '直接下线',
        x, y, left: x - size / 2, top: y - size / 2, size
      });
      graphNodes.push(node);
      const graphLink = lineBetween(
        CENTER,
        { x, y },
        entry.role === 'ancestor' ? node.node_id + '>self' : 'self>' + node.node_id
      );
      graphLink.flow_delay = (ringIndex * 0.16).toFixed(2);
      graphLinks.push(graphLink);
    }
    offset += count;
  }
  return { graphNodes, graphLinks, orbitRings, graphWidth, graphHeight, centerX, centerY };
}

function fitView(graph, centerOnly) {
  const scale = centerOnly
    ? 0.9
    : Math.max(MIN_GRAPH_SCALE, Math.min(0.9, (VIEWPORT_WIDTH - 40) / graph.graphWidth, (VIEWPORT_HEIGHT - 40) / graph.graphHeight));
  return {
    graphScale: Number(scale.toFixed(2)),
    graphX: Math.round(VIEWPORT_WIDTH / 2 - graph.centerX * scale),
    graphY: Math.round((centerOnly ? VIEWPORT_HEIGHT * 0.42 : VIEWPORT_HEIGHT / 2) - graph.centerY * scale)
  };
}

function pathToNode(descendants, nodeId, centerName) {
  const map = {};
  (descendants || []).forEach((node) => { map[node.node_id] = node; });
  const path = [];
  let current = map[nodeId];
  const visited = {};
  while (current && !visited[current.node_id]) {
    visited[current.node_id] = true;
    path.unshift(current.name);
    current = current.parent_id === 'self' ? null : map[current.parent_id];
  }
  return [centerName || '我'].concat(path);
}

function focusAncestors(descendants, nodeId, rootAncestors) {
  const map = {};
  (descendants || []).forEach((node) => { map[node.node_id] = node; });
  const result = [];
  const selected = map[nodeId];
  let cursor = selected && selected.parent_id;
  const visited = {};
  while (cursor && cursor !== 'self' && map[cursor] && !visited[cursor]) {
    visited[cursor] = true;
    result.push(Object.assign({}, map[cursor]));
    cursor = map[cursor].parent_id;
  }
  result.push(nodeView({ node_id: 'viewer-self', name: '我', title: '我的邀请星球', is_viewer: true }));
  (rootAncestors || []).forEach((node, index) => {
    result.push(Object.assign({}, node, { node_id: 'root-up-' + index + '-' + node.node_id }));
  });
  return result;
}

function dashboardStats(data, children) {
  const source = (data && (data.stats || data.dashboard)) || data || {};
  const pick = (keys, fallback) => {
    for (let index = 0; index < keys.length; index += 1) {
      if (source[keys[index]] !== undefined && source[keys[index]] !== null) return source[keys[index]];
    }
    return fallback;
  };
  const direct = numberValue(pick(['valid_invites', 'direct_invites', 'direct_count'], children.length), children.length);
  const indirect = numberValue(pick(['indirect_invites', 'indirect_count'], 0), 0);
  return { direct, indirect, total: direct + indirect };
}

function cardDestination(node) {
  node = node || {};
  if (node.is_viewer === true) return { method: 'switchTab', url: '/pages/my-card/my-card' };
  const publicId = String(node.public_id || '').trim();
  if (!publicId) return null;
  return { method: 'navigateTo', url: '/pages/card/card?id=' + encodeURIComponent(publicId) };
}

Page({
  data: {
    loading: true, error: '', viewMode: 'graph', ancestors: [], children: [], childCursor: '', loadingChildren: false,
    stats: { direct: 0, indirect: 0, total: 0 }, graphNodes: [], graphLinks: [], orbitRings: [], selectedNode: null, selectedPath: '',
    focusUser: null, focusLoading: false, displayChildren: [], focusFixtures: {}, graphLoadingAll: false, graphTruncated: false, graphInteracting: false,
    viewerNode: {}, viewerCanExplore: false, viewerIdentityName: '非会员',
    graphWidth: 1100, graphHeight: 1280, graphCenterX: 550, graphCenterY: 460, graphScale: 0.5, graphX: 0, graphY: 0
  },
  onLoad(options) {
    if (!api.getToken()) { wx.reLaunch({ url: '/pages/login/login' }); return; }
    const grant = String((options && options.grant) || '').trim();
    return this.load(grant);
  },
  load(grant) {
    grant = String(grant || '').trim();
    const request = { limit: 50 };
    if (grant) request.grant = grant;
    this.setData({ loading: true, error: '' });
    return planetService.getPlanet(request).then((planet) => {
      const ancestors = planet.upline ? [nodeView(planet.upline)] : [];
      const children = planet.downlines.map((item) => nodeView(item, 0, 'self'));
      const center = grant
        ? nodeView(Object.assign({}, planet.center, { is_viewer: false }), 0, '')
        : nodeView(viewerProfile(planet.center), 0, '');
      const viewerTier = planet.viewer.membership_tier || '';
      const viewerIdentity = grant
        ? membershipIdentity({ membership_tier: viewerTier, membership_status: viewerTier ? 'active' : 'none', membership_active: !!viewerTier })
        : membershipIdentity(center);
      const graph = buildOrbitGraph(ancestors.slice(0, 1), children, center);
      const view = fitView(graph, false);
      this._centerGrant = grant;
      if (!grant) {
        this._rootState = {
          ancestors: ancestors.map((node) => Object.assign({}, node)),
          children: children.map((node) => Object.assign({}, node)), viewerNode: Object.assign({}, center),
          stats: Object.assign({}, planet.stats), childCursor: planet.page.next_cursor || ''
        };
      }
      this.setData({
        loading: false, ancestors, children, viewerNode: grant ? this.data.viewerNode : center,
        viewerCanExplore: !!planet.viewer.can_explore_others, viewerIdentityName: viewerIdentity.name,
        graphNodes: graph.graphNodes, graphLinks: graph.graphLinks, orbitRings: graph.orbitRings,
        stats: planet.stats, displayChildren: children, focusUser: grant ? center : null,
        graphWidth: graph.graphWidth, graphHeight: graph.graphHeight, graphCenterX: graph.centerX, graphCenterY: graph.centerY,
        graphScale: view.graphScale, graphX: view.graphX, graphY: view.graphY,
        childCursor: planet.page.next_cursor || ''
      });
    }).catch((error) => this.setData({ loading: false, error: error.message || '邀请关系读取失败' }));
  },
  toggleView(e) {
    this.setData({ viewMode: e.currentTarget.dataset.mode === 'list' ? 'list' : 'graph', selectedNode: null, selectedPath: '' });
  },
  zoomIn() {
    this.setData({ graphScale: Math.min(2.4, Number((this.data.graphScale + 0.18).toFixed(2))) });
  },
  zoomOut() {
    this.setData({ graphScale: Math.max(MIN_GRAPH_SCALE, Number((this.data.graphScale - 0.18).toFixed(2))) });
  },
  beginGraphInteraction() {
    if (!this.data.graphInteracting) this.setData({ graphInteracting: true });
  },
  endGraphInteraction() {
    const transform = this._pendingGraphTransform || {};
    this._pendingGraphTransform = null;
    if (this.data.graphInteracting || Object.keys(transform).length) {
      this.setData(Object.assign({}, transform, { graphInteracting: false }));
    }
  },
  onGraphMove(e) {
    const detail = (e && e.detail) || {};
    const x = Number(detail.x);
    const y = Number(detail.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this._pendingGraphTransform = Object.assign({}, this._pendingGraphTransform, {
      graphX: Math.round(x),
      graphY: Math.round(y)
    });
    if (!this.data.graphInteracting) this.setData({ graphInteracting: true });
  },
  onGraphScale(e) {
    const detail = (e && e.detail) || {};
    const scale = Number(detail.scale);
    if (!Number.isFinite(scale)) return;
    const transform = { graphScale: Number(Math.min(2.4, Math.max(MIN_GRAPH_SCALE, scale)).toFixed(2)) };
    if (Number.isFinite(Number(detail.x))) transform.graphX = Math.round(Number(detail.x));
    if (Number.isFinite(Number(detail.y))) transform.graphY = Math.round(Number(detail.y));
    this._pendingGraphTransform = Object.assign({}, this._pendingGraphTransform, transform);
    if (!this.data.graphInteracting) this.setData({ graphInteracting: true });
  },
  onGraphWheel(e) {
    const detail = (e && e.detail) || {};
    const delta = detail.deltaY !== undefined ? detail.deltaY : (e && e.deltaY);
    const graphScale = graphScaleAfterWheel(this.data.graphScale, delta);
    if (graphScale === this.data.graphScale) return;
    this.setData({ graphScale, graphInteracting: true });
    clearTimeout(this._graphWheelTimer);
    this._graphWheelTimer = setTimeout(() => {
      this._graphWheelTimer = null;
      if (this.data.graphInteracting) this.setData({ graphInteracting: false });
    }, 120);
  },
  centerOnMe() {
    const graph = { graphWidth: this.data.graphWidth, graphHeight: this.data.graphHeight, centerX: this.data.graphCenterX, centerY: this.data.graphCenterY };
    this.setData(fitView(graph, true));
  },
  fitAll() {
    const graph = { graphWidth: this.data.graphWidth, graphHeight: this.data.graphHeight, centerX: this.data.graphCenterX, centerY: this.data.graphCenterY };
    this.setData(fitView(graph, false));
  },
  selectNode(e) {
    const id = e.currentTarget.dataset.node;
    const selectedNode = this.data.graphNodes.find((node) => node.node_id === id);
    if (!selectedNode) { this.setData({ selectedNode: null, selectedPath: '' }); return; }
    let selectedPath = '';
    const centerName = this.data.focusUser ? this.data.focusUser.name : '我';
    if (selectedNode.role === 'self') selectedPath = selectedNode.name + ' · 当前星球中心';
    else if (selectedNode.role === 'ancestor') selectedPath = selectedNode.name + ' → ' + centerName;
    else selectedPath = pathToNode(this.data.displayChildren, id, centerName).join(' → ');
    const activeIds = {};
    const path = selectedNode.role === 'descendant' ? pathToNode(this.data.children, id) : [];
    if (path.length) {
      let cursor = id;
      const map = {};
      this.data.displayChildren.forEach((node) => { map[node.node_id] = node; });
      while (cursor && cursor !== 'self') {
        const node = map[cursor];
        if (!node) break;
        activeIds[(node.parent_id || 'self') + '>' + cursor] = true;
        cursor = node.parent_id;
      }
    }
    this.setData({
      selectedNode, selectedPath,
      graphLinks: this.data.graphLinks.map((link) => Object.assign({}, link, { active: !!activeIds[link.id] }))
    });
  },
  closeSelection() {
    this.setData({ selectedNode: null, selectedPath: '', graphLinks: this.data.graphLinks.map((link) => Object.assign({}, link, { active: false })) });
  },
  openSelectedCard() {
    return this.openNodeCard(this.data.selectedNode);
  },
  openNodeCard(node) {
    const destination = cardDestination(node);
    if (!destination) {
      wx.showToast({ title: '对方暂未公开名片', icon: 'none' });
      return null;
    }
    if (destination.method === 'switchTab') wx.switchTab({ url: destination.url });
    else wx.navigateTo({ url: destination.url });
    return destination;
  },
  focusNode(e) {
    const eventId = e && e.currentTarget && e.currentTarget.dataset.node;
    const targetMode = focusViewMode(e);
    const selected = eventId
      ? this.data.graphNodes.find((node) => node.node_id === eventId)
      : this.data.selectedNode;
    if (!selected || selected.role === 'self' || this.data.focusLoading) return;
    if (!this.data.viewerCanExplore) {
      showExplorePermission();
      return;
    }
    const grant = selected.node_grant || '';
    if (!grant) {
      wx.showToast({ title: '查看凭证已失效，请重新进入星球', icon: 'none' });
      return;
    }
    this.setData({ focusLoading: true });
    return planetService.getPlanet({ grant, limit: 50 }).then((planet) => {
      const ancestors = planet.upline ? [nodeView(planet.upline)] : [];
      const children = planet.downlines.map((item) => nodeView(item, 0, 'self'));
      const center = nodeView(Object.assign({}, planet.center, { is_viewer: false }), 0, '');
      const graph = buildOrbitGraph(ancestors.slice(0, 1), children, center);
      const view = fitView(graph, false);
      this._centerGrant = grant;
      this.setData({
        focusUser: center, focusLoading: false, selectedNode: null, selectedPath: '', viewMode: targetMode, ancestors, children,
        displayChildren: children, graphNodes: graph.graphNodes, graphLinks: graph.graphLinks, orbitRings: graph.orbitRings,
        graphWidth: graph.graphWidth, graphHeight: graph.graphHeight, graphCenterX: graph.centerX, graphCenterY: graph.centerY,
        graphScale: view.graphScale, graphX: view.graphX, graphY: view.graphY,
        stats: planet.stats, childCursor: planet.page.next_cursor || ''
      });
    }).catch((error) => {
      this.setData({ focusLoading: false });
      wx.showToast({ title: error.message || '该用户的邀请关系读取失败', icon: 'none' });
    });
  },
  resetFocus() {
    if (!this._rootState) { this.load(); return; }
    this._centerGrant = '';
    const ancestors = this._rootState.ancestors.map((node) => Object.assign({}, node));
    const children = this._rootState.children.map((node) => Object.assign({}, node));
    const viewerNode = Object.assign({}, this._rootState.viewerNode || this.data.viewerNode);
    const graph = buildOrbitGraph(ancestors.slice(0, 1), children, viewerNode);
    const view = fitView(graph, false);
    this.setData({
      focusUser: null, focusLoading: false, selectedNode: null, selectedPath: '', viewerNode, ancestors, children, displayChildren: children, graphNodes: graph.graphNodes, graphLinks: graph.graphLinks, orbitRings: graph.orbitRings,
      graphWidth: graph.graphWidth, graphHeight: graph.graphHeight, graphCenterX: graph.centerX, graphCenterY: graph.centerY,
      graphScale: view.graphScale, graphX: view.graphX, graphY: view.graphY,
      stats: Object.assign({}, this._rootState.stats), childCursor: this._rootState.childCursor || ''
    });
  },
  openCard(e) {
    const id = e.currentTarget.dataset.id;
    return this.openNodeCard({ public_id: id || '', is_viewer: false });
  },
  openPersonOptions(e) {
    const nodeId = e && e.currentTarget && e.currentTarget.dataset.node;
    const candidates = (this.data.graphNodes || []).concat(this.data.ancestors || [], this.data.children || []);
    const node = candidates.find((item) => item.node_id === nodeId);
    const isAncestor = (this.data.ancestors || []).some((item) => item.node_id === nodeId);
    if (!node) return;
    wx.showActionSheet({
      itemList: PERSON_ACTIONS,
      success: (result) => {
        if (result.tapIndex === 0) {
          this.openNodeCard(node);
          return;
        }
        if (result.tapIndex !== 1) return;
        if (!this.data.viewerCanExplore) {
          showExplorePermission();
          return;
        }
        this.setData({ selectedNode: Object.assign({}, node, {
          role: node.role || (isAncestor ? 'ancestor' : 'descendant')
        }) });
        this.focusNode({ currentTarget: { dataset: { mode: 'list' } } });
      }
    });
  },
  rebuildGraph(children) {
    const displayChildren = children.filter((node) => numberValue(node.depth, 0) === 0);
    const graph = buildOrbitGraph(this.data.ancestors.slice(0, 1), displayChildren, this.data.focusUser || this.data.viewerNode || undefined);
    const view = fitView(graph, false);
    this.setData({
      children, displayChildren, graphNodes: graph.graphNodes, graphLinks: graph.graphLinks, orbitRings: graph.orbitRings, selectedNode: null, selectedPath: '',
      graphWidth: graph.graphWidth, graphHeight: graph.graphHeight, graphCenterX: graph.centerX, graphCenterY: graph.centerY,
      graphScale: view.graphScale, graphX: view.graphX, graphY: view.graphY
    });
  },
  loadCompleteGraph() {
    wx.showToast({ title: '当前星球只展示相邻一级', icon: 'none' });
    return Promise.resolve();
  },
  loadMore() {
    if (!this.data.childCursor || this.data.loadingChildren) return;
    this.setData({ loadingChildren: true });
    const request = { cursor: this.data.childCursor, limit: 50 };
    if (this._centerGrant) request.grant = this._centerGrant;
    planetService.getPlanet(request)
      .then((planet) => {
        const children = this.data.children.concat(planet.downlines.map((item) => nodeView(item, 0, 'self')));
        this.setData({ childCursor: planet.page.next_cursor || '', loadingChildren: false });
        this.rebuildGraph(children);
      }).catch((error) => this.setData({ loadingChildren: false, error: error.message || '加载失败' }));
  },
  loadBranch(e) {
    if (!this.data.viewerCanExplore) {
      showExplorePermission();
      return;
    }
    const index = Number(e.currentTarget.dataset.index);
    const node = this.data.children[index];
    if (!node || !node.node_id) return;
    this.setData({ selectedNode: Object.assign({}, node, { role: 'descendant' }) });
    return this.focusNode();
  }
});

if (typeof module !== 'undefined') module.exports = {
  PERSON_ACTIONS, membershipIdentity, canExploreNetwork, viewerProfile, showExplorePermission, graphScaleAfterWheel, focusViewMode, nodeView, branchEnd, appendBranch, buildOrbitGraph, fitView, pathToNode, focusAncestors, dashboardStats, cardDestination, lineBetween
};
