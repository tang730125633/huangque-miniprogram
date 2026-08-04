const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const wxml = fs.readFileSync(path.join(root, 'miniprogram/pages/home/home.wxml'), 'utf8');
const wxss = fs.readFileSync(path.join(root, 'miniprogram/pages/home/home.wxss'), 'utf8');

const backgroundPath = path.join(root, 'miniprogram/assets/home/ai-energy-flow-hero.webp');
const logoPath = path.join(root, 'miniprogram/assets/home/huangque-sparrow-logo.png');

assert.match(wxml, /class="hero-motion cosmic-rift"/);
assert.match(wxml, /assets\/home\/ai-energy-flow-hero\.webp/);
assert.match(wxml, /assets\/home\/huangque-sparrow-logo\.png/);
assert.match(wxml, /class="portal-ring portal-ring-horizontal"/);
assert.match(wxml, /class="portal-ring portal-ring-vertical"/);
assert.strictEqual((wxml.match(/class="shockwave /g) || []).length, 3);
assert.strictEqual((wxml.match(/class="warp-streak /g) || []).length, 6);

assert.match(wxss, /@keyframes portalRingHorizontal/);
assert.match(wxss, /@keyframes portalRingVertical/);
assert.match(wxss, /@keyframes energyShockwave/);
assert.match(wxss, /@keyframes heroLogoReveal/);

assert.doesNotMatch(wxml, /https?:\/\//i);
assert.doesNotMatch(wxml, /\.gif(?:["'])/i);
assert.doesNotMatch(wxml, /hero-orbit|hero-core|hero-spark/);
assert.doesNotMatch(wxss, /@keyframes\s+(heroOrbit|heroCore|heroSpark)/);

const background = fs.readFileSync(backgroundPath);
const logo = fs.readFileSync(logoPath);
assert.strictEqual(background.subarray(0, 4).toString('ascii'), 'RIFF');
assert.strictEqual(background.subarray(8, 12).toString('ascii'), 'WEBP');
assert.deepStrictEqual([...logo.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
assert.ok(background.length > 1024 && background.length <= 100 * 1024, 'background asset exceeds the 100 KiB budget');
assert.ok(logo.length > 512 && logo.length <= 20 * 1024, 'logo asset exceeds the 20 KiB budget');

const logoIndex = wxml.indexOf('hero-center-logo');
const brandIndex = wxml.indexOf('class="brandbar"');
const contentIndex = wxml.indexOf('class="content"');
assert.ok(logoIndex >= 0 && brandIndex > logoIndex && contentIndex > brandIndex, 'hero, brand, and content order must remain intact');

console.log('home premium energy native view checks passed');
