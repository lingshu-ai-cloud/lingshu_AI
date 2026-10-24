import { adminFetch } from './pb.js';

const CLAIM_COLLECTION = 'datastore_cas_claims';
const UNIQUE_OWNER_INDEXES = {
  tenant_profiles: 'create unique index idx_tenant_profile_owner on tenant_profiles (tenant_id)',
  digital_employee_configs: 'create unique index idx_digital_employee_config_tenant on digital_employee_configs (tenant_id)',
  digital_employee_config_versions: 'create unique index idx_de_config_versions_tenant_version on digital_employee_config_versions (tenant_id, config_version)',
  enterprise_onboarding_drafts: 'create unique index idx_enterprise_onboarding_draft_owner on enterprise_onboarding_drafts (tenant_id, user_id)',
} as const;
const REQUIRED_TEXT_FIELDS = [
  'target_key', 'expected_fingerprint', 'operation_fingerprint',
  'owner_token', 'created_at', 'lease_expires_at',
] as const;

type CollectionMetadata = {
  name?: unknown;
  type?: unknown;
  listRule?: unknown;
  viewRule?: unknown;
  createRule?: unknown;
  updateRule?: unknown;
  deleteRule?: unknown;
  fields?: unknown;
  schema?: unknown;
  indexes?: unknown;
};

function exactUniqueTargetIndex(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().replace(/[`"\[\]]/g, '').replace(/\s+/g, ' ').toLowerCase();
  return normalized === 'create unique index idx_datastore_cas_claim_target on datastore_cas_claims (target_key)';
}

function normalizedIndex(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().replace(/[`"\[\]]/g, '').replace(/\s+/g, ' ').toLowerCase()
    : '';
}

/** A first create needs a deployed unique owner index, not merely a CAS
 * claim collection or a migration checked into source control. */
export function pocketBaseUniqueOwnerSchemaReady(collectionName: string, value: unknown): boolean {
  const expected = UNIQUE_OWNER_INDEXES[collectionName as keyof typeof UNIQUE_OWNER_INDEXES];
  if (!expected || !value || typeof value !== 'object') return false;
  const collection = value as CollectionMetadata;
  if (collection.name !== collectionName || collection.type !== 'base') return false;
  const ownerFields = collectionName === 'enterprise_onboarding_drafts' ? ['tenant_id', 'user_id']
    : collectionName === 'digital_employee_config_versions' ? ['tenant_id', 'config_version'] : ['tenant_id'];
  const fields = Array.isArray(collection.fields) ? collection.fields : Array.isArray(collection.schema) ? collection.schema : [];
  if (!ownerFields.every(name => fields.some(field => field && typeof field === 'object'
    && (field as { name?: unknown }).name === name
    && (field as { type?: unknown }).type === (name === 'config_version' ? 'number' : 'text')
    && (field as { required?: unknown }).required === true))) return false;
  return Array.isArray(collection.indexes) && collection.indexes.some(index => normalizedIndex(index) === expected);
}

export async function pocketBaseUniqueOwnerSchemaVerified(collectionName: string): Promise<boolean> {
  if (!(collectionName in UNIQUE_OWNER_INDEXES)
    || !process.env.PB_ADMIN_EMAIL?.trim() || !process.env.PB_ADMIN_PASSWORD?.trim()) return false;
  try {
    const response = await adminFetch(`/api/collections/${collectionName}`);
    return response.ok && pocketBaseUniqueOwnerSchemaReady(collectionName, await response.json());
  } catch {
    return false;
  }
}

/** The collection metadata must describe the exact arbitration index and
 * admin-only claim rows. Migration source files alone are not evidence that
 * the connected PocketBase instance has applied them. */
export function pocketBaseCasClaimSchemaReady(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const collection = value as CollectionMetadata;
  if (collection.name !== CLAIM_COLLECTION || collection.type !== 'base') return false;
  if (['listRule', 'viewRule', 'createRule', 'updateRule', 'deleteRule'].some(key =>
    (collection as Record<string, unknown>)[key] !== null)) return false;
  const fields = Array.isArray(collection.fields) ? collection.fields : Array.isArray(collection.schema) ? collection.schema : [];
  if (!REQUIRED_TEXT_FIELDS.every(name => fields.some(field =>
    field && typeof field === 'object' && (field as { name?: unknown }).name === name
      && (field as { type?: unknown }).type === 'text' && (field as { required?: unknown }).required === true))) return false;
  return Array.isArray(collection.indexes) && collection.indexes.some(exactUniqueTargetIndex);
}

/** Read-only remote proof. Network/auth/schema uncertainty always means false. */
export async function pocketBaseCasClaimSchemaVerified(): Promise<boolean> {
  if (!process.env.PB_ADMIN_EMAIL?.trim() || !process.env.PB_ADMIN_PASSWORD?.trim()) return false;
  try {
    const response = await adminFetch(`/api/collections/${CLAIM_COLLECTION}`);
    if (!response.ok) return false;
    return pocketBaseCasClaimSchemaReady(await response.json());
  } catch {
    return false;
  }
}
