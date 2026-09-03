export interface MaterialIndexIdentity {
  id: string;
  tenantId?: string;
  file?: string;
  objectKey?: string;
}

function sameTenant(a: MaterialIndexIdentity, b: MaterialIndexIdentity): boolean {
  return String(a.tenantId || '') === String(b.tenantId || '');
}

/**
 * Replace one logical material without using its delivery URL as identity.
 *
 * Private R2-backed materials intentionally have an empty `url`, so URL based
 * de-duplication would remove every other private object whenever one item was
 * inserted. IDs are authoritative; tenant + storage identity is the safe
 * idempotency fallback for retries that rebuilt an item with a new ID.
 */
export function upsertMaterialIndex<T extends MaterialIndexIdentity>(list: readonly T[], material: T): T[] {
  return [
    ...list.filter(item => {
      if (item.id === material.id) return false;
      if (!sameTenant(item, material)) return true;
      if (material.objectKey && item.objectKey === material.objectKey) return false;
      if (material.file && item.file === material.file) return false;
      return true;
    }),
    material,
  ];
}
