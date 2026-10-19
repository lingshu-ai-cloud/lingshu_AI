function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableJsonValue(item)]),
  );
}

/** A semantic identity for one Studio draft snapshot. Object key order and
 * undefined fields cannot turn an unchanged draft into another network save. */
export function studioAutosaveFingerprint(
  projectId: string | null | undefined,
  title: string,
  spec: Record<string, unknown>,
): string {
  return JSON.stringify({
    projectId: projectId || 'new',
    title: title.trim() || '未命名草稿',
    spec: stableJsonValue(spec),
  });
}

export function studioDraftChanged(previous: string, next: string): boolean {
  return Boolean(next) && previous !== next;
}
