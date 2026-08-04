const test = require('node:test');
const assert = require('node:assert/strict');

const service = require('../miniprogram/services/invite-planet.js');
const fixture = require('./fixtures/invite_planet_fixture.js');

test('uses the unified planet endpoint and normalizes one direct upline plus direct downlines', async () => {
  const calls = [];
  const client = service.createPlanetService((path) => {
    calls.push(path);
    return Promise.resolve({ statusCode: 200, data: fixture.getPlanet({ limit: 50 }) });
  });
  const planet = await client.getPlanet({ limit: 50 });
  assert.deepEqual(calls, ['/api/auth/invite/planet?limit=50']);
  assert.equal(planet.center.name, '岳雷');
  assert.equal(planet.upline.name, '陆沉舟');
  assert.equal(planet.downlines.length, 50);
  assert.deepEqual(planet.stats, { direct: 50, indirect: 26, total: 76 });
});

test('falls back to the deployed secure invite endpoints while the unified endpoint is rolling out', async () => {
  const calls = [];
  const responses = {
    '/api/auth/me': { statusCode: 200, data: { user: { username: '13800000000', display_name: '', membership_tier: 'experience' } } },
    '/api/auth/card/me': { statusCode: 200, data: { card: { name: '完整客户姓名', public_id: 'card-self', avatar: '/avatar.jpg' } } },
    '/api/auth/invite/dashboard': { statusCode: 200, data: { direct_invites: 1, indirect_invites: 2 } }
  };
  const client = service.createPlanetService((path) => {
    calls.push(path);
    if (path.startsWith('/api/auth/invite/planet')) return Promise.resolve({ statusCode: 404, data: {} });
    if (path.startsWith('/api/auth/invite/downlines')) {
      return Promise.resolve({
        statusCode: 200,
        data: {
          membership_tier: 'experience', can_browse_network: true, next_cursor: '',
          parent: { name: '直接上线', node_grant: 'grant-up', membership_tier: 'partner' },
          items: [{ name: '直接下线', node_grant: 'grant-down', membership_tier: 'experience' }]
        }
      });
    }
    return Promise.resolve(responses[path]);
  });
  const planet = await client.getPlanet({ limit: 50 });
  assert.equal(calls.length, 5);
  assert.equal(planet.center.name, '完整客户姓名');
  assert.equal(planet.center.avatar, '/avatar.jpg');
  assert.equal(planet.viewer.can_explore_others, true);
  assert.deepEqual(planet.stats, { direct: 1, indirect: 2, total: 3 });
});

test('never exposes a raw login username as a planet display name', () => {
  const person = service.publicPerson({
    username: '13800000000', membership_tier: 'experience', membership_name: '体验官', card_available: false
  });
  assert.equal(person.name, '匿名用户');
  assert.equal(JSON.stringify(person).includes('13800000000'), false);
});

test('never uses a membership identity as a person name', () => {
  const person = service.publicPerson({
    membership_name: '非会员', card_available: true, card_public_id: 'card-guest'
  });
  assert.equal(person.name, '匿名用户');
});

test('loads invitation relationships without fetching public cards', async () => {
  const calls = [];
  const client = service.createPlanetService((path, options) => {
    calls.push({ path, options });
    if (path.startsWith('/api/auth/invite/planet')) {
      return Promise.resolve({
        statusCode: 200,
        data: {
          viewer: { membership_tier: 'experience', can_explore_others: true },
          center: { node_id: 'self', card_public_id: 'card-self', membership_name: '体验官', card_available: true },
          downlines: [
            { node_id: 'child-1', card_public_id: 'card-child', membership_name: '非会员', card_available: true },
            { node_id: 'child-2', card_public_id: 'card-child', membership_name: '非会员', card_available: true }
          ]
        }
      });
    }
    throw new Error('relationship loading must not fetch public cards: ' + path);
  });
  const planet = await client.getPlanet({ limit: 50 });
  assert.equal(planet.center.name, '匿名用户');
  assert.equal(planet.center.avatar, '');
  assert.deepEqual(planet.downlines.map((person) => person.name), ['匿名用户', '匿名用户']);
  const cardCalls = calls.filter((call) => call.path.startsWith('/api/auth/card/public'));
  assert.equal(cardCalls.length, 0);
});

test('loads one public card on demand and reuses successful results', async () => {
  let calls = 0;
  let resolveRequest;
  const client = service.createPlanetService((path, options) => {
    calls += 1;
    assert.equal(path, '/api/auth/card/public?id=card-one');
    assert.deepEqual(options, { method: 'GET', auth: false });
    return new Promise((resolve) => { resolveRequest = resolve; });
  });

  const first = client.getPublicCard('card-one');
  const second = client.getPublicCard('card-one');
  await Promise.resolve();
  assert.equal(calls, 1);
  resolveRequest({ statusCode: 200, data: { card: { name: '按需姓名', avatar: '/avatar.jpg' } } });
  assert.deepEqual(await first, { name: '按需姓名', title: '', avatar: '/avatar.jpg' });
  assert.deepEqual(await second, { name: '按需姓名', title: '', avatar: '/avatar.jpg' });
  assert.deepEqual(await client.getPublicCard('card-one'), { name: '按需姓名', title: '', avatar: '/avatar.jpg' });
  assert.equal(calls, 1);
});

test('does not cache missing or failed public cards', async () => {
  let calls = 0;
  const client = service.createPlanetService(() => {
    calls += 1;
    if (calls === 1) return Promise.resolve({ statusCode: 404, data: {} });
    if (calls === 2) return Promise.reject(new Error('timeout'));
    return Promise.resolve({ statusCode: 200, data: { card: { name: '恢复成功' } } });
  });

  await assert.rejects(client.getPublicCard('retry-card'));
  await assert.rejects(client.getPublicCard('retry-card'), /timeout/);
  assert.equal((await client.getPublicCard('retry-card')).name, '恢复成功');
  assert.equal(calls, 3);
});

test('returns the exact experience-tier permission message', async () => {
  const client = service.createPlanetService(() => Promise.resolve({
    statusCode: 403,
    data: { code: 'membership_required', detail: 'old message' }
  }));
  await assert.rejects(
    client.getPlanet({ grant: 'some-grant' }),
    (error) => error.code === 'planet_membership_required' && error.message === '权限不够，需要体验官及以上权限'
  );
});

test('keeps local fixture data outside the miniprogram package', () => {
  const planet = fixture.getPlanet({ limit: 50 });
  assert.equal(planet.meta.source, 'isolated_local_fixture');
  assert.equal(planet.downlines.length, 50);
  assert.ok(planet.downlines.every((node) => node.name.length >= 2));
});
