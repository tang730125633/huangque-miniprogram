# 小程序邀请分享直达注册页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让邀请中心的微信分享卡片直接打开小程序注册页并携带邀请码。

**Architecture:** 在邀请工具模块集中生成注册分享路径，邀请页只负责调用该函数并返回微信分享配置。现有登录页继续负责识别邀请码和绑定邀请关系。

**Tech Stack:** 微信小程序 JavaScript、Node.js tests

## Global Constraints

- 分享路径必须为 `/pages/login/login?invite=<合法6位邀请码>`。
- 不修改网站邀请链接或后端接口。
- 不合并、不发布小程序。

---

### Task 1: 分享路径与邀请页

**Files:**
- Modify: `miniprogram/utils/invite.js`
- Modify: `miniprogram/pages/invite/invite.js`
- Modify: `miniprogram/pages/invite/invite.wxml`
- Test: `tests/invite_flow.test.js`

- [x] **Step 1: Write failing share-path and page-contract tests**
- [x] **Step 2: Run tests and verify the expected failure**
- [x] **Step 3: Implement path helper and native share button**
- [x] **Step 4: Run the complete mini-program test suite**
- [ ] **Step 5: Commit and submit a separate PR**
