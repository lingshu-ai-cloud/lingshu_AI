/**
 * PocketBase admin client.
 *
 * These helpers distinguish a legitimate 404 from an unavailable or rejecting
 * datastore. Timeouts, 5xx, auth failures, and validation failures must never
 * be interpreted as empty data or successful persistence.
 */

export type PbErrorCode =
  | 'pb_configuration_error'
  | 'pb_auth_error'
  | 'pb_transport_error'
  | 'pb_http_error'
  | 'pb_protocol_error';

export class PbError extends Error {
  readonly code: PbErrorCode;
  readonly status?: number;
  readonly path?: string;
  readonly retryable: boolean;

  constructor(
    code: PbErrorCode,
    message: string,
    options: { status?: number; path?: string; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'PbError';
    this.code = code;
    this.status = options.status;
    this.path = options.path;
    this.retryable = options.retryable ?? false;
  }
}

export function isPbNotFound(error: unknown): error is PbError {
  return error instanceof PbError && error.status === 404;
}

export function isPbFallbackEligible(error: unknown): boolean {
  return error instanceof PbError
    && (error.code === 'pb_transport_error' || (error.code === 'pb_http_error' && Boolean(error.status && error.status >= 500)));
}

export function getPbUrl(): string {
  return (process.env.PB_URL ?? 'http://localhost:8090').replace(/\/$/, '');
}

function requestTimeoutMs(): number {
  const configured = Number(process.env.PB_REQUEST_TIMEOUT_MS ?? 5_000);
  return Number.isFinite(configured) ? Math.max(250, Math.min(30_000, configured)) : 5_000;
}

function safeDetail(detail: string): string {
  const compact = detail.replace(/\s+/g, ' ').trim();
  return compact ? compact.slice(0, 1_000) : '';
}

export async function pbFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('PocketBase request timed out')), requestTimeoutMs());
  const externalSignal = options.signal;
  const abortFromExternal = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromExternal();
  else externalSignal?.addEventListener('abort', abortFromExternal, { once: true });

  try {
    return await fetch(`${getPbUrl()}${path}`, { ...options, signal: controller.signal });
  } catch (error) {
    throw new PbError(
      'pb_transport_error',
      controller.signal.aborted ? `PocketBase request timed out or was aborted: ${path}` : `PocketBase is unavailable: ${path}`,
      { path, retryable: true, cause: error },
    );
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', abortFromExternal);
  }
}

let cachedToken: string | null = null;
let cachedIdentityKey: string | null = null;

function adminCreds(): { email: string; password: string } | null {
  const email = process.env.PB_ADMIN_EMAIL?.trim();
  const password = process.env.PB_ADMIN_PASSWORD?.trim();
  return email && password ? { email, password } : null;
}

export async function getPbAdminToken(): Promise<string | null> {
  const creds = adminCreds();
  if (!creds) return null;
  const key = `${creds.email}\0${creds.password}`;
  if (cachedToken && cachedIdentityKey === key) return cachedToken;

  cachedToken = null;
  cachedIdentityKey = key;
  const body = JSON.stringify({ identity: creds.email, password: creds.password });
  let lastStatus = 0;

  for (const path of [
    '/api/collections/_superusers/auth-with-password',
    '/api/admins/auth-with-password',
  ]) {
    const res = await pbFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    lastStatus = res.status;
    // 404 is the only signal that this PocketBase version uses the other auth
    // endpoint. Credential rejection and infrastructure errors are final and
    // must not be hidden by a later legacy-endpoint 404.
    if (res.status === 404) continue;
    if (!res.ok) {
      const detail = safeDetail(await res.text().catch(() => ''));
      throw new PbError('pb_auth_error', `PocketBase superuser authentication failed (${res.status})${detail ? `: ${detail}` : ''}`, {
        status: res.status,
        path,
        retryable: res.status === 408 || res.status === 429 || res.status >= 500,
      });
    }
    const json = (await res.json().catch((error) => {
      throw new PbError('pb_protocol_error', 'PocketBase auth returned invalid JSON', { path, cause: error });
    })) as { token?: string };
    if (!json.token) {
      throw new PbError('pb_protocol_error', 'PocketBase auth response is missing token', { path });
    }
    cachedToken = json.token;
    cachedIdentityKey = key;
    return cachedToken;
  }

  throw new PbError('pb_auth_error', `PocketBase superuser authentication failed${lastStatus ? ` (${lastStatus})` : ''}`, {
    status: lastStatus || undefined,
    retryable: lastStatus >= 500,
  });
}

export function invalidatePbAdminToken(): void {
  cachedToken = null;
}

export async function adminFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const perform = async (): Promise<Response> => {
    const token = await getPbAdminToken();
    if (!token) {
      throw new PbError('pb_configuration_error', 'PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD are required for datastore access', { path });
    }
    const headers = new Headers(options.headers);
    headers.set('Authorization', token);
    return pbFetch(path, { ...options, headers });
  };

  let res = await perform();
  const staleAdminToken = res.status === 401 || (
    res.status === 403 && /superuser/i.test(await res.clone().text().catch(() => ''))
  );
  if (!staleAdminToken) return res;

  invalidatePbAdminToken();
  res = await perform();
  if (res.status === 401 || res.status === 403) invalidatePbAdminToken();
  return res;
}

async function pbHttpError(res: Response, path: string, operation: string): Promise<PbError> {
  const detail = safeDetail(await res.text().catch(() => ''));
  return new PbError(
    'pb_http_error',
    `${operation} failed (${res.status})${detail ? `: ${detail}` : ''}`,
    { status: res.status, path, retryable: res.status === 408 || res.status === 429 || res.status >= 500 },
  );
}

async function responseJson<T>(res: Response, path: string): Promise<T> {
  try {
    return await res.json() as T;
  } catch (error) {
    throw new PbError('pb_protocol_error', `PocketBase returned invalid JSON: ${path}`, { path, cause: error });
  }
}

async function isRecordNotFoundResponse(res: Response): Promise<boolean> {
  if (res.status !== 404) return false;
  const body = await res.clone().json().catch(() => null) as { message?: unknown; status?: unknown } | null;
  // PocketBase 0.39.x uses a different message for an unknown collection
  // ("Missing collection context."). Only the pinned record-missing response
  // is allowed to become null/false; schema and route 404s remain failures.
  return body?.status === 404 && body.message === "The requested resource wasn't found.";
}

/** Invalid tokens return null; PocketBase outages throw. */
export async function getTenantIdFromToken(
  authHeader: string | undefined,
): Promise<{ userId: string; tenantId: string } | null> {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const path = '/api/collections/users/auth-refresh';
  const res = await pbFetch(path, { method: 'POST', headers: { Authorization: token } });
  if ([400, 401, 403, 404].includes(res.status)) return null;
  if (!res.ok) throw await pbHttpError(res, path, 'token verification');
  const json = await responseJson<{ record?: { id?: string; tenantId?: string } }>(res, path);
  const userId = json.record?.id;
  const tenantId = json.record?.tenantId;
  return userId && tenantId ? { userId, tenantId } : null;
}

/** Only a real 404 becomes null. */
export async function pbGet(collection: string, id: string): Promise<Record<string, unknown> | null> {
  const path = `/api/collections/${encodeURIComponent(collection)}/records/${encodeURIComponent(id)}`;
  const res = await adminFetch(path);
  if (await isRecordNotFoundResponse(res)) return null;
  if (!res.ok) throw await pbHttpError(res, path, `read ${collection}/${id}`);
  return responseJson<Record<string, unknown>>(res, path);
}

/** Never returns a synthetic persistence success. */
export async function pbCreate(
  collection: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const path = `/api/collections/${encodeURIComponent(collection)}/records`;
  const res = await adminFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw await pbHttpError(res, path, `create ${collection}`);
  return responseJson<Record<string, unknown>>(res, path);
}

/** A real 404 returns false; all other non-2xx responses throw. */
export async function pbPatch(
  collection: string,
  id: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  const path = `/api/collections/${encodeURIComponent(collection)}/records/${encodeURIComponent(id)}`;
  const res = await adminFetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (await isRecordNotFoundResponse(res)) return false;
  if (!res.ok) throw await pbHttpError(res, path, `update ${collection}/${id}`);
  return true;
}

/** A real 404 returns false; all other non-2xx responses throw. */
export async function pbDelete(collection: string, id: string): Promise<boolean> {
  const path = `/api/collections/${encodeURIComponent(collection)}/records/${encodeURIComponent(id)}`;
  const res = await adminFetch(path, { method: 'DELETE' });
  if (await isRecordNotFoundResponse(res)) return false;
  if (!res.ok) throw await pbHttpError(res, path, `delete ${collection}/${id}`);
  return true;
}

export interface PbListOptions {
  filter?: string;
  sort?: string;
  page?: number;
  perPage?: number;
  expand?: string;
  skipTotal?: boolean;
}

export interface PbListResult<T = Record<string, unknown>> {
  items: T[];
  totalItems: number;
  totalPages: number;
  page: number;
  perPage: number;
}

export async function pbList<T = Record<string, unknown>>(
  collection: string,
  opts: PbListOptions = {},
): Promise<PbListResult<T>> {
  const params = new URLSearchParams();
  if (opts.filter) params.set('filter', opts.filter);
  if (opts.sort) params.set('sort', opts.sort);
  if (opts.page) params.set('page', String(opts.page));
  if (opts.perPage) params.set('perPage', String(opts.perPage));
  if (opts.expand) params.set('expand', opts.expand);
  if (opts.skipTotal) params.set('skipTotal', '1');
  const path = `/api/collections/${encodeURIComponent(collection)}/records?${params}`;
  const res = await adminFetch(path);
  if (!res.ok) throw await pbHttpError(res, path, `list ${collection}`);
  const json = await responseJson<Partial<PbListResult<T>>>(res, path);
  if (!Array.isArray(json.items)) {
    throw new PbError('pb_protocol_error', `PocketBase list response is missing items: ${collection}`, { path });
  }
  return {
    items: json.items,
    totalItems: Number(json.totalItems ?? json.items.length),
    totalPages: Number(json.totalPages ?? 0),
    page: Number(json.page ?? 1),
    perPage: Number(json.perPage ?? opts.perPage ?? 20),
  };
}

/** Backwards-compatible name; all list calls are strict now. */
export const pbListStrict = pbList;

export type AtomicCompareResult<T> =
  | { ok: true; record: T }
  | { ok: false; reason: 'not_found' | 'conflict'; current?: T };

export async function pbCompareAndSet<T extends Record<string, unknown>>(
  collection: string,
  id: string,
  expected: Record<string, string | number | boolean>,
  data: Record<string, unknown>,
): Promise<AtomicCompareResult<T>> {
  const path = `/api/lingshu/atomic/compare-and-set/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`;
  const res = await adminFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expected, data }),
  });
  if (res.status === 404) {
    const body = await res.clone().json().catch(() => null) as { reason?: unknown } | null;
    if (body?.reason === 'not_found') return { ok: false, reason: 'not_found' };
    // A missing/unloaded pb_hooks route has the same generic 404 response as
    // a missing REST record. Do not let the worker interpret that deployment
    // defect as an ordinary CAS miss.
    throw await pbHttpError(res, path, `compare-and-set ${collection}/${id}`);
  }
  if (res.status === 409) {
    const body = await responseJson<{ current?: T }>(res, path);
    return { ok: false, reason: 'conflict', ...(body.current ? { current: body.current } : {}) };
  }
  if (!res.ok) throw await pbHttpError(res, path, `compare-and-set ${collection}/${id}`);
  const body = await responseJson<{ record?: T }>(res, path);
  if (!body.record) throw new PbError('pb_protocol_error', 'Atomic compare-and-set response is missing record', { path });
  return { ok: true, record: body.record };
}

export async function pbCreateIfAbsent<T extends Record<string, unknown>>(
  collection: string,
  uniqueWhere: Record<string, string | number | boolean>,
  data: Record<string, unknown>,
): Promise<{ created: boolean; record: T }> {
  const path = `/api/lingshu/atomic/create-if-absent/${encodeURIComponent(collection)}`;
  const res = await adminFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uniqueWhere, data }),
  });
  if (!res.ok) throw await pbHttpError(res, path, `create-if-absent ${collection}`);
  const body = await responseJson<{ created?: boolean; record?: T }>(res, path);
  if (typeof body.created !== 'boolean' || !body.record) {
    throw new PbError('pb_protocol_error', 'Atomic create-if-absent response is invalid', { path });
  }
  return { created: body.created, record: body.record };
}
