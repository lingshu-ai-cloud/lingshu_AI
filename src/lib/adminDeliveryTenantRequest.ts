export interface DeliveryTenantRequestDraft {
  companyName: string;
  contactName: string;
  industry: string;
  notes: string;
}

export interface DeliveryTenantRequestStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface StoredDeliveryTenantRequest {
  fingerprint: string;
  requestId: string;
}

const STORAGE_KEY = 'lingshu:admin-delivery:tenant-create-request:v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function browserStorage(): DeliveryTenantRequestStorage {
  if (typeof localStorage === 'undefined') throw new Error('delivery_request_storage_unavailable');
  return localStorage;
}

function browserCrypto(): Crypto {
  if (typeof crypto === 'undefined' || !crypto.subtle || !crypto.getRandomValues) {
    throw new Error('delivery_request_crypto_unavailable');
  }
  return crypto;
}

function normalizedDraft(draft: DeliveryTenantRequestDraft): DeliveryTenantRequestDraft {
  return {
    companyName: String(draft.companyName || '').trim(),
    contactName: String(draft.contactName || '').trim(),
    industry: String(draft.industry || '').trim(),
    notes: String(draft.notes || '').trim(),
  };
}

export async function deliveryTenantFormFingerprint(draft: DeliveryTenantRequestDraft): Promise<string> {
  const payload = JSON.stringify(normalizedDraft(draft));
  const digest = await browserCrypto().subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

function createRequestId(): string {
  const source = browserCrypto();
  if (typeof source.randomUUID === 'function') return source.randomUUID();
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function deliveryTenantRequestId(
  draft: DeliveryTenantRequestDraft,
  storage: DeliveryTenantRequestStorage = browserStorage(),
): Promise<string> {
  const fingerprint = await deliveryTenantFormFingerprint(draft);
  try {
    const saved = JSON.parse(storage.getItem(STORAGE_KEY) || 'null') as Partial<StoredDeliveryTenantRequest> | null;
    if (saved?.fingerprint === fingerprint && typeof saved.requestId === 'string' && UUID.test(saved.requestId)) {
      return saved.requestId.toLowerCase();
    }
  } catch {
    // Replace malformed state with one authoritative request record below.
  }
  const requestId = createRequestId().toLowerCase();
  storage.setItem(STORAGE_KEY, JSON.stringify({ fingerprint, requestId } satisfies StoredDeliveryTenantRequest));
  return requestId;
}

export function clearDeliveryTenantRequestId(
  requestId: string,
  storage: DeliveryTenantRequestStorage = browserStorage(),
): void {
  try {
    const saved = JSON.parse(storage.getItem(STORAGE_KEY) || 'null') as Partial<StoredDeliveryTenantRequest> | null;
    if (saved?.requestId === requestId) storage.removeItem(STORAGE_KEY);
  } catch {
    // A stale entry is safe: the server-side request remains idempotent.
  }
}
