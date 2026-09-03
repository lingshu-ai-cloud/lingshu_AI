import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { DataStore, Record_ } from '../storage/datastore.js';

const COLLECTION = 'tenant_api_keys';
const PRODUCT_API_KEY_PATTERN = /^ls_prod_[A-Za-z0-9_-]{32}$/;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

export type ProductApiKeyRecord = Record_ & {
  tenant_id?: unknown;
  api_key_hash?: unknown;
  key_prefix?: unknown;
  key_last4?: unknown;
  created_at?: unknown;
  rotated_at?: unknown;
  revoked_at?: unknown;
  last_ingested_at?: unknown;
  last_product_name?: unknown;
  version?: unknown;
  /** Legacy only. A populated plaintext field always makes the credential invalid. */
  api_key?: unknown;
};

export type ProductApiKeyMetadata = {
  tenantId: string;
  configured: boolean;
  rotationRequired: boolean;
  keyPrefix: string;
  keyLast4: string;
  createdAt: string;
  rotatedAt: string;
  revokedAt: string;
  lastIngestedAt: string;
  lastProductName: string;
};

export type ProductApiCredential = {
  recordId: string;
  tenantId: string;
  keyHash: string;
  version: number;
};

export type ProductApiKeyProvisionResult = {
  created: boolean;
  metadata: ProductApiKeyMetadata;
  /** Present exactly once: only the caller that created or rotated the record receives it. */
  secret?: string;
};

export class ProductApiKeyConflictError extends Error {
  constructor(message = 'tenant_product_api_key_conflict') {
    super(message);
    this.name = 'ProductApiKeyConflictError';
  }
}

function value(input: unknown): string {
  return input == null ? '' : String(input).trim();
}

function version(input: unknown): number {
  const parsed = Number(input);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function hashProductApiSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function productApiSecretMatchesHash(secret: string, storedHash: string): boolean {
  const expected = value(storedHash).toLowerCase();
  if (!PRODUCT_API_KEY_PATTERN.test(secret) || !SHA256_HEX_PATTERN.test(expected)) return false;
  const computed = Buffer.from(hashProductApiSecret(secret), 'hex');
  const stored = Buffer.from(expected, 'hex');
  return computed.length === stored.length && timingSafeEqual(computed, stored);
}

export function generateProductApiSecret(): string {
  return `ls_prod_${randomBytes(24).toString('base64url')}`;
}

function secretPreview(secret: string): { keyPrefix: string; keyLast4: string } {
  return { keyPrefix: secret.slice(0, 11), keyLast4: secret.slice(-4) };
}

export function productApiKeyMetadata(record: ProductApiKeyRecord | null | undefined, tenantId = ''): ProductApiKeyMetadata {
  const recordTenantId = value(record?.tenant_id) || tenantId;
  const legacyPlaintext = Boolean(value(record?.api_key));
  const keyHash = value(record?.api_key_hash).toLowerCase();
  const revokedAt = value(record?.revoked_at);
  const configured = Boolean(recordTenantId && SHA256_HEX_PATTERN.test(keyHash) && !legacyPlaintext && !revokedAt);
  return {
    tenantId: recordTenantId,
    configured,
    rotationRequired: Boolean(record) && !configured,
    keyPrefix: configured ? value(record?.key_prefix) : '',
    keyLast4: configured ? value(record?.key_last4) : '',
    createdAt: value(record?.created_at),
    rotatedAt: value(record?.rotated_at),
    revokedAt,
    lastIngestedAt: value(record?.last_ingested_at),
    lastProductName: value(record?.last_product_name),
  };
}

function keyPayload(secret: string, now: string, nextVersion: number, rotated: boolean): Record<string, unknown> {
  const preview = secretPreview(secret);
  return {
    api_key_hash: hashProductApiSecret(secret),
    key_prefix: preview.keyPrefix,
    key_last4: preview.keyLast4,
    created_at: now,
    rotated_at: rotated ? now : '',
    revoked_at: '',
    version: nextVersion,
  };
}

async function recordsForTenant(store: DataStore, tenantId: string): Promise<ProductApiKeyRecord[]> {
  const result = await store.list<ProductApiKeyRecord>(COLLECTION, {
    where: { tenant_id: tenantId },
    page: 1,
    perPage: 2,
  });
  if (result.items.length > 1) throw new ProductApiKeyConflictError('duplicate_tenant_product_api_keys');
  return result.items;
}

export async function productApiKeyStatus(store: DataStore, tenantId: string): Promise<ProductApiKeyMetadata> {
  const records = await recordsForTenant(store, tenantId);
  return productApiKeyMetadata(records[0], tenantId);
}

export async function ensureProductApiKey(store: DataStore, tenantId: string, now = new Date().toISOString()): Promise<ProductApiKeyProvisionResult> {
  const current = await recordsForTenant(store, tenantId);
  if (current[0]) return { created: false, metadata: productApiKeyMetadata(current[0], tenantId) };

  const secret = generateProductApiSecret();
  const result = await store.createIfAbsent<ProductApiKeyRecord>(COLLECTION, { tenant_id: tenantId }, {
    ...keyPayload(secret, now, 1, false),
    last_ingested_at: '',
    last_product_name: '',
  });
  const metadata = productApiKeyMetadata(result.record, tenantId);
  if (!result.created) return { created: false, metadata };
  if (!metadata.configured) throw new Error('tenant_product_api_key_storage_invalid');
  return { created: true, metadata, secret };
}

export async function rotateProductApiKey(store: DataStore, tenantId: string, now = new Date().toISOString()): Promise<ProductApiKeyProvisionResult> {
  const current = (await recordsForTenant(store, tenantId))[0];
  if (!current) {
    const created = await ensureProductApiKey(store, tenantId, now);
    if (!created.created || !created.secret) throw new ProductApiKeyConflictError();
    return created;
  }

  const secret = generateProductApiSecret();
  const currentHash = value(current.api_key_hash).toLowerCase();
  const clearLegacyPlaintext = Object.prototype.hasOwnProperty.call(current, 'api_key') ? { api_key: '' } : {};
  const result = await store.compareAndSet<ProductApiKeyRecord>(COLLECTION, current.id, {
    tenant_id: tenantId,
    api_key_hash: currentHash,
  }, {
    ...keyPayload(secret, now, version(current.version) + 1, true),
    ...clearLegacyPlaintext,
  });
  if (!result.ok) throw new ProductApiKeyConflictError();
  const metadata = productApiKeyMetadata(result.record, tenantId);
  if (!metadata.configured) throw new Error('tenant_product_api_key_storage_invalid');
  return { created: true, metadata, secret };
}

/**
 * Verification deliberately queries by the computed digest, never by the raw
 * bearer value, and then repeats the comparison in constant time. Legacy
 * plaintext rows and revoked rows are always rejected.
 */
export async function verifyProductApiKey(store: DataStore, providedSecret: string): Promise<ProductApiCredential | null> {
  const secret = value(providedSecret);
  if (!PRODUCT_API_KEY_PATTERN.test(secret)) return null;
  const keyHash = hashProductApiSecret(secret);
  const result = await store.list<ProductApiKeyRecord>(COLLECTION, {
    where: { api_key_hash: keyHash },
    page: 1,
    perPage: 2,
  });
  if (result.items.length !== 1) return null;
  const record = result.items[0];
  const metadata = productApiKeyMetadata(record);
  if (!metadata.configured || !productApiSecretMatchesHash(secret, value(record.api_key_hash))) return null;
  return {
    recordId: record.id,
    tenantId: metadata.tenantId,
    keyHash,
    version: version(record.version),
  };
}

/** Best-effort metadata write which cannot resurrect or overwrite a rotated credential. */
export async function touchProductApiKey(store: DataStore, credential: ProductApiCredential, input: {
  lastIngestedAt: string;
  lastProductName: string;
}): Promise<boolean> {
  const result = await store.compareAndSet<ProductApiKeyRecord>(COLLECTION, credential.recordId, {
    tenant_id: credential.tenantId,
    api_key_hash: credential.keyHash,
  }, {
    last_ingested_at: input.lastIngestedAt,
    last_product_name: input.lastProductName,
  });
  return result.ok;
}
