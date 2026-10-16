export interface StudioSocialShotIdentity {
  id: string;
  sourceShotId?: string;
}

export interface StudioSocialShotPointer {
  shotId: string;
  shotIndex: number;
}

/**
 * Social replication details are namespaced as `replication-*` inside Studio,
 * while task material and presenter plans retain their original shot IDs.
 */
export function normalizeStudioSocialShotId(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/^replication-/, '') : '';
}

/** Attach source identities only when the complete handoff is unambiguous. */
export function attachStudioSocialShotIdentities<T extends StudioSocialShotIdentity>(
  slots: T[],
  sourceShotIds: unknown[],
): Array<T & { sourceShotId?: string }> {
  const existing = slots.map(slot => normalizeStudioSocialShotId(slot.sourceShotId));
  if (slots.length && existing.every(Boolean) && new Set(existing).size === existing.length) return slots;
  const normalized = sourceShotIds.map(normalizeStudioSocialShotId);
  if (!slots.length || normalized.length !== slots.length || normalized.some(id => !id)
    || new Set(normalized).size !== normalized.length) return slots;
  return slots.map((slot, index) => ({ ...slot, sourceShotId: normalized[index] }));
}

/**
 * Resolve by immutable task shot identity. Positional fallback is permitted only
 * for genuinely historic records that never had a shot ID. A mismatched modern
 * ID remains unbound instead of silently attaching to the wrong shot.
 */
export function resolveStudioSocialShot<T extends StudioSocialShotIdentity>(
  slots: T[],
  pointer: StudioSocialShotPointer,
): T | undefined {
  const shotId = normalizeStudioSocialShotId(pointer.shotId);
  if (shotId) {
    return slots.find(slot => normalizeStudioSocialShotId(slot.sourceShotId) === shotId
      || normalizeStudioSocialShotId(slot.id) === shotId);
  }
  return slots[pointer.shotIndex];
}
