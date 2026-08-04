const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const motion = require(path.join(root, 'miniprogram/utils/inspiration-header-motion.js'));
const pageJs = fs.readFileSync(path.join(root, 'miniprogram/pages/inspiration/inspiration.js'), 'utf8');
const pageWxml = fs.readFileSync(path.join(root, 'miniprogram/pages/inspiration/inspiration.wxml'), 'utf8');
const pageWxss = fs.readFileSync(path.join(root, 'miniprogram/pages/inspiration/inspiration.wxss'), 'utf8');

assert.deepStrictEqual(Object.keys(motion).sort(), ['destroy', 'mount', 'pause', 'resume']);
assert.match(pageWxml, /<canvas[^>]+type="2d"[^>]+id="inspirationHeaderCanvas"/);
assert.match(pageWxml, /motion-ribbon-a/);
assert.match(pageJs, /onReady\(\)\s*\{\s*headerMotion\.mount\(this, '#inspirationHeaderCanvas'\)/);
assert.match(pageJs, /onHide\(\)\s*\{\s*headerMotion\.pause\(this\)/);
assert.match(pageJs, /onUnload\(\)\s*\{\s*headerMotion\.destroy\(this\)/);
assert.match(pageWxss, /@keyframes header-breathe/);
assert.match(pageWxss, /@keyframes ribbon-flow-a/);

assert.doesNotThrow(() => motion.mount(null));
assert.doesNotThrow(() => motion.pause(null));
assert.doesNotThrow(() => motion.resume(null));
assert.doesNotThrow(() => motion.destroy(null));

function queryPage(field) {
  return {
    createSelectorQuery() {
      return {
        select(selector) {
          assert.strictEqual(selector, '#inspirationHeaderCanvas');
          return this;
        },
        fields(options) {
          assert.deepStrictEqual(options, { node: true, size: true });
          return this;
        },
        exec(callback) {
          callback([field]);
        }
      };
    }
  };
}

const zeroSizePage = queryPage({ node: {}, width: 0, height: 180 });
motion.mount(zeroSizePage, '#inspirationHeaderCanvas');
assert.strictEqual(zeroSizePage._inspirationHeaderMotion, undefined);

const missingContextPage = queryPage({
  node: { getContext() { return null; } },
  width: 320,
  height: 180
});
motion.mount(missingContextPage, '#inspirationHeaderCanvas');
assert.strictEqual(missingContextPage._inspirationHeaderMotion, undefined);

let frameSequence = 0;
let cancelledFrame = 0;
let clearCount = 0;
const scaleCalls = [];
const scheduledCallbacks = [];
function gradient() {
  return { addColorStop() {} };
}
const context = {
  scale(x, y) { scaleCalls.push([x, y]); },
  clearRect() { clearCount += 1; },
  createRadialGradient: gradient,
  createLinearGradient: gradient,
  fillRect() {},
  beginPath() {},
  moveTo() {},
  lineTo() {},
  stroke() {},
  arc() {},
  fill() {}
};
const canvas = {
  width: 0,
  height: 0,
  getContext(type) {
    assert.strictEqual(type, '2d');
    return context;
  },
  requestAnimationFrame(callback) {
    assert.strictEqual(typeof callback, 'function');
    scheduledCallbacks.push(callback);
    frameSequence += 1;
    return frameSequence;
  },
  cancelAnimationFrame(frameId) {
    cancelledFrame = frameId;
  }
};

global.wx = {
  getWindowInfo() { return { pixelRatio: 3 }; }
};

const page = queryPage({ node: canvas, width: 360, height: 190 });
motion.mount(page, '#inspirationHeaderCanvas');
assert.ok(page._inspirationHeaderMotion);
assert.strictEqual(canvas.width, 720);
assert.strictEqual(canvas.height, 380);
assert.deepStrictEqual(scaleCalls, [[2, 2]]);
assert.strictEqual(page._inspirationHeaderMotion.ribbons.length, 8);
assert.strictEqual(page._inspirationHeaderMotion.particles.length, 72);
assert.strictEqual(page._inspirationHeaderMotion.running, true);
assert.strictEqual(page._inspirationHeaderMotion.frameId, 1);

assert.doesNotThrow(() => scheduledCallbacks[0](100));
assert.strictEqual(clearCount, 1);
assert.strictEqual(page._inspirationHeaderMotion.frameId, 2);

motion.pause(page);
assert.strictEqual(page._inspirationHeaderMotion.running, false);
assert.strictEqual(cancelledFrame, 2);

motion.resume(page);
assert.strictEqual(page._inspirationHeaderMotion.running, true);
assert.strictEqual(page._inspirationHeaderMotion.frameId, 3);

motion.destroy(page);
assert.strictEqual(cancelledFrame, 3);
assert.strictEqual(page._inspirationHeaderMotion, null);

delete global.wx;
console.log('inspiration header motion tests passed');
