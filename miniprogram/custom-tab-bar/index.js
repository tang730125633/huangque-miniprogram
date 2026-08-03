const OUTER_ITEMS = [
  { pagePath: '/pages/my-card/my-card', text: '我的名片', iconPath: '/assets/tabbar/profile.png', selectedIconPath: '/assets/tabbar/profile_on.png' },
  { pagePath: '/pages/home/home', text: '黄雀AI工作台', iconPath: '/assets/tabbar/home.png', selectedIconPath: '/assets/tabbar/home_on.png' }
];

const WORKBENCH_ITEMS = [
  { pagePath: '/pages/home/home', text: '首页', iconPath: '/assets/tabbar/home.png', selectedIconPath: '/assets/tabbar/home_on.png' },
  { pagePath: '/pages/inspiration/inspiration', text: '一键跟创', iconPath: '/assets/tabbar/idea.png', selectedIconPath: '/assets/tabbar/idea_on.png' },
  { pagePath: '/pages/assets/assets', text: '历史作品', iconPath: '/assets/tabbar/history.png', selectedIconPath: '/assets/tabbar/history_on.png' },
  { pagePath: '/pages/profile/profile', text: '我的', iconPath: '/assets/tabbar/profile.png', selectedIconPath: '/assets/tabbar/profile_on.png' }
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
    items: OUTER_ITEMS
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
      if (!url || url === this.data.selected) return;
      if (LOGIN_REQUIRED[url] && !wx.getStorageSync('hq_token')) {
        wx.navigateTo({ url: '/pages/login/login' });
        return;
      }
      wx.switchTab({ url });
    }
  }
});

if (typeof module !== 'undefined') module.exports = { OUTER_ITEMS, WORKBENCH_ITEMS, LOGIN_REQUIRED, navigationForRoute };
