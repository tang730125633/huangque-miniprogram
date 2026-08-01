const api = require('../../utils/api.js');

function nodeView(node, depth, parentId) {
  node = node || {};
  return {
    node_id: node.node_id || node.id || node.public_id,
    public_id: node.public_id || '',
    name: node.name || '黄雀用户', title: node.title || '', avatar: node.avatar || '', initial: String(node.name || '黄').slice(0, 1),
    depth: Number(depth || 0), indent: Number(depth || 0) * 36, branchIndent: Number(depth || 0) * 36 + 92, parent_id: parentId || '',
    has_children: node.has_children !== false && Number(node.children_count || 1) !== 0,
    children_count: Number(node.children_count || 0), cursor: node.next_before_id || node.next_cursor || '', expanded: false, loading: false
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
  list[index] = Object.assign(parent, { expanded: true, loading: false, cursor: nextCursor || '', has_children: !!(children.length || nextCursor) });
  list.splice.apply(list, [insertAt, 0].concat(children));
  return list;
}

Page({
  data: { loading: true, error: '', ancestors: [], children: [], childCursor: '', loadingChildren: false },
  onLoad() {
    if (!api.getToken()) { wx.reLaunch({ url: '/pages/login/login' }); return; }
    this.load();
  },
  load() {
    this.setData({ loading: true, error: '' });
    return Promise.all([
      api.request('/api/auth/network/ancestors', { method: 'GET' }),
      api.request('/api/auth/network/children?parent=self&limit=12', { method: 'GET' })
    ]).then((responses) => {
      const ancestors = responses[0].data || {};
      const children = responses[1].data || {};
      if (responses[0].statusCode !== 200 || responses[1].statusCode !== 200) throw new Error('人脉数据暂时无法读取');
      this.setData({ loading: false, ancestors: (ancestors.items || ancestors.ancestors || []).map((item) => nodeView(item)), children: (children.items || children.children || []).map((item) => nodeView(item, 0, 'self')), childCursor: children.next_before_id || children.next_cursor || '' });
    }).catch((error) => this.setData({ loading: false, error: error.message || '人脉数据读取失败' }));
  },
  openCard(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: '/pages/card/card?id=' + encodeURIComponent(id) });
  },
  loadMore() {
    if (!this.data.childCursor || this.data.loadingChildren) return;
    this.setData({ loadingChildren: true });
    api.request('/api/auth/network/children?parent=self&before_id=' + encodeURIComponent(this.data.childCursor) + '&limit=12', { method: 'GET' })
      .then((res) => {
        const data = res.data || {};
        if (res.statusCode !== 200) throw new Error(data.detail || '加载失败');
        this.setData({ children: this.data.children.concat((data.items || data.children || []).map((item) => nodeView(item, 0, 'self'))), childCursor: data.next_before_id || data.next_cursor || '', loadingChildren: false });
      }).catch((error) => this.setData({ loadingChildren: false, error: error.message || '加载失败' }));
  },
  loadBranch(e) {
    const index = Number(e.currentTarget.dataset.index);
    const node = this.data.children[index];
    if (!node || node.loading || !node.has_children || !node.node_id) return;
    const children = this.data.children.slice();
    children[index] = Object.assign({}, node, { loading: true });
    this.setData({ children });
    const before = node.expanded && node.cursor ? '&before_id=' + encodeURIComponent(node.cursor) : '';
    api.request('/api/auth/network/children?parent=' + encodeURIComponent(node.node_id) + before + '&limit=12', { method: 'GET' }).then((res) => {
      const data = res.data || {};
      if (res.statusCode !== 200) throw new Error(data.detail || '下级加载失败');
      this.setData({ children: appendBranch(this.data.children, index, data.items || data.children || [], data.next_before_id || data.next_cursor) });
    }).catch((error) => {
      const retry = this.data.children.slice();
      retry[index] = Object.assign({}, retry[index], { loading: false });
      this.setData({ children: retry, error: error.message || '下级加载失败' });
    });
  }
});

if (typeof module !== 'undefined') module.exports = { nodeView, branchEnd, appendBranch };
