const api = require('../utils/api.js');

const PLANET_PATH = '/api/auth/invite/planet';
const PERMISSION_CODE = 'planet_membership_required';
const PERMISSION_MESSAGE = '权限不够，需要体验官及以上权限';
const UNKNOWN_PERSON_NAME = '匿名用户';
const MEMBERSHIP_NAMES = ['发起人', '合伙人', '体验官', '非会员'];

function numberValue(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number(fallback || 0);
}

function responseError(response, fallback) {
  const data = (response && response.data) || {};
  const error = new Error(data.message || data.detail || fallback || '邀请星球读取失败');
  error.statusCode = Number((response && response.statusCode) || 0);
  error.code = data.code || '';
  if (error.statusCode === 403 && (error.code === 'membership_required' || error.code === PERMISSION_CODE)) {
    error.code = PERMISSION_CODE;
    error.message = PERMISSION_MESSAGE;
  }
  return error;
}

function personName(value) {
  const name = String(value || '').trim();
  return name && MEMBERSHIP_NAMES.indexOf(name) < 0 ? name : '';
}

function publicPerson(raw, relation) {
  raw = raw || {};
  const card = raw.card || raw.public_card || raw.profile || {};
  const tier = raw.membership_tier || raw.member_tier || '';
  const name = personName(raw.name) || personName(raw.display_name) || personName(raw.card_name) ||
    personName(card.name) || personName(card.display_name) || UNKNOWN_PERSON_NAME;
  const grant = String(raw.node_token || raw.node_grant || raw.grant || '').trim();
  const publicId = String(raw.card_public_id || raw.public_id || card.public_id || '').trim();
  return {
    node_id: String(raw.node_id || grant || publicId || '').trim(),
    node_grant: grant,
    public_id: publicId,
    name,
    title: raw.title || raw.headline || raw.occupation || card.title || card.headline || card.occupation || '',
    avatar: raw.avatar_url || raw.avatar || card.avatar_url || card.avatar || '',
    membership_tier: tier,
    membership_name: raw.membership_name || '',
    membership_status: raw.membership_status || (tier ? 'active' : 'none'),
    membership_active: raw.membership_active !== undefined ? raw.membership_active : !!tier,
    children_count: numberValue(raw.children_count || raw.direct_count, 0),
    has_children: raw.has_children !== undefined ? !!raw.has_children : numberValue(raw.children_count || raw.direct_count, 0) > 0,
    relation: relation || raw.relation || ''
  };
}

function normalizedStats(data, downlines) {
  const source = data.stats || data.dashboard || data;
  const direct = numberValue(
    source.direct !== undefined ? source.direct :
      (source.direct_invites !== undefined ? source.direct_invites : source.valid_invites),
    downlines.length
  );
  const indirect = numberValue(
    source.indirect !== undefined ? source.indirect : source.indirect_invites,
    0
  );
  const total = numberValue(source.total !== undefined ? source.total : source.total_invites, direct + indirect);
  return { direct, indirect, total };
}

function normalizePlanet(data) {
  data = data || {};
  const viewerRaw = data.viewer || {};
  const downlineRaw = data.downlines || data.items || data.children || [];
  const downlines = downlineRaw.map((item) => publicPerson(item, 'child'));
  const permission = data.permission || {};
  const tier = viewerRaw.membership_tier || data.membership_tier || '';
  const canExplore = permission.can_explore_others !== undefined
    ? !!permission.can_explore_others
    : (viewerRaw.can_explore_others !== undefined
      ? !!viewerRaw.can_explore_others
      : (data.can_browse_network !== undefined ? !!data.can_browse_network : !!tier));
  const page = data.page || {};
  const nextCursor = page.next_cursor !== undefined ? page.next_cursor : (data.next_cursor || data.next_before_id || '');
  return {
    viewer: {
      membership_tier: tier,
      can_explore_others: canExplore
    },
    center: publicPerson(data.center || data.node || viewerRaw, 'self'),
    upline: data.upline || data.parent ? publicPerson(data.upline || data.parent, 'parent') : null,
    downlines,
    stats: normalizedStats(data, downlines),
    page: {
      has_more: page.has_more !== undefined ? !!page.has_more : !!nextCursor,
      next_cursor: nextCursor || ''
    },
    server_time: numberValue(data.server_time || (data.meta && data.meta.generated_at), 0)
  };
}

function queryString(options) {
  const parts = [];
  if (options.grant) parts.push('grant=' + encodeURIComponent(options.grant));
  if (options.cursor) parts.push('cursor=' + encodeURIComponent(options.cursor));
  parts.push('limit=' + encodeURIComponent(Math.max(1, Math.min(numberValue(options.limit, 50), 50))));
  return parts.length ? '?' + parts.join('&') : '';
}

function createPlanetService(requester) {
  const publicCardCache = {};

  function request(path) {
    return requester(path, { method: 'GET' });
  }

  function loadPublicCard(publicId) {
    publicId = String(publicId || '').trim();
    if (!publicId) return Promise.resolve({});
    if (!publicCardCache[publicId]) {
      publicCardCache[publicId] = requester('/api/auth/card/public?id=' + encodeURIComponent(publicId), {
        method: 'GET',
        auth: false
      }).then((response) => {
        if (!response || response.statusCode !== 200) {
          const statusCode = Number(response && response.statusCode || 0);
          if (!statusCode || statusCode === 429 || statusCode >= 500) delete publicCardCache[publicId];
          return {};
        }
        const data = response.data || {};
        const card = data.card || data;
        return {
          name: personName(card.name) || personName(card.display_name),
          title: card.title || card.headline || card.occupation || '',
          avatar: card.avatar || card.avatar_url || ''
        };
      }).catch(() => {
        delete publicCardCache[publicId];
        return {};
      });
    }
    return publicCardCache[publicId];
  }

  function hydratePerson(person) {
    if (!person || !person.public_id || (person.name !== UNKNOWN_PERSON_NAME && person.avatar)) {
      return Promise.resolve(person);
    }
    return loadPublicCard(person.public_id).then((card) => Object.assign({}, person, {
      name: personName(card.name) || person.name,
      title: card.title || person.title,
      avatar: card.avatar || person.avatar
    }));
  }

  function hydratePeople(people, limit) {
    const result = new Array(people.length);
    let cursor = 0;
    function worker() {
      const index = cursor;
      cursor += 1;
      if (index >= people.length) return Promise.resolve();
      return hydratePerson(people[index]).then((person) => {
        result[index] = person;
        return worker();
      });
    }
    const workers = [];
    const count = Math.min(Math.max(1, Number(limit || 4)), people.length);
    for (let index = 0; index < count; index += 1) workers.push(worker());
    return Promise.all(workers).then(() => result);
  }

  function completePlanet(planet) {
    const people = [planet.center, planet.upline].concat(planet.downlines || []);
    return hydratePeople(people, 4).then((hydrated) => Object.assign({}, planet, {
      center: hydrated[0],
      upline: hydrated[1] || null,
      downlines: hydrated.slice(2)
    }));
  }

  function fallbackSelf(options) {
    const cursor = options.cursor ? '&cursor=' + encodeURIComponent(options.cursor) : '';
    return Promise.all([
      request('/api/auth/invite/downlines?limit=' + Math.max(1, Math.min(numberValue(options.limit, 50), 50)) + cursor),
      request('/api/auth/me'),
      request('/api/auth/card/me'),
      request('/api/auth/invite/dashboard')
    ]).then((responses) => {
      const downlineResponse = responses[0];
      if (!downlineResponse || downlineResponse.statusCode !== 200) throw responseError(downlineResponse, '邀请关系暂时无法读取');
      const downlineData = downlineResponse.data || {};
      const user = (responses[1].data && responses[1].data.user) || {};
      const card = (responses[2].data && responses[2].data.card) || {};
      const center = Object.assign({}, user, {
        name: user.name || user.display_name || card.name || '我',
        title: user.title || user.occupation || card.title || card.headline || '',
        avatar: card.avatar || card.avatar_url || user.avatar || user.avatar_url || '',
        public_id: card.public_id || user.public_id || '',
        membership_tier: downlineData.membership_tier || user.membership_tier || '',
        membership_status: user.membership_status || '',
        membership_active: user.membership_active
      });
      return completePlanet(normalizePlanet({
        viewer: {
          membership_tier: downlineData.membership_tier || user.membership_tier || '',
          can_explore_others: !!downlineData.can_browse_network
        },
        center,
        upline: downlineData.parent,
        downlines: downlineData.items || [],
        stats: (responses[3] && responses[3].data) || {},
        page: { next_cursor: downlineData.next_cursor || '' },
        server_time: downlineData.server_time
      }));
    });
  }

  function fallbackOther(options) {
    const path = '/api/auth/invite/network' + queryString(options);
    return request(path).then((response) => {
      if (!response || response.statusCode !== 200) throw responseError(response, '该用户的邀请关系读取失败');
      const data = response.data || {};
      return completePlanet(normalizePlanet({
        viewer: { membership_tier: 'experience', can_explore_others: true },
        center: data.node,
        upline: data.parent,
        downlines: data.items || [],
        stats: { direct: (data.items || []).length, indirect: 0, total: (data.items || []).length },
        page: { next_cursor: data.next_cursor || '' },
        server_time: data.server_time
      }));
    });
  }

  function getPlanet(options) {
    options = options || {};
    return request(PLANET_PATH + queryString(options)).then((response) => {
      if (response && response.statusCode === 200) return completePlanet(normalizePlanet(response.data || {}));
      if (response && response.statusCode === 404) {
        return options.grant ? fallbackOther(options) : fallbackSelf(options);
      }
      throw responseError(response);
    });
  }

  return { getPlanet };
}

const defaultService = createPlanetService(api.request);

module.exports = {
  PLANET_PATH,
  PERMISSION_CODE,
  PERMISSION_MESSAGE,
  publicPerson,
  normalizePlanet,
  createPlanetService,
  getPlanet: defaultService.getPlanet
};
