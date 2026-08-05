# Card and Link Invite Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide separate card-invitation and link-invitation actions, restore mini-program registration, and bind only newly registered accounts to the last valid inviter.

**Architecture:** The backend remains the source of truth for invite validation, seven-day expiry, signed card attribution, and transactional account creation. The mini program stores one validated pending-invite record, overwrites it on the last valid invitation action, and clears it after login, registration, expiry, or validation failure. Existing account login and authenticated card viewing never mutate invitation relationships.

**Tech Stack:** Python 3.12 standard-library HTTP service with SQLite; WeChat Mini Program JavaScript/WXML/WXSS; Python `unittest`; Node.js built-in test runner.

## Global Constraints

- Only successful new-account registration creates a direct-downline relationship.
- Existing-account login never creates or changes invitation relationships.
- Pending invitation attribution expires after seven days; the last valid invitation action wins.
- Public card viewing alone does not select an inviter; `我也想要` does.
- Direct mini-program registration without an inviter remains supported.
- Link Invitation remains available without a card; Card Invitation requires a published card.
- Registration and invitation binding must commit or roll back together.
- Current published mini-program clients remain backend compatible.
- Do not merge, deploy, upload, submit for review, or publish without separate approval.

---

### Task 1: Backend Invitation Registration Contract

**Files:**
- Modify: `D:/codex/huangque-main-site-card-audit/server/auth_server.py`
- Test: `D:/codex/huangque-main-site-card-audit/tests/test_business_card_network.py`
- Test: `D:/codex/huangque-main-site-card-audit/tests/test_invite_registration.py`

**Interfaces:**
- Consumes: `register_account(username, password, display_name, invite_code, invite_source, client_ip, device_id, card, invite_attribution_token)`.
- Produces: registration result containing `invite_bound: bool` and `inviter: {name, account_id} | null`; validation responses containing `server_time`, `invite_validated_at`, and `invite_expires_at`; converted card journey rows for attributed registrations.

- [ ] **Step 1: Write failing backend tests**

Add tests that assert:

```python
result, err = register_account(
    "card-new-user", "secret123", invite_code=code,
    invite_source="miniprogram", invite_attribution_token=token,
)
self.assertIsNone(err)
self.assertTrue(result["invite_bound"])
self.assertEqual(result["inviter"]["name"], "邀请人")
self.assertEqual(journey["registered_user_id"], result_user_id)
```

Also assert invalid card attribution rolls back both `users` and `user_invites`, direct registration returns `inviter is None`, and `GET /api/auth/invite/validate` returns server-issued seven-day timestamps.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```powershell
python -m unittest tests.test_business_card_network tests.test_invite_registration -v
```

Expected: new inviter/timestamp/journey assertions fail while existing registration tests remain green.

- [ ] **Step 3: Implement the backend contract**

In `register_account`:

```python
attribution = None
# verify signed card attribution before inserting the user
relation = invites.bind_registration(...)
if relation and attribution and attribution.get("journey_id"):
    business_cards.start_referral_journey(c, attribution, relation["campaign_id"])
    business_cards.convert_referral_journey(c, attribution, cur.lastrowid, relation["id"])
inviter = inviter_summary(c, relation["inviter_user_id"]) if relation else None
```

Return `inviter` from `/api/auth/miniprogram-register`. Extend invite validation with `server_time`, `invite_validated_at`, and `invite_expires_at = now + 7 * 24 * 3600`. Extend public-card valid-invite responses with the validated inviter summary.

- [ ] **Step 4: Run focused and compatibility tests**

Run the two focused modules again, followed by:

```powershell
python -m unittest tests.test_auth_points tests.test_invite_rewards -v
```

Expected: all assertions pass; no existing registration or reward behavior changes.

- [ ] **Step 5: Commit the backend change**

```powershell
git add server/auth_server.py tests/test_business_card_network.py tests/test_invite_registration.py
git commit -m "feat(invite): complete attributed mini registration"
```

### Task 2: Validated Pending-Invitation State

**Files:**
- Create: `miniprogram/utils/invite-context.js`
- Modify: `miniprogram/utils/card.js`
- Test: `tests/invite_context.test.js`
- Test: `tests/business_card_network.test.js`

**Interfaces:**
- Consumes: server-validated invite code, inviter summary, validation timestamp, expiry timestamp, and optional signed card attribution token.
- Produces: `saveLink(data)`, `saveCard(data)`, `current(now)`, `registrationPayload(now)`, and `clear()`.

- [ ] **Step 1: Write the failing state tests**

Cover the following contract:

```javascript
context.saveLink({ code: 'ABCD23', inviter: { name: 'A' }, validated_at: 100, expires_at: 700 });
context.saveCard({ code: 'EFGH45', inviter: { name: 'B' }, attribution_token: 'signed', validated_at: 200, expires_at: 800 });
assert.strictEqual(context.current(300000).code, 'EFGH45');
assert.deepStrictEqual(context.registrationPayload(300000), {
  invite_code: 'EFGH45', invite_attribution_token: 'signed'
});
context.clear();
assert.strictEqual(context.current(), null);
```

Also verify malformed records and expired records are removed, card records require a signed token, link records do not, and a later valid save overwrites the earlier inviter.

- [ ] **Step 2: Run the state test and verify failure**

Run:

```powershell
node --test tests/invite_context.test.js
```

Expected: FAIL because `invite-context.js` does not exist.

- [ ] **Step 3: Implement the state module**

Use one storage key, `hq_pending_registration_invite`. Convert server seconds to milliseconds, cap expiry to seven days from server validation, and reject records without a valid six-character code. Keep `card.js` attribution exports as compatibility wrappers delegating to the new module.

- [ ] **Step 4: Run state and card utility tests**

Run:

```powershell
node --test tests/invite_context.test.js tests/business_card_network.test.js
```

Expected: both files pass.

- [ ] **Step 5: Commit the state module**

```powershell
git add miniprogram/utils/invite-context.js miniprogram/utils/card.js tests/invite_context.test.js tests/business_card_network.test.js
git commit -m "feat(invite): persist validated registration context"
```

### Task 3: Restore Combined Login and Registration

**Files:**
- Modify: `miniprogram/pages/login/login.js`
- Modify: `miniprogram/pages/login/login.wxml`
- Modify: `miniprogram/pages/login/login.wxss`
- Modify: `tests/invite_flow.test.js`
- Modify: `tests/login_consent.test.js`
- Modify: `tests/new_account_navigation.test.js`

**Interfaces:**
- Consumes: query invite code, `invite-context.current()`, `/api/auth/invite/validate`, `/api/auth/miniprogram-login`, and `/api/auth/miniprogram-register`.
- Produces: Login and Registration modes; non-editable inviter notice; registration payload containing only validated invite fields; Home navigation after invitation login or registration.

- [ ] **Step 1: Write failing login and registration tests**

Assert direct entry defaults to Login, invite query defaults to Registration after validation, and registration sends:

```javascript
{
  username: 'new-user',
  password: 'secret123',
  device_id: 'device-id',
  invite_code: 'ABCD23',
  invite_attribution_token: 'signed-token'
}
```

Assert existing-account login never includes invite fields, clears pending context, and navigates to Home. Assert registration success uses the backend inviter name in the success dialog, clears context, and navigates to Home. Assert an expired or invalid invitation blocks attributed registration with `邀请已失效，请重新打开分享链接`.

- [ ] **Step 2: Run focused mini-program tests and verify failure**

Run:

```powershell
node --test tests/invite_flow.test.js tests/login_consent.test.js tests/new_account_navigation.test.js
```

Expected: registration-mode assertions fail against the current login-only page.

- [ ] **Step 3: Implement the combined page**

Restore `mode`, `setMode`, and the registration endpoint. Validate link invitations before saving them. Render Login and Registration tabs and the non-editable inviter notice. Keep account, password, existing agreement controls, and voiceprint disclosure; do not add phone, nickname, editable invite code, or confirmation-password fields.

- [ ] **Step 4: Run focused login tests**

Run the three focused files again.

Expected: all pass, including agreement gating for both modes.

- [ ] **Step 5: Commit the combined page**

```powershell
git add miniprogram/pages/login tests/invite_flow.test.js tests/login_consent.test.js tests/new_account_navigation.test.js
git commit -m "feat(auth): restore invited mini registration"
```

### Task 4: Separate Link and Card Invitation Buttons

**Files:**
- Modify: `miniprogram/pages/invite/invite.js`
- Modify: `miniprogram/pages/invite/invite.wxml`
- Modify: `miniprogram/pages/invite/invite.wxss`
- Modify: `tests/invite_flow.test.js`
- Modify: `tests/business_card_network.test.js`

**Interfaces:**
- Consumes: invite code, `GET /api/auth/card/me?create=0`, `registrationSharePath`, `cardSharePath`, and the existing share-cover generator.
- Produces: Link Invitation share metadata and Card Invitation share metadata selected by the tapped button.

- [ ] **Step 1: Write failing invitation-center tests**

Assert the page always renders Link Invitation, renders Card Invitation separately, treats `404/card_not_found` as a valid cardless state, and does not create a draft. Assert `onShareAppMessage({target:{dataset:{shareType:'link'}}})` returns the registration path while `shareType:'card'` returns the public-card path.

- [ ] **Step 2: Run invitation-center tests and verify failure**

Run:

```powershell
node --test tests/invite_flow.test.js tests/business_card_network.test.js
```

Expected: dual-button and non-creating-query assertions fail.

- [ ] **Step 3: Implement the two actions**

Query `/api/auth/card/me?create=0`; accept `card_not_found` without failing the rest of the invitation dashboard. Place Link Invitation and Card Invitation side by side. When no published card exists, Card Invitation opens a modal whose confirm action navigates to `/pages/card-edit/card-edit`. Use the tapped button's `data-share-type` to select share metadata.

- [ ] **Step 4: Run invitation-center tests**

Expected: both focused files pass.

- [ ] **Step 5: Commit the invitation-center change**

```powershell
git add miniprogram/pages/invite tests/invite_flow.test.js tests/business_card_network.test.js
git commit -m "feat(invite): separate card and link sharing"
```

### Task 5: Public Card Registration Call to Action

**Files:**
- Modify: `miniprogram/pages/card/card.js`
- Modify: `tests/business_card_network.test.js`
- Modify: `tests/new_account_navigation.test.js`

**Interfaces:**
- Consumes: valid public-card attribution returned by `/api/auth/card/public`, `/api/auth/invite/journey/start`, account token state, and `invite-context.saveCard`.
- Produces: authenticated Home navigation or unauthenticated Registration navigation after a successful journey start.

- [ ] **Step 1: Write failing public-card flow tests**

Assert card loading does not save pending attribution. Assert `goJoin` with an account token calls `wx.switchTab('/pages/home/home')` without starting a journey. Assert unauthenticated `goJoin` requires a successful journey-start response, saves the card context, and navigates to `/pages/login/login?mode=register`. Assert failed or expired attribution displays an error and does not navigate.

- [ ] **Step 2: Run public-card tests and verify failure**

Run:

```powershell
node --test tests/business_card_network.test.js tests/new_account_navigation.test.js
```

Expected: current unconditional card-edit navigation fails the new assertions.

- [ ] **Step 3: Implement login-state routing**

Keep validated attribution in page data only while viewing. Do not persist it during `loadPublic`. In `goJoin`, route authenticated users to Home. For guests, start the referral journey, persist the validated card context only after a `200` response, then navigate to Registration.

- [ ] **Step 4: Run public-card tests**

Expected: both files pass.

- [ ] **Step 5: Commit the public-card flow**

```powershell
git add miniprogram/pages/card/card.js tests/business_card_network.test.js tests/new_account_navigation.test.js
git commit -m "feat(card): route guests through invited registration"
```

### Task 6: Full Regression and Local Preview

**Files:**
- Modify only tests or documentation when they encode intentionally replaced behavior.

**Interfaces:**
- Consumes: completed backend and mini-program changes.
- Produces: reviewable branches, test evidence, and a local WeChat Developer Tools preview without upload or publication.

- [ ] **Step 1: Run complete backend verification**

Run the focused modules plus the repository's configured full test command. Record any pre-existing platform-only failures separately from new assertion failures.

- [ ] **Step 2: Run the complete mini-program suite**

Run:

```powershell
node --test tests/*.test.js
```

Expected: all mini-program tests pass.

- [ ] **Step 3: Verify repository state**

Run `git diff --check`, inspect both branch diffs against their bases, and confirm no secrets, build output, deployment edits, or unrelated files are included.

- [ ] **Step 4: Open WeChat Developer Tools preview**

Open `D:/codex/huangque-miniprogram-card-optional/miniprogram`, compile, and verify the invitation center's two buttons, public-card guest flow, Registration default mode, inviter notice, existing-account Login path, and Home return.

- [ ] **Step 5: Report without external publication**

Report commits, changed files, tests, preview state, and residual risks. Do not push, merge, deploy, upload, submit for review, or publish unless the user gives a separate instruction.
