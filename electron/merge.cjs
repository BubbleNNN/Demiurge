'use strict';
const { isDeepStrictEqual: equal } = require('node:util');
function conflict() {
  throw new Error('另一窗口刚修改了同一项内容，请核对最新数据后重试。');
}
function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function entityArray(path) {
  return (
    (path.length === 1 && ['characters', 'skins', 'memories'].includes(path[0])) ||
    (path.length === 2 && path[0] === 'messages')
  );
}
function mergeValue(base, next, current, path = []) {
  if (equal(next, base)) return current;
  if (equal(current, base) || equal(current, next)) return next;
  if (Array.isArray(next) && Array.isArray(current) && entityArray(path)) {
    const b = new Map((base || []).map((v) => [v.id, v]));
    const n = new Map(next.map((v) => [v.id, v]));
    const c = new Map(current.map((v) => [v.id, v]));
    const result = [];
    for (const id of new Set([...c.keys(), ...n.keys(), ...b.keys()])) {
      const value = mergeValue(b.get(id), n.get(id), c.get(id), [...path, id]);
      if (value !== undefined) result.push(value);
    }
    if (path[0] === 'messages') result.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return result;
  }
  if (plain(base) && plain(next) && plain(current)) {
    const result = {};
    for (const key of new Set([...Object.keys(base), ...Object.keys(current), ...Object.keys(next)])) {
      if (path.length === 0 && key === 'revision') continue;
      const value = mergeValue(base[key], next[key], current[key], [...path, key]);
      if (value !== undefined) result[key] = value;
    }
    return result;
  }
  return conflict();
}
function mergeSnapshots(base, next, current) {
  if (!current) return next;
  if (!base) {
    if ((current.revision || 0) > 0 && next.revision !== current.revision) return conflict();
    return next;
  }
  const { revision: _b, ...before } = base;
  const { revision: _n, ...after } = next;
  const { revision: _c, ...present } = current;
  return mergeValue(before, after, present);
}
module.exports = { mergeSnapshots, mergeValue };
