# Optional Business Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make business cards an optional feature of an authenticated Huangque account instead of the mini program's startup and identity-binding flow.

**Architecture:** Keep the existing `business_cards.user_id` ownership and public sharing contracts. Add a non-creating owner query for the new client while retaining legacy card-token and WeChat binding endpoints for online `0.070`; update the mini program to use the normal account token and enter cards from Profile only.

**Tech Stack:** Python 3.12 standard-library HTTP server and SQLite; WeChat Mini Program JavaScript/WXML/WXSS; Node.js built-in test runner.

## Global Constraints

- All authenticated users can create and share cards.
- The mini program must start on `pages/home/home` and must not force card creation.
- New code must not call the four legacy bind/register endpoints.
- Existing public-card, privacy, media, invitation attribution, and invitation-planet behavior remains unchanged.
- Legacy `0.070` clients remain compatible.
- Do not deploy, publish, or remove legacy database columns or endpoints.

---

### Task 1: Non-Creating Card Query

**Files:**
- Modify: `D:/codex/huangque-main-site-card-audit/server/auth_server.py`
- Test: `D:/codex/huangque-main-site-card-audit/tests/test_business_card_network.py`

**Interfaces:**
- Consumes: `GET /api/auth/card/me`, account Bearer token or legacy `X-HQ-Card-Token`.
- Produces: `GET /api/auth/card/me?create=0`; returns `404 {"code":"card_not_found"}` without inserting a draft.

- [ ] **Step 1: Write the failing backend test**

Add a test that creates an active user without a `business_cards` row, calls `GET /api/auth/card/me?create=0`, asserts `404/card_not_found`, and verifies the row count remains zero. Also assert the default `GET /api/auth/card/me` still creates a draft for old clients.

- [ ] **Step 2: Run the targeted test and verify the new assertion fails**

Run: `python -m unittest tests.test_business_card_network.BusinessCardNetworkTests.test_non_creating_card_query_keeps_legacy_default -v`

Expected: FAIL because the current GET always calls `business_cards.create_draft`.

- [ ] **Step 3: Implement the query switch**

In the `/api/auth/card/me` GET branch, parse `create`; when it equals `0`, `false`, or `no`, call `business_cards.mine` without `create_draft`. Return:

```python
if not card:
    return self._send(404, {"detail": "尚未创建名片", "code": "card_not_found"})
```

Keep the existing draft-creating default for requests without `create=0`.

- [ ] **Step 4: Run targeted and compatibility tests**

Run the new test, then the complete `tests.test_business_card_network` module. Record the existing Windows-only temporary SQLite cleanup error separately from assertion failures.

- [ ] **Step 5: Commit the backend change**

Commit message: `feat(card): support non-creating owner lookup`

### Task 2: Default Startup and Navigation

**Files:**
- Modify: `miniprogram/app.json`
- Modify: `miniprogram/app.js`
- Modify: `miniprogram/pages/home/home.js`
- Modify: `miniprogram/custom-tab-bar/index.js`
- Modify: `miniprogram/pages/profile/profile.js`
- Test: `tests/card_home_launch.test.js`
- Test: `tests/custom_tabbar.test.js`
- Test: `tests/profile_membership.test.js`

**Interfaces:**
- Consumes: existing four workbench tab routes.
- Produces: Home is first page; Profile opens `/pages/my-card/my-card` with `navigateTo`.

- [ ] **Step 1: Update tests to define the new navigation contract**

Assert `app.json.pages[0] === 'pages/home/home'`, the tab list contains exactly Home/Inspiration/Assets/Profile, `navigationForRoute` always returns the workbench items, and Profile uses:

```javascript
goCard() { wx.navigateTo({ url: '/pages/my-card/my-card' }); }
```

- [ ] **Step 2: Run the navigation tests and verify failure**

Run: `node --test tests/card_home_launch.test.js tests/custom_tabbar.test.js tests/profile_membership.test.js`

- [ ] **Step 3: Implement the navigation change**

Move Home to the first page, remove My Card from `tabBar.list`, remove `OUTER_ITEMS` and legacy home redirection, set the custom tab default to Home, and change Profile card navigation to `navigateTo`.

- [ ] **Step 4: Run navigation tests**

Expected: all selected tests pass.

- [ ] **Step 5: Commit the mini program navigation change**

Commit message: `feat(card): make cards optional from profile`

### Task 3: Account-Owned Card Page

**Files:**
- Modify: `miniprogram/pages/my-card/my-card.js`
- Modify: `miniprogram/pages/my-card/my-card.wxml`
- Modify: `miniprogram/pages/my-card/my-card.wxss`
- Test: `tests/business_card_network.test.js`
- Test: `tests/new_account_navigation.test.js`

**Interfaces:**
- Consumes: `GET /api/auth/card/me?create=0` with normal account authentication.
- Produces: page states `loading | missing | owner | error`; `missing` navigates to card edit only after user action.

- [ ] **Step 1: Add failing page-state tests**

Mock a `404/card_not_found` response and assert state becomes `missing`. Assert the page source contains no `loginCardSession`, `/card/wechat/bind`, `binding`, `guest`, or existing-account binding action.

- [ ] **Step 2: Run the page tests and verify failure**

Run: `node --test tests/business_card_network.test.js tests/new_account_navigation.test.js`

- [ ] **Step 3: Replace the binding state machine**

On show: if `api.getToken()` is absent, navigate to login with `redirect=my-card`; otherwise request `/api/auth/card/me?create=0`. Render an empty state with one `创建我的名片` button for `card_not_found`. Existing draft and published rendering continues through `showOwner`.

- [ ] **Step 4: Run page-state tests**

Expected: tests pass and no binding copy remains in My Card.

- [ ] **Step 5: Commit the My Card state change**

Commit message: `refactor(card): use account-owned card states`

### Task 4: Account-Owned Card Editing

**Files:**
- Modify: `miniprogram/pages/card-edit/card-edit.js`
- Modify: `miniprogram/pages/card-edit/card-edit.wxml`
- Test: `tests/business_card_network.test.js`
- Test: `tests/new_account_navigation.test.js`

**Interfaces:**
- Consumes: normal account token and existing `PUT /api/auth/card/me`, `/card/media`, `/card/publish`, `/card/unpublish` endpoints.
- Produces: first save creates a draft without WeChat session, binding, registration, or password messaging.

- [ ] **Step 1: Add failing account-edit tests**

Assert the edit flow uses normal authentication, first save calls `PUT /api/auth/card/me` followed by publish, and source contains none of:

```text
/api/auth/miniprogram/card-register
/api/auth/card/wechat/bind
loginCardSession
initial_password
绑定已有账号
自动开通黄雀 AI
```

- [ ] **Step 2: Run edit tests and verify failure**

Run: `node --test tests/business_card_network.test.js tests/new_account_navigation.test.js`

- [ ] **Step 3: Simplify edit loading and save**

Load `/api/auth/card/me?create=0`; treat `card_not_found` as a blank card. Remove anonymous registration and WeChat binding branches. Use normal account auth for media and card mutations; preserve local draft recovery, media retry, validation, publish, unpublish, password change for the logged-in account, and existing public preview navigation.

- [ ] **Step 4: Run edit and media tests**

Expected: first-save, draft recovery, image/video upload, publish, unpublish, and error-message tests pass.

- [ ] **Step 5: Commit the edit-flow change**

Commit message: `refactor(card): remove client binding flow`

### Task 5: Regression and Preview

**Files:**
- Modify only tests when a test encodes the intentionally replaced interaction.

**Interfaces:**
- Consumes: completed backend and mini program changes.
- Produces: verified local build and WeChat Developer Tools preview.

- [ ] **Step 1: Run focused backend tests**

Run: `python -m unittest tests.test_business_card_network -v` from the backend worktree.

- [ ] **Step 2: Run the complete mini program test suite**

Run every `tests/*.test.js` through `node --test` from the mini program worktree.

- [ ] **Step 3: Check diffs and repository state**

Run `git diff --check`, inspect both branch diffs, and verify no credentials, build output, or unrelated files were added.

- [ ] **Step 4: Open local preview**

Open `D:/codex/huangque-miniprogram-card-optional/miniprogram` with WeChat Developer Tools, compile, and visually confirm Home starts first, bottom navigation has four items, Profile opens My Card, and an account without a card sees the optional create state.

- [ ] **Step 5: Report without external publication**

Report commits, tests, preview status, residual risks, and changed files. Do not push, merge, deploy, upload, submit, or publish.
