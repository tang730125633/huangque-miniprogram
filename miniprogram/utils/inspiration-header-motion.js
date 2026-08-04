const PARTICLE_COUNT = 72;
const RIBBON_COUNT = 8;
const FRAME_INTERVAL = 30;
const TWO_PI = Math.PI * 2;

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function pixelRatio() {
  try {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    return Math.max(1, Math.min(2, Number(info.pixelRatio) || 1));
  } catch (error) {
    return 1;
  }
}

function resetParticle(particle, state, spread) {
  particle.x = spread ? randomBetween(-24, state.width + 24) : randomBetween(-42, -8);
  particle.baseY = randomBetween(state.height * .28, state.height * .72);
  particle.speed = randomBetween(.22, .68);
  particle.size = randomBetween(.35, 1.25);
  particle.phase = randomBetween(0, TWO_PI);
  particle.wave = randomBetween(4, 17);
  particle.alpha = randomBetween(.18, .66);
  particle.tint = Math.random();
}

function makeRibbon(index, state) {
  return {
    baseY: state.height * (.32 + index * .052),
    amplitude: randomBetween(8, 21),
    frequency: randomBetween(.013, .022),
    phase: randomBetween(0, TWO_PI),
    speed: randomBetween(.00022, .00052) * (index % 2 ? -1 : 1),
    width: randomBetween(.6, 1.9),
    alpha: randomBetween(.08, .24),
    tint: index % 3
  };
}

function schedule(state) {
  if (!state.running) return;
  if (state.canvas.requestAnimationFrame) {
    state.frameId = state.canvas.requestAnimationFrame((time) => draw(state, time || Date.now()));
    return;
  }
  state.timerId = setTimeout(() => draw(state, Date.now()), FRAME_INTERVAL);
}

function drawAmbientGlow(ctx, state, time) {
  const pulse = (Math.sin(time * .0007) + 1) / 2;
  const x = state.width * (.62 + Math.sin(time * .00018) * .055);
  const y = state.height * (.43 + Math.cos(time * .00023) * .045);
  const radius = state.width * (.13 + pulse * .045);
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, 'rgba(255,226,170,' + (.1 + pulse * .08).toFixed(3) + ')');
  gradient.addColorStop(.42, 'rgba(255,107,39,' + (.05 + pulse * .04).toFixed(3) + ')');
  gradient.addColorStop(1, 'rgba(242,35,152,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, state.width, state.height);
}

function ribbonY(ribbon, x, time) {
  return ribbon.baseY
    + Math.sin(x * ribbon.frequency + ribbon.phase + time * ribbon.speed) * ribbon.amplitude
    + Math.sin(x * ribbon.frequency * .43 - time * ribbon.speed * .68) * ribbon.amplitude * .32;
}

function drawRibbons(ctx, state, time) {
  state.ribbons.forEach((ribbon) => {
    const gradient = ctx.createLinearGradient(0, ribbon.baseY, state.width, ribbon.baseY);
    const main = ribbon.tint === 0 ? '255,194,98' : ribbon.tint === 1 ? '244,48,156' : '255,118,42';
    gradient.addColorStop(0, 'rgba(' + main + ',0)');
    gradient.addColorStop(.2, 'rgba(' + main + ',' + (ribbon.alpha * .48).toFixed(3) + ')');
    gradient.addColorStop(.58, 'rgba(' + main + ',' + ribbon.alpha.toFixed(3) + ')');
    gradient.addColorStop(1, 'rgba(' + main + ',0)');
    ctx.beginPath();
    for (let x = -20; x <= state.width + 20; x += 14) {
      const y = ribbonY(ribbon, x, time);
      if (x === -20) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = gradient;
    ctx.lineWidth = ribbon.width;
    ctx.lineCap = 'round';
    ctx.stroke();
  });
}

function drawParticles(ctx, state, time, delta) {
  state.particles.forEach((particle) => {
    particle.x += particle.speed * delta;
    if (particle.x > state.width + 32) resetParticle(particle, state, false);
    const y = particle.baseY
      + Math.sin(particle.x * .024 + particle.phase + time * .00045) * particle.wave;
    const shimmer = .55 + Math.sin(time * .0012 + particle.phase) * .35;
    const alpha = Math.max(.06, particle.alpha * shimmer);
    const color = particle.tint > .72 ? '255,84,178' : particle.tint > .34 ? '255,143,51' : '255,224,161';
    ctx.beginPath();
    ctx.arc(particle.x, y, particle.size, 0, TWO_PI);
    ctx.fillStyle = 'rgba(' + color + ',' + alpha.toFixed(3) + ')';
    ctx.fill();
  });
}

function draw(state, time) {
  if (!state.running) return;
  const elapsed = state.lastTime ? time - state.lastTime : FRAME_INTERVAL;
  if (elapsed < FRAME_INTERVAL) {
    schedule(state);
    return;
  }
  const delta = Math.min(2.2, elapsed / 16.67);
  state.lastTime = time;
  const ctx = state.ctx;
  ctx.clearRect(0, 0, state.width, state.height);
  ctx.globalCompositeOperation = 'lighter';
  drawAmbientGlow(ctx, state, time);
  drawRibbons(ctx, state, time);
  drawParticles(ctx, state, time, delta);
  ctx.globalCompositeOperation = 'source-over';
  schedule(state);
}

function resume(page) {
  const state = page && page._inspirationHeaderMotion;
  if (!state || state.running) return;
  state.running = true;
  state.lastTime = 0;
  schedule(state);
}

function pause(page) {
  const state = page && page._inspirationHeaderMotion;
  if (!state) return;
  state.running = false;
  if (state.frameId && state.canvas.cancelAnimationFrame) {
    state.canvas.cancelAnimationFrame(state.frameId);
  }
  if (state.timerId) clearTimeout(state.timerId);
  state.frameId = 0;
  state.timerId = 0;
}

function destroy(page) {
  if (!page) return;
  pause(page);
  page._inspirationHeaderMotion = null;
}

function mount(page, selector) {
  if (!page || !page.createSelectorQuery) return;
  page.createSelectorQuery().select(selector || '#inspirationHeaderCanvas')
    .fields({ node: true, size: true }).exec((result) => {
      const field = result && result[0];
      if (!field || !field.node || !field.width || !field.height) return;
      const canvas = field.node;
      const ctx = canvas.getContext && canvas.getContext('2d');
      if (!ctx) return;
      destroy(page);
      const ratio = pixelRatio();
      canvas.width = Math.round(field.width * ratio);
      canvas.height = Math.round(field.height * ratio);
      ctx.scale(ratio, ratio);
      const state = {
        canvas,
        ctx,
        width: field.width,
        height: field.height,
        ribbons: [],
        particles: [],
        running: false,
        frameId: 0,
        timerId: 0,
        lastTime: 0
      };
      for (let i = 0; i < RIBBON_COUNT; i += 1) state.ribbons.push(makeRibbon(i, state));
      for (let i = 0; i < PARTICLE_COUNT; i += 1) {
        const particle = {};
        resetParticle(particle, state, true);
        state.particles.push(particle);
      }
      page._inspirationHeaderMotion = state;
      resume(page);
    });
}

module.exports = { mount, resume, pause, destroy };
