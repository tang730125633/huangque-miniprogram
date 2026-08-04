# Invite Card Lazy Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop invitation network loading from fetching every public card and keep public-card requests scoped to the card page opened by the user.

**Architecture:** `services/invite-planet.js` will return normalized relationship data immediately without public-card hydration. The existing `pages/card/card.js` remains the single on-demand public-card loader and its retry action naturally reissues failed requests because it does not cache failures.

**Tech Stack:** WeChat Mini Program JavaScript, WXML, Node.js built-in test runner.

## Global Constraints

- Do not add or change backend endpoints.
- Do not change membership permissions, invitation rewards, relationship levels, or card creation.
- Only a user click that opens a card page may request `/api/auth/card/public`.
- Failed and empty card responses must remain retryable through the existing card-page retry action.

---

### Task 1: Make relationship loading independent from public cards

**Files:**
- Modify: `tests/invite_planet_service.test.js`
- Modify: `miniprogram/services/invite-planet.js`

**Interfaces:**
- Consumes: `createPlanetService(requester).getPlanet(options)`.
- Produces: the same normalized planet object without any `/api/auth/card/public` request.

- [ ] **Step 1: Replace hydration tests with a failing lazy-loading test**

Create a test whose requester throws if `/api/auth/card/public` is called. Assert that `getPlanet({ limit: 50 })` returns the normalized center and downlines using only the relationship response.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test tests/invite_planet_service.test.js`

Expected: FAIL because the current `completePlanet()` implementation requests public cards.

- [ ] **Step 3: Remove bulk public-card hydration**

Delete `publicCardCache`, `loadPublicCard`, `hydratePerson`, `hydratePeople`, and `completePlanet`. Return `normalizePlanet(...)` directly from the unified and fallback relationship paths.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `node --test tests/invite_planet_service.test.js`

Expected: PASS with no public-card requests.

- [ ] **Step 5: Commit the relationship-service change**

```powershell
git add tests/invite_planet_service.test.js miniprogram/services/invite-planet.js
git commit -m "fix: load invitation cards on demand"
```

### Task 2: Verify click-only card loading and retry behavior

**Files:**
- Modify: `tests/card_share_ownership.test.js`
- Verify: `miniprogram/pages/card/card.js`
- Verify: `miniprogram/pages/card/card.wxml`

**Interfaces:**
- Consumes: `Page.loadPublic(id, code)` and `Page.retry()`.
- Produces: a regression test proving a failed public-card request is reissued by retry.

- [ ] **Step 1: Add a focused retry regression test**

Load the card page with a public ID, make the first public request fail, invoke `retry()`, then assert a second request is issued and the successful card is displayed.

- [ ] **Step 2: Run the focused test**

Run: `node --test tests/card_share_ownership.test.js`

Expected: PASS if the existing card page already satisfies the approved behavior; otherwise FAIL for the missing retry behavior.

- [ ] **Step 3: Make the minimal card-page correction only if the test fails**

Keep retry bound to `loadPublic(this.data.publicId, this.data.inviteCode)` and do not introduce failure caching.

- [ ] **Step 4: Run all tests**

Run all `tests/*.test.js` files with Node's built-in test runner.

Expected: all tests pass.

- [ ] **Step 5: Verify in WeChat DevTools**

Open the isolated `miniprogram` directory, confirm the invitation network renders without public-card fan-out, click one card, and confirm only that card is requested. Confirm retry works after a simulated failure.
