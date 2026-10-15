import { createHash } from 'node:crypto';

function assertPlainValue(value: unknown, path = '$'): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`canonical_json_non_finite:${path}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPlainValue(item, `${path}[${index}]`));
    return;
  }
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`canonical_json_unsupported:${path}`);
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item === undefined) throw new Error(`canonical_json_undefined:${path}.${key}`);
    assertPlainValue(item, `${path}.${key}`);
  }
}

/** Stable JSON used for fixed-yield evidence, content identity and paid-operation idempotency. */
export function canonicalFixedYieldJson(value: unknown): string {
  assertPlainValue(value);
  const serialize = (item: unknown): string => {
    if (item === null || typeof item !== 'object') return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(serialize).join(',')}]`;
    return `{${Object.keys(item as Record<string, unknown>).sort()
      .map(key => `${JSON.stringify(key)}:${serialize((item as Record<string, unknown>)[key])}`).join(',')}}`;
  };
  return serialize(value);
}

export function fixedYieldSha256(value: unknown): string {
  return createHash('sha256').update(canonicalFixedYieldJson(value)).digest('hex');
}
