function indexes(prompt) {
  const found = [];
  const re = /@(?:图片|图)(\d+)/g;
  let match;
  while ((match = re.exec(String(prompt || '')))) found.push(Number(match[1]));
  return found;
}

function validate(prompt, imageCount) {
  const bad = indexes(prompt).find((index) => index < 1 || index > imageCount);
  if (bad === undefined) return '';
  return bad < 1
    ? '图片编号从 1 开始，请修改 @图片' + bad
    : '提示词引用了 @图片' + bad + '，但当前只有 ' + imageCount + ' 张参考图';
}

function usesShiftedIndex(prompt, removedIndex) {
  return indexes(prompt).some((index) => index >= removedIndex);
}

function append(prompt, index) {
  const value = String(prompt || '');
  return value + (value && !/\s$/.test(value) ? ' ' : '') + '@图片' + index;
}

function trigger(prompt, cursor) {
  const value = String(prompt || '');
  const end = Number.isInteger(cursor) && cursor >= 0 ? cursor : value.length;
  return end > 0 && value.charAt(end - 1) === '@' ? { start: end - 1, end } : null;
}

function insert(prompt, index, start, end) {
  const value = String(prompt || '');
  const from = Number.isInteger(start) ? start : value.length;
  const to = Number.isInteger(end) ? end : from;
  const token = '@图片' + index;
  return { value: value.slice(0, from) + token + value.slice(to), cursor: from + token.length };
}

module.exports = { indexes, validate, usesShiftedIndex, append, trigger, insert };
