'use strict';

const api = require('../../utils/api.js');
const API = '/workbench/ip12/api';
const MODULES = ['定位诊断', '人设塑造', '价值主张', '故事资产', '选题策划', '文案口播', '形象设计', '脚本分镜', '私域矩阵', '朋友圈运营', '销售策略', '公众号变现'];
const CONVERSATION_KEY = 'hq_hermes_ip12_conversation_id';

function moduleCards(state) {
  const current = Number(state && state.current_module || 1);
  const done = state && state.completed_modules || [];
  return MODULES.map((name, index) => ({
    id: index + 1,
    name,
    active: index + 1 === current,
    done: done.indexOf(index + 1) !== -1,
    comingSoon: index >= 6
  }));
}

function conversationView(conversation) {
  const state = conversation && conversation.coach_state || {};
  const report = state.foundation_report || {};
  return {
    conversation,
    conversationId: conversation && conversation.id || '',
    messages: conversation && conversation.messages || [],
    currentModule: Number(state.current_module || 1),
    currentModuleName: MODULES[Number(state.current_module || 1) - 1] || '定位诊断',
    completedCount: (state.completed_modules || []).length,
    modules: moduleCards(state),
    awaitingReport: report.status === 'awaiting_confirmation',
    reportConfirmed: report.status === 'confirmed',
    reportFailed: report.status === 'failed'
  };
}

Page({
  data: Object.assign({
    conversations: [],
    messages: [],
    input: '',
    busy: false,
    note: '',
    historyOpen: false,
    pdfBusy: false
  }, conversationView(null)),

  onShow() {
    if (!api.getToken()) {
      wx.reLaunch({ url: api.loginUrl('/pages/ip12/ip12') });
      return;
    }
    this.loadConversations();
  },

  onPullDownRefresh() {
    this.loadConversations().finally(() => wx.stopPullDownRefresh());
  },

  loadConversations() {
    return api.request(API + '/conversations', { method: 'GET' }).then((res) => {
      if (res.statusCode !== 200) throw new Error((res.data && res.data.error) || '加载失败');
      const conversations = Array.isArray(res.data) ? res.data : [];
      this.setData({ conversations });
      const saved = wx.getStorageSync(CONVERSATION_KEY);
      const target = conversations.find((item) => item.id === saved) || conversations[0];
      return target ? this.openConversation(target.id) : null;
    }).catch((error) => {
      this.setData({ note: error.message || '暂时无法加载诊断记录' });
      return null;
    });
  },

  openConversation(id) {
    if (!id) return Promise.resolve(null);
    return api.request(API + '/conversations/' + encodeURIComponent(id), { method: 'GET' }).then((res) => {
      if (res.statusCode !== 200) throw new Error((res.data && res.data.error) || '诊断记录不存在');
      wx.setStorageSync(CONVERSATION_KEY, id);
      this.setData(Object.assign({ note: '', historyOpen: false }, conversationView(res.data)));
      return res.data;
    }).catch((error) => {
      wx.removeStorageSync(CONVERSATION_KEY);
      this.setData({ note: error.message || '诊断记录加载失败' });
      return null;
    });
  },

  createConversation() {
    if (this.data.busy) return;
    this.setData({ busy: true, note: '正在开启诊断…' });
    api.request(API + '/conversations', { method: 'POST' }).then((res) => {
      if (res.statusCode !== 200) throw new Error((res.data && res.data.error) || '创建失败');
      return this.openConversation(res.data.id).then(() => this.sendMessage('我准备好了，开始诊断。'));
    }).then(() => this.loadConversations()).catch((error) => {
      this.setData({ note: error.message || '暂时无法开启诊断' });
    }).finally(() => this.setData({ busy: false }));
  },

  onInput(e) { this.setData({ input: String(e.detail && e.detail.value || '') }); },

  sendMessage(message) {
    const content = String(message || this.data.input || '').trim();
    if (!content || !this.data.conversationId || this.data.busy) return Promise.resolve(null);
    this.setData({ busy: true, input: '', note: '小黄雀正在整理…' });
    return api.request(API + '/chat-complete', {
      method: 'POST', timeout: 180000,
      data: { conversation_id: this.data.conversationId, message: content }
    }).then((res) => {
      if (res.statusCode !== 200 || !res.data || !res.data.ok) {
        throw new Error((res.data && res.data.error) || '小黄雀暂时无法回复');
      }
      return this.openConversation(this.data.conversationId);
    }).catch((error) => {
      this.setData({ note: error.message || '小黄雀暂时无法回复，请稍后再试' });
      return null;
    }).finally(() => this.setData({ busy: false }));
  },

  sendInput() { return this.sendMessage(''); },
  toggleHistory() { this.setData({ historyOpen: !this.data.historyOpen }); },
  closeHistory() { this.setData({ historyOpen: false }); },
  chooseConversation(e) { return this.openConversation(e.currentTarget.dataset.id); },

  downloadReport() {
    if (!this.data.conversationId || this.data.pdfBusy) return;
    this.setData({ pdfBusy: true, note: '正在准备 PDF…' });
    api.downloadProtected(API + '/foundation-report/' + encodeURIComponent(this.data.conversationId) + '.pdf')
      .then((filePath) => new Promise((resolve, reject) => wx.openDocument({ filePath, fileType: 'pdf', showMenu: true, success: resolve, fail: reject })))
      .then(() => this.setData({ note: 'PDF 已打开，可从右上角菜单保存或转发。' }))
      .catch(() => this.setData({ note: 'PDF 暂时无法打开，请稍后重试。' }))
      .finally(() => this.setData({ pdfBusy: false }));
  },

  confirmReport() {
    if (!this.data.conversationId || this.data.busy) return;
    this.setData({ busy: true, note: '正在确认初稿…' });
    api.request(API + '/foundation-report/confirm', {
      method: 'POST', data: { conversation_id: this.data.conversationId }
    }).then((res) => {
      if (res.statusCode !== 200 || !res.data || !res.data.ok) throw new Error((res.data && res.data.error) || '确认失败');
      this.setData({ busy: false });
      return this.sendMessage('我已确认模块 1-4 初稿，请开始模块 5。');
    }).catch((error) => {
      this.setData({ note: error.message || '确认失败，请稍后重试' });
    }).finally(() => this.setData({ busy: false }));
  }
});
