import type { AccountProvider } from './types.js';

const PROVIDERS = new Set<AccountProvider>(['codex', 'claude']);
const FORBIDDEN_CREDENTIAL_FIELD = /(password|passwd|cookie|token|secret|credential|auth[_-]?json|api[_-]?key)/i;

function plainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_request_body');
  return value as Record<string, unknown>;
}

function assertAllowedFields(body: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(body)) {
    if (FORBIDDEN_CREDENTIAL_FIELD.test(key)) throw new Error('credential_material_not_accepted');
    if (!allowed.includes(key)) throw new Error(`unsupported_field:${key}`);
  }
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new Error(`invalid_${field}`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max || normalized.includes('\0')) throw new Error(`invalid_${field}`);
  return normalized;
}

function id(value: unknown, field: string): string {
  const normalized = text(value, field, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized)) throw new Error(`invalid_${field}`);
  return normalized;
}

export function parseCreateAccountBody(value: unknown): {
  provider: AccountProvider;
  label: string;
  memberId: string;
} {
  const body = plainObject(value);
  assertAllowedFields(body, ['provider', 'label', 'memberId']);
  if (!PROVIDERS.has(body.provider as AccountProvider)) throw new Error('invalid_provider');
  return {
    provider: body.provider as AccountProvider,
    label: text(body.label, 'label', 100),
    memberId: id(body.memberId, 'member_id'),
  };
}

export function parseAccountEnabledBody(value: unknown): { enabled: boolean } {
  const body = plainObject(value);
  assertAllowedFields(body, ['enabled']);
  if (typeof body.enabled !== 'boolean') throw new Error('invalid_enabled');
  return { enabled: body.enabled };
}

export interface AcquireAccountBody {
  memberId: string;
  deviceId: string;
  deviceLabel: string;
}

export function parseAcquireAccountBody(value: unknown): AcquireAccountBody {
  const body = plainObject(value);
  assertAllowedFields(body, ['memberId', 'deviceId', 'deviceLabel']);
  return {
    memberId: id(body.memberId, 'member_id'),
    deviceId: id(body.deviceId, 'device_id'),
    deviceLabel: text(body.deviceLabel, 'device_label', 100),
  };
}

export function parseLocalReleaseBody(value: unknown): { memberId: string; deviceId: string; leaseId: string } {
  const body = plainObject(value);
  assertAllowedFields(body, ['memberId', 'deviceId', 'leaseId']);
  return {
    memberId: id(body.memberId, 'member_id'),
    deviceId: id(body.deviceId, 'device_id'),
    leaseId: id(body.leaseId, 'lease_id'),
  };
}

export function parseAssignOwnerBody(value: unknown): { memberId: string } {
  const body = plainObject(value);
  assertAllowedFields(body, ['memberId']);
  return { memberId: id(body.memberId, 'member_id') };
}

export function parseReassignOwnerBody(value: unknown): { memberId: string } {
  const body = plainObject(value);
  assertAllowedFields(body, ['memberId']);
  return { memberId: id(body.memberId, 'member_id') };
}

export function parseAfter(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}
