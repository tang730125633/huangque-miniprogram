# Membership Error Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent contradictory membership errors on video submission and prevent failed invite APIs from being rendered as zero data.

**Architecture:** Keep the global API wrapper as the single owner of the membership modal. Page-level handlers only stop local processing for that structured error, while the invite page validates every parallel response before committing data to state.

**Tech Stack:** WeChat Mini Program JavaScript, Node.js `assert` tests.

## Global Constraints

- Do not change membership eligibility, invitation rules, billing, layout, or copy outside the two error paths.
- Do not merge, upload for review, or publish the mini program.

---

### Task 1: Add failing regression tests

**Files:**
- Create: `tests/membership_error_handling.test.js`
- Test: `miniprogram/pages/video/video.js`
- Test: `miniprogram/pages/invite/invite.js`

**Interfaces:**
- Consumes: `api.isMembershipRequired(res)` and invite page `load()`.
- Produces: Regression coverage for structured membership errors and partial invite API failures.

- [ ] **Step 1: Write the failing tests**

Assert that video submission checks `api.isMembershipRequired(res)` before the generic `403` branch. Execute invite `load()` with a failed reward response and assert that it sets an error instead of `rewardTotal: 0`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/membership_error_handling.test.js`

Expected: FAIL because video lacks the structured error branch and invite partial failures are accepted.

### Task 2: Implement minimal page fixes

**Files:**
- Modify: `miniprogram/pages/video/video.js`
- Modify: `miniprogram/pages/invite/invite.js`
- Test: `tests/membership_error_handling.test.js`

**Interfaces:**
- Consumes: `api.isMembershipRequired(res)`.
- Produces: A single membership prompt and all-or-error invite dashboard loading.

- [ ] **Step 1: Handle the structured video error**

Insert a membership-required branch after `401` and before generic `403`; clear `busy` and return without setting another note.

- [ ] **Step 2: Validate every invite response**

Associate each response with a fallback error message, require status `200`, and throw before calling `setData` when one fails.

- [ ] **Step 3: Run focused test to verify it passes**

Run: `node --test tests/membership_error_handling.test.js`

Expected: PASS.

### Task 3: Verify and publish the branch

**Files:**
- Verify: all files changed by Tasks 1 and 2.

**Interfaces:**
- Consumes: completed implementation and tests.
- Produces: a draft GitHub pull request against `main`.

- [ ] **Step 1: Run all Node tests**

Run all ten existing test files plus `tests/membership_error_handling.test.js`; expected: 11 passed, 0 failed.

- [ ] **Step 2: Run syntax and JSON checks**

Run `node --check` for every JavaScript file under `miniprogram` and parse every JSON file; expected: exit code 0.

- [ ] **Step 3: Commit and push**

Commit the focused changes, push `agent/miniprogram-membership-error-fixes`, and create a draft PR against `main`.

