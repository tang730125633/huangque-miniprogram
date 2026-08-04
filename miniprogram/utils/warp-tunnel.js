const PARTICLE_COUNT = 100;
const SHARD_COUNT = 12;
const FAR_Z = 560;

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function devicePixelRatio() {
  try {
    if (wx.getWindowInfo) return wx.getWindowInfo().pixelRatio || 1;
    return wx.getSystemInfoSync().pixelRatio || 1;
  } catch (error) {
    return 1;
  }
}

function resetParticle(particle, state, spread) {
  particle.x = randomBetween(-state.width * .3, state.width * .3);
  particle.y = randomBetween(-state.height * .22, state.height * .22);
  particle.z = spread ? randomBetween(28, FAR_Z) : randomBetween(FAR_Z * .42, FAR_Z);
  particle.speed = randomBetween(.7, 1.8);
  particle.size = randomBetween(.35, .9);
  particle.tint = Math.random();
}

function resetShard(shard, state, spread) {
  shard.x = randomBetween(-state.width * .25, state.width * .25);
  shard.y = randomBetween(-state.height * .18, state.height * .18);
  shard.z = spread ? randomBetween(52, FAR_Z) : randomBetween(FAR_Z * .46, FAR_Z);
  shard.speed = randomBetween(.5, 1.2);
  shard.size = randomBetween(3, 6);
  shard.angle = randomBetween(0, Math.PI * 2);
  shard.spin = randomBetween(-.035, .035);
  shard.tint = Math.random();
}

function schedule(state) {
  if (!state.running || !state.canvas) return;
  state.frameId = state.canvas.requestAnimationFrame((time) => draw(state, time || Date.now()));
}

function drawTunnelRings(ctx, state, time) {
  const rotation = time * .00008;
  ctx.save();
  ctx.translate(state.centerX, state.centerY);
  ctx.rotate(rotation);
  for (let ring = 0; ring < 4; ring += 1) {
    const phase = (time * .00016 + ring * .25) % 1;
    const radius = 18 + phase * state.width * .46;
    const alpha = (1 - phase) * .1;
    ctx.beginPath();
    for (let side = 0; side < 6; side += 1) {
      const angle = side * Math.PI / 3;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius * .52;
      if (side === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(91,143,255,' + alpha.toFixed(3) + ')';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

function drawParticles(ctx, state, delta) {
  const focal = 110;
  state.particles.forEach((particle) => {
    particle.z -= particle.speed * delta;
    if (particle.z < 18) resetParticle(particle, state, false);

    const previousZ = particle.z + particle.speed * delta * 16;
    const scale = focal / particle.z;
    const previousScale = focal / previousZ;
    const x = state.centerX + particle.x * scale;
    const y = state.centerY + particle.y * scale;
    const previousX = state.centerX + particle.x * previousScale;
    const previousY = state.centerY + particle.y * previousScale;

    if (x < -80 || x > state.width + 80 || y < -80 || y > state.height + 80) {
      resetParticle(particle, state, false);
      return;
    }

    const depth = Math.max(0, Math.min(1, (FAR_Z - particle.z) / FAR_Z));
    const alpha = Math.min(.55, .1 + depth * .42);
    const color = particle.tint > .82 ? '218,194,255' : particle.tint > .42 ? '113,169,255' : '205,230,255';
    const gradient = ctx.createLinearGradient(previousX, previousY, x, y);
    gradient.addColorStop(0, 'rgba(' + color + ',0)');
    gradient.addColorStop(1, 'rgba(' + color + ',' + alpha.toFixed(3) + ')');
    ctx.beginPath();
    ctx.moveTo(previousX, previousY);
    ctx.lineTo(x, y);
    ctx.strokeStyle = gradient;
    ctx.lineWidth = Math.min(2.2, particle.size * (.55 + scale * 1.1));
    ctx.lineCap = 'round';
    ctx.stroke();
  });
}

function drawShards(ctx, state, delta) {
  const focal = 110;
  state.shards.forEach((shard) => {
    shard.z -= shard.speed * delta;
    shard.angle += shard.spin * delta;
    if (shard.z < 30) resetShard(shard, state, false);

    const scale = focal / shard.z;
    const x = state.centerX + shard.x * scale;
    const y = state.centerY + shard.y * scale;
    const size = Math.min(12, shard.size * scale * 1.45);
    if (x < -70 || x > state.width + 70 || y < -70 || y > state.height + 70) {
      resetShard(shard, state, false);
      return;
    }

    const depth = Math.max(0, Math.min(1, (FAR_Z - shard.z) / FAR_Z));
    const alpha = Math.min(.28, .04 + depth * .22);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(shard.angle);
    ctx.beginPath();
    ctx.moveTo(-size * .8, -size * .22);
    ctx.lineTo(size * .72, -size * .48);
    ctx.lineTo(size * .24, size * .62);
    ctx.closePath();
    const shade = shard.tint > .58 ? '120,168,255' : '185,218,255';
    ctx.fillStyle = 'rgba(' + shade + ',' + alpha.toFixed(3) + ')';
    ctx.strokeStyle = 'rgba(220,238,255,' + Math.min(.72, alpha + .12).toFixed(3) + ')';
    ctx.lineWidth = Math.max(.5, Math.min(1.5, scale));
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  });
}

function draw(state, time) {
  if (!state.running) return;
  const elapsed = state.lastTime ? time - state.lastTime : 34;
  if (elapsed < 30) {
    schedule(state);
    return;
  }
  const delta = Math.min(2.2, elapsed / 16.67);
  state.lastTime = time;
  state.ctx.clearRect(0, 0, state.width, state.height);
  drawTunnelRings(state.ctx, state, time);
  state.ctx.globalCompositeOperation = 'lighter';
  drawParticles(state.ctx, state, delta);
  drawShards(state.ctx, state, delta);
  state.ctx.globalCompositeOperation = 'source-over';
  schedule(state);
}

function resume(page) {
  const state = page && page._warpTunnel;
  if (!state || state.running) return;
  state.running = true;
  state.lastTime = 0;
  schedule(state);
}

function pause(page) {
  const state = page && page._warpTunnel;
  if (!state) return;
  state.running = false;
  if (state.frameId && state.canvas && state.canvas.cancelAnimationFrame) {
    state.canvas.cancelAnimationFrame(state.frameId);
  }
  state.frameId = 0;
}

function destroy(page) {
  if (!page) return;
  pause(page);
  page._warpTunnel = null;
}

function mount(page, selector) {
  if (!page || !page.createSelectorQuery) return;
  page.createSelectorQuery().select(selector || '#warpCanvas').fields({ node: true, size: true }).exec((result) => {
    const field = result && result[0];
    if (!field || !field.node || !field.width || !field.height) return;
    destroy(page);
    const canvas = field.node;
    const ctx = canvas.getContext('2d');
    const ratio = devicePixelRatio();
    canvas.width = Math.round(field.width * ratio);
    canvas.height = Math.round(field.height * ratio);
    ctx.scale(ratio, ratio);
    const state = {
      canvas,
      ctx,
      width: field.width,
      height: field.height,
      centerX: field.width / 2,
      centerY: Math.min(field.height * .3, 112),
      particles: [],
      shards: [],
      running: false,
      frameId: 0,
      lastTime: 0
    };
    for (let i = 0; i < PARTICLE_COUNT; i += 1) {
      const particle = {};
      resetParticle(particle, state, true);
      state.particles.push(particle);
    }
    for (let i = 0; i < SHARD_COUNT; i += 1) {
      const shard = {};
      resetShard(shard, state, true);
      state.shards.push(shard);
    }
    page._warpTunnel = state;
    resume(page);
  });
}

module.exports = { mount, resume, pause, destroy };
