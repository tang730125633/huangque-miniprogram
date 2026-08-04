const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const warp = require(path.join(root, 'miniprogram/utils/warp-tunnel.js'));
const loginJs = fs.readFileSync(path.join(root, 'miniprogram/pages/login/login.js'), 'utf8');
const loginWxml = fs.readFileSync(path.join(root, 'miniprogram/pages/login/login.wxml'), 'utf8');

assert.deepStrictEqual(Object.keys(warp).sort(), ['destroy', 'mount', 'pause', 'resume']);
assert.match(loginWxml, /<canvas[^>]+type="2d"[^>]+id="warpCanvas"/);
assert.match(loginJs, /onReady\(\)\s*\{\s*warpTunnel\.mount\(this, '#warpCanvas'\)/);
assert.match(loginJs, /onHide\(\)\s*\{\s*warpTunnel\.pause\(this\)/);
assert.match(loginJs, /onUnload\(\)\s*\{\s*warpTunnel\.destroy\(this\)/);

assert.doesNotThrow(() => warp.mount(null));
assert.doesNotThrow(() => warp.pause(null));
assert.doesNotThrow(() => warp.resume(null));
assert.doesNotThrow(() => warp.destroy(null));

function queryPage(field) {
  return {
    createSelectorQuery() {
      return {
        select(selector) {
          assert.strictEqual(selector, '#warpCanvas');
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
warp.mount(zeroSizePage, '#warpCanvas');
assert.strictEqual(zeroSizePage._warpTunnel, undefined);

let frameSequence = 0;
let cancelledFrame = 0;
const scaleCalls = [];
const context = {
  scale(x, y) { scaleCalls.push([x, y]); }
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
    frameSequence += 1;
    return frameSequence;
  },
  cancelAnimationFrame(frameId) {
    cancelledFrame = frameId;
  }
};

global.wx = {
  getWindowInfo() { return { pixelRatio: 2 }; }
};

const page = queryPage({ node: canvas, width: 320, height: 180 });
warp.mount(page, '#warpCanvas');
assert.ok(page._warpTunnel);
assert.strictEqual(canvas.width, 640);
assert.strictEqual(canvas.height, 360);
assert.deepStrictEqual(scaleCalls, [[2, 2]]);
assert.strictEqual(page._warpTunnel.particles.length, 100);
assert.strictEqual(page._warpTunnel.shards.length, 12);
assert.strictEqual(page._warpTunnel.running, true);
assert.strictEqual(page._warpTunnel.frameId, 1);

warp.pause(page);
assert.strictEqual(page._warpTunnel.running, false);
assert.strictEqual(cancelledFrame, 1);

warp.resume(page);
assert.strictEqual(page._warpTunnel.running, true);
assert.strictEqual(page._warpTunnel.frameId, 2);

warp.destroy(page);
assert.strictEqual(cancelledFrame, 2);
assert.strictEqual(page._warpTunnel, null);

delete global.wx;
console.log('login warp tunnel tests passed');
