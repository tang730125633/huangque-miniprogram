const NAMES = [
  '周一鸣', '苏远', '林晓', '陈安然', '陆知行', '许星河', '顾明月', '唐嘉树', '沈清欢', '江以宁',
  '宋云舟', '叶星辰', '韩知夏', '程见山', '温如初', '谢临风', '秦书言', '傅景行', '乔南枝', '白清越',
  '贺明川', '季明月', '楚云深', '夏知微', '罗嘉禾', '段星野', '邵明哲', '魏清远', '齐若安', '莫时雨',
  '梁景川', '方念初', '任星澜', '袁知秋', '杜清和', '潘云起', '侯嘉木', '范明溪', '石南星', '雷书昀',
  '蒋安歌', '毛景明', '郝星晚', '孔知遇', '曹清嘉', '严云舒', '金明朗', '陶念安', '熊景和', '康星遥'
];
const TITLES = ['品牌顾问', '内容创作者', '直播运营', '视觉设计师', '短视频导演', '社群主理人'];
const TIERS = ['initiator', 'partner', 'experience', 'nonmember'];
const TIER_NAMES = { initiator: '发起人', partner: '合伙人', experience: '体验官', nonmember: '非会员' };

function person(id, name, tier, childrenCount) {
  tier = tier || 'nonmember';
  const active = tier !== 'nonmember';
  return {
    node_id: id,
    node_grant: 'local-grant-' + id,
    card_public_id: 'local-card-' + id,
    name,
    title: TITLES[Math.abs(String(id).length + String(name).length) % TITLES.length],
    avatar_url: 'https://example.test/avatars/' + encodeURIComponent(id) + '.jpg',
    membership_tier: active ? tier : '',
    membership_name: TIER_NAMES[tier],
    membership_status: active ? 'active' : 'none',
    membership_active: active,
    children_count: Number(childrenCount || 0),
    has_children: Number(childrenCount || 0) > 0
  };
}

const viewer = person('viewer', '岳雷', 'initiator', 50);
const viewerUpline = person('upline-1', '陆沉舟', 'partner', 1);
const rootDownlines = NAMES.map((name, index) => person(
  'down-' + (index + 1),
  name,
  TIERS[index % TIERS.length],
  index < 13 ? 2 : 0
));

const planets = {
  '': {
    center: viewer,
    upline: viewerUpline,
    downlines: rootDownlines,
    stats: { direct: 50, indirect: 26, total: 76 }
  },
  ['local-grant-' + viewerUpline.node_id]: {
    center: viewerUpline,
    upline: person('upline-2', '顾长川', 'initiator', 1),
    downlines: [viewer],
    stats: { direct: 1, indirect: 50, total: 51 }
  }
};

rootDownlines.forEach((center, index) => {
  const childCount = center.children_count;
  const children = Array.from({ length: childCount }, (_, childIndex) => person(
    center.node_id + '-child-' + (childIndex + 1),
    NAMES[(index * 2 + childIndex + 11) % NAMES.length] + (childIndex ? '工作室' : ''),
    TIERS[(index + childIndex + 1) % TIERS.length],
    0
  ));
  planets[center.node_grant] = {
    center,
    upline: viewer,
    downlines: children,
    stats: { direct: children.length, indirect: 0, total: children.length }
  };
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getPlanet(options) {
  options = options || {};
  const grant = String(options.grant || '');
  const source = planets[grant] || planets[''];
  const cursor = Math.max(0, Number(options.cursor || 0));
  const limit = Math.max(1, Math.min(Number(options.limit || 50), 50));
  const downlines = source.downlines.slice(cursor, cursor + limit);
  const next = cursor + downlines.length < source.downlines.length ? String(cursor + downlines.length) : '';
  return clone({
    ok: true,
    viewer: { membership_tier: 'initiator', can_explore_others: true },
    center: source.center,
    upline: source.upline,
    downlines,
    stats: source.stats,
    permission: { can_explore_others: true, required_tier: 'experience' },
    page: { has_more: !!next, next_cursor: next },
    meta: { source: 'isolated_local_fixture', version: 1 }
  });
}

module.exports = { NAMES, getPlanet };
