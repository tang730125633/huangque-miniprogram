const api = require('../../utils/api.js');

function nodeView(node) {
  node = node || {};
  return { public_id: node.public_id || node.id, name: node.name || '黄雀用户', title: node.title || '', avatar: node.avatar || '', initial: String(node.name || '黄').slice(0, 1), children: [], expanded: false };
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
      this.setData({ loading: false, ancestors: (ancestors.items || ancestors.ancestors || []).map(nodeView), children: (children.items || children.children || []).map(nodeView), childCursor: children.next_before_id || '' });
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
        this.setData({ children: this.data.children.concat((data.items || data.children || []).map(nodeView)), childCursor: data.next_before_id || '', loadingChildren: false });
      }).catch((error) => this.setData({ loadingChildren: false, error: error.message || '加载失败' }));
  },
  loadBranch(e) {
    const index = Number(e.currentTarget.dataset.index);
    const node = this.data.children[index];
    if (!node || node.expanded || !node.public_id) return;
    api.request('/api/auth/network/children?parent=' + encodeURIComponent(node.public_id) + '&limit=12', { method: 'GET' }).then((res) => {
      const data = res.data || {};
      if (res.statusCode !== 200) throw new Error(data.detail || '下级加载失败');
      this.setData({ ['children[' + index + '].children']: (data.items || data.children || []).map(nodeView), ['children[' + index + '].expanded']: true });
    }).catch((error) => this.setData({ error: error.message || '下级加载失败' }));
  }
});

if (typeof module !== 'undefined') module.exports = { nodeView };
