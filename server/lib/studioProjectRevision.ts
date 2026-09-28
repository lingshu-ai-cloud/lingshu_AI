export function studioProjectRevisionConflict(baseUpdatedAt: unknown, currentUpdatedAt: unknown): boolean {
  const base = String(baseUpdatedAt || '').trim();
  const current = String(currentUpdatedAt || '').trim();
  return !base || !current || base !== current;
}
