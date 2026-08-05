# Home Card Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a third, fixed-height home carousel slide that opens My Card and preserves the existing login return flow.

**Architecture:** Keep the existing data-driven home `swiper` and protected `_guardNav` navigation. Add one banner data item and its packaged bitmap asset; use a focused Node regression test to lock the slide content, fixed carousel dimensions, asset manifest entry, and logged-in/logged-out navigation behavior.

**Tech Stack:** WeChat Mini Program JavaScript/WXML/WXSS, Node.js built-in test runner, generated raster asset.

## Global Constraints

- Work only in `D:\codex\huangque-miniprogram-card-optional` on `codex/card-optional-entry-20260805`.
- Do not push, merge, upload, submit for review, publish, or deploy.
- Keep the carousel wrapper and slide height at `220rpx`; do not add a separate home section.
- The bitmap must contain no text, logo, or watermark so WXML remains the source of user-visible copy.

### Task 1: Lock the carousel behavior with a failing regression test

**Files:**
- Create: `tests/home_card_banner.test.js`
- Read: `miniprogram/pages/home/home.js`
- Read: `miniprogram/pages/home/home.wxml`
- Read: `miniprogram/pages/home/home.wxss`

- [ ] Add a Node test that loads the home page definition and asserts the third banner has id `business-card`, title `我的名片`, subtitle `创建、展示并分享你的个人名片`, image `/assets/home/business-card-banner.jpg`, and path `/pages/my-card/my-card`.
- [ ] Assert the WXML still renders banners inside the existing swiper, references the new asset in `home-asset-manifest`, and the WXSS keeps both `.rt-swiper-wrap` and `.rt-swiper` at `220rpx`.
- [ ] Exercise the existing banner tap handler with a logged-in account and assert navigation to `/pages/my-card/my-card`.
- [ ] Exercise the same handler without a token and assert navigation to `/pages/login/login?redirect=my-card`.
- [ ] Run `node --test tests/home_card_banner.test.js` and confirm failure is caused by the missing third banner/asset.

### Task 2: Generate and package the business-card banner artwork

**Files:**
- Create: `miniprogram/assets/home/business-card-banner.jpg`

- [ ] Generate one wide app-carousel illustration: dark near-black base, restrained purple/pink/cyan light, luminous digital business-card panel and simple professional silhouette weighted to the right, clean dark negative space on the left, no text/logo/watermark.
- [ ] Inspect the generated image for subject placement, legibility behind the existing left-side gradient mask, and absence of accidental text.
- [ ] Crop/resize to a wide carousel-friendly ratio and save an optimized JPEG at `miniprogram/assets/home/business-card-banner.jpg`.
- [ ] Verify the file is a valid image and remains within a practical Mini Program asset budget.

### Task 3: Add the third carousel item

**Files:**
- Modify: `miniprogram/pages/home/home.js`
- Modify: `miniprogram/pages/home/home.wxml`

- [ ] Append the `business-card` item to `data.banners` using the exact title, subtitle, image path, and page path from Task 1.
- [ ] Add `/assets/home/business-card-banner.jpg` to the hidden static asset manifest so upload packaging cannot drop the data-referenced image.
- [ ] Keep the existing generic banner tap behavior and fixed-height swiper unchanged.
- [ ] Run `node --test tests/home_card_banner.test.js` and confirm it passes.

### Task 4: Verify the complete local change and preview it

**Files:**
- Verify: `tests/*.test.js`
- Verify: `miniprogram/pages/home/home.js`
- Verify: `miniprogram/pages/home/home.wxml`
- Verify: `miniprogram/assets/home/business-card-banner.jpg`

- [ ] Run `node --test tests/*.test.js` and confirm zero failures.
- [ ] Run `git diff --check` and inspect `git diff --stat` plus the focused diff.
- [ ] Open WeChat DevTools with `D:\codex\huangque-miniprogram-card-optional\miniprogram`, compile, and visually confirm the third slide shares the existing carousel footprint and opens My Card.
- [ ] Commit the local implementation only after verification; do not perform any remote action.
