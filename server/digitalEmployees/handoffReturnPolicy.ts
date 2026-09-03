export type HandoffReference = { type: string; id: string; label?: string; url?: string };

export function hasMeaningfulHandoffResult(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value as Record<string, unknown>).some(([rawKey, entry]) => {
    if (!rawKey.trim() || entry === null || entry === undefined) return false;
    if (typeof entry === 'string') return Boolean(entry.trim());
    if (Array.isArray(entry)) return entry.length > 0;
    if (typeof entry === 'object') return Object.keys(entry as Record<string, unknown>).some(key => key.trim());
    return true;
  });
}

export function normalizeHandoffReferences(value: unknown): HandoffReference[] | null {
  if (!Array.isArray(value) || value.length > 20
    || value.some(item => typeof item !== 'string' && (!item || typeof item !== 'object' || Array.isArray(item)))) return null;
  return value.map(item => typeof item === 'string'
    ? { type: 'reference', id: item.trim().slice(0, 300) }
    : {
      type: String((item as Record<string, unknown>).type || 'reference').trim().slice(0, 80) || 'reference',
      id: String((item as Record<string, unknown>).id || '').trim().slice(0, 300),
      label: String((item as Record<string, unknown>).label || '').trim().slice(0, 300),
      url: String((item as Record<string, unknown>).url || '').trim().slice(0, 2_000),
    })
    .filter(item => item.id || item.url);
}
