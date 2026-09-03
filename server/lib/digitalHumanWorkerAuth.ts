import { createHash, timingSafeEqual } from 'node:crypto';

export interface DigitalHumanWorkerPrincipal {
  credentialId: string;
  workerId?: string;
  tenantScopes?: string[];
  legacy: boolean;
}

interface DigitalHumanWorkerCredential extends DigitalHumanWorkerPrincipal {
  key: string;
  revoked: boolean;
}

interface WorkerAuthEnvironment {
  NODE_ENV?: string;
  DIGITAL_HUMAN_WORKER_KEY?: string;
  DIGITAL_HUMAN_WORKER_CREDENTIALS_JSON?: string;
  DIGITAL_HUMAN_ALLOW_LEGACY_WORKER_KEY_BREAK_GLASS?: string;
}

function normalizedScopes(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const scopes = [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))].slice(0, 200);
  return scopes.length ? scopes : undefined;
}

function credentialFrom(value: unknown, fallbackId: string): DigitalHumanWorkerCredential | null {
  if (typeof value === 'string') {
    const key = value.trim();
    return key ? { credentialId: fallbackId, workerId: fallbackId, key, revoked: false, legacy: false } : null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const key = String(item.key || item.secret || '').trim();
  if (!key) return null;
  const credentialId = String(item.id || item.credentialId || fallbackId).trim().slice(0, 160) || fallbackId;
  const workerId = String(item.workerId || item.id || item.credentialId || fallbackId || '').trim().slice(0, 160) || undefined;
  return {
    credentialId,
    workerId,
    key,
    revoked: item.revoked === true || item.enabled === false,
    tenantScopes: normalizedScopes(item.tenantScopes ?? item.tenants),
    legacy: false,
  };
}

function credentialRegistry(raw: string): DigitalHumanWorkerCredential[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((item, index) => credentialFrom(item, `worker-${index + 1}`)).filter((item): item is DigitalHumanWorkerCredential => Boolean(item));
    }
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      if (Array.isArray(record.credentials)) {
        return record.credentials.map((item, index) => credentialFrom(item, `worker-${index + 1}`)).filter((item): item is DigitalHumanWorkerCredential => Boolean(item));
      }
      return Object.entries(record).map(([id, item]) => credentialFrom(item, id)).filter((item): item is DigitalHumanWorkerCredential => Boolean(item));
    }
  } catch {
    // A configured but malformed registry is deliberately fail-closed.
  }
  return [];
}

function secretEqual(supplied: string, expected: string): boolean {
  const left = createHash('sha256').update(supplied).digest();
  const right = createHash('sha256').update(expected).digest();
  return timingSafeEqual(left, right);
}

function bearerSecret(header: unknown): string {
  if (Array.isArray(header) || typeof header !== 'string') return '';
  const match = header.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] || '';
}

export function authenticateDigitalHumanWorker(
  authorization: unknown,
  env: WorkerAuthEnvironment = process.env,
): DigitalHumanWorkerPrincipal | null {
  const supplied = bearerSecret(authorization);
  if (!supplied) return null;
  const rawRegistry = String(env.DIGITAL_HUMAN_WORKER_CREDENTIALS_JSON || '').trim();
  if (rawRegistry) {
    const matches = credentialRegistry(rawRegistry).filter(item => !item.revoked && secretEqual(supplied, item.key));
    if (matches.length !== 1) return null;
    const match = matches[0]!;
    const { key: _key, revoked: _revoked, ...principal } = match;
    return principal;
  }
  const legacyKey = String(env.DIGITAL_HUMAN_WORKER_KEY || '').trim();
  const production = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
  const breakGlass = String(env.DIGITAL_HUMAN_ALLOW_LEGACY_WORKER_KEY_BREAK_GLASS || '').trim().toLowerCase() === 'true';
  // One shared bearer secret cannot bind a request to a workerId or tenant
  // scope. It remains a local-development compatibility path only. Production
  // requires the scoped JSON registry unless an operator deliberately records
  // a temporary break-glass exception.
  if (production && !breakGlass) return null;
  return legacyKey && secretEqual(supplied, legacyKey)
    ? { credentialId: 'legacy-development-key', legacy: true }
    : null;
}

export function workerPrincipalAllowsWorker(principal: DigitalHumanWorkerPrincipal, workerId: string): boolean {
  return Boolean(workerId) && (!principal.workerId || principal.workerId === workerId);
}

export function workerPrincipalAllowsTenant(principal: DigitalHumanWorkerPrincipal, tenantId: string): boolean {
  return !principal.tenantScopes?.length || principal.tenantScopes.includes('*') || principal.tenantScopes.includes(tenantId);
}
