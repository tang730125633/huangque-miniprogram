function formatDate(timestamp) {
  const seconds = Number(timestamp || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const date = new Date(seconds * 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return year + '年' + month + '月' + day + '日';
}

function tierClass(tier) {
  return ['experience', 'partner', 'initiator'].indexOf(tier) >= 0 ? tier : 'none';
}

function buildMembershipView(user) {
  user = user || {};
  const status = user.membership_status || (user.membership_active ? 'active' : 'none');

  if (status === 'active' && user.membership_active) {
    return {
      status: 'active',
      statusText: '有效',
      name: user.membership_name || '会员信息待同步',
      tierClass: tierClass(user.membership_tier),
      expiresText: formatDate(user.membership_expires_at),
      discountText: user.points_purchase_discount_label || '以服务端结算为准',
      showNonmemberNotice: false
    };
  }

  if (status === 'expired') {
    return {
      status: 'expired',
      statusText: '已过期',
      name: user.membership_last_name || '原会员',
      tierClass: 'expired',
      expiresText: formatDate(user.membership_last_expires_at),
      discountText: '当前不可用',
      showNonmemberNotice: true
    };
  }

  return {
    status: 'none',
    statusText: '未开通',
    name: '非会员',
    tierClass: 'none',
    expiresText: '—',
    discountText: '当前不可用',
    showNonmemberNotice: true
  };
}

module.exports = { buildMembershipView, formatDate };
