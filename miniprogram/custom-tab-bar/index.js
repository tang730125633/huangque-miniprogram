const OUTER_ITEMS = [
  { pagePath: '/pages/my-card/my-card', text: '我的名片', symbol: '▣' },
  { pagePath: '/pages/home/home', text: '黄雀AI工作台', symbol: '⌂' }
];

const WORKBENCH_ITEMS = [
  { pagePath: '/pages/home/home', text: '首页', symbol: '⌂' },
  { pagePath: '/pages/inspiration/inspiration', text: '一键跟创', symbol: '✦' },
  { pagePath: '/pages/assets/assets', text: '历史作品', symbol: '◷' },
  { pagePath: '/pages/profile/profile', text: '我的', symbol: '○' }
];

const LOGIN_REQUIRED = {
  '/pages/assets/assets': true,
  '/pages/profile/profile': true
};

function navigationForRoute(route) {
  return route === 'pages/my-card/my-card' ? OUTER_ITEMS : WORKBENCH_ITEMS;
}

if (typeof Component === 'function') Component({
  data: {
    selected: '/pages/my-card/my-card',
    items: OUTER_ITEMS,
    switching: false
  },

  lifetimes: {
    attached() { this.syncNavigation(); }
  },

  pageLifetimes: {
    show() { this.syncNavigation(); }
  },

  methods: {
    syncNavigation() {
      const pages = getCurrentPages();
      const route = pages.length ? pages[pages.length - 1].route : 'pages/my-card/my-card';
      this.setData({ selected: '/' + route, items: navigationForRoute(route) });
    },

    switchTab(e) {
      const url = e.currentTarget.dataset.path;
      if (!url || url === this.data.selected || this.data.switching) return;
      this.setData({ switching: true });
      const done = () => this.setData({ switching: false });
      if (LOGIN_REQUIRED[url] && !wx.getStorageSync('hq_token')) {
        wx.navigateTo({ url: '/pages/login/login', complete: done });
        return;
      }
      wx.switchTab({ url, complete: done });
    }
  }
});

if (typeof module !== 'undefined') module.exports = { OUTER_ITEMS, WORKBENCH_ITEMS, LOGIN_REQUIRED, navigationForRoute };
