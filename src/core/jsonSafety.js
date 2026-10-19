// JSON из файла не должен привносить прототипы, функции, циклы или чрезмерную вложенность.
export function isSafeJson(value) {
  const stack = [{ value, depth: 0, ancestors: new Set() }];
  let nodes = 0;
  while (stack.length) {
    const { value: item, depth, ancestors } = stack.pop();
    if (++nodes > 200000 || depth > 32) return false;
    if (item === null || typeof item === 'string' || typeof item === 'boolean') continue;
    if (typeof item === 'number') { if (!Number.isFinite(item)) return false; continue; }
    if (typeof item !== 'object' || ancestors.has(item)) return false;
    if (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) return false;
    const path = new Set(ancestors); path.add(item);
    for (const key of Object.keys(item)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) return false;
      stack.push({ value: item[key], depth: depth + 1, ancestors: path });
    }
  }
  return true;
}
export const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
