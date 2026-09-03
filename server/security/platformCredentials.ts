import { store } from '../storage/index.js';
import {
  CREDENTIAL_ENVELOPE_VERSION,
  credentialMask,
  decryptCredential,
  encryptCredential,
  type CredentialContext,
} from './credentialEnvelope.js';

type TenantPlatformCredentialField = 'app_secret' | 'access_token' | 'wecom_encoding_aes_key' | 'webhook_verify_token';

export type TenantPlatformCredentialRecord = {
  id: string;
  tenant_id: string;
  platform: string;
  app_secret?: string;
  access_token?: string;
  wecom_encoding_aes_key?: string;
  webhook_verify_token?: string;
  credential_version?: string;
  credential_state?: string;
  credential_revision?: number;
  status?: string;
};

export type YouTubeCredentialRecord = {
  id: string;
  tenantId: string;
  clientSecret?: string;
  refreshToken?: string;
  accessToken?: string;
  credentialVersion?: string;
  credentialState?: string;
  credentialRevision?: number;
  status?: string;
};

export type SocialCredentialRecord = {
  id: string;
  tenantId: string;
  platform: string;
  accessToken?: string;
  refreshToken?: string;
  credentialVersion?: string;
  credentialState?: string;
  credentialRevision?: number;
  status?: string;
};

function context(input: Omit<CredentialContext, 'scope'> & { scope: CredentialContext['scope'] }): CredentialContext {
  return input;
}

export function tenantPlatformCredentialContext(
  record: Pick<TenantPlatformCredentialRecord, 'id' | 'tenant_id' | 'platform'>,
  field: TenantPlatformCredentialField,
): CredentialContext {
  return context({
    scope: 'tenant_platform_app',
    tenantId: record.tenant_id,
    recordId: record.id,
    platform: record.platform,
    field,
  });
}

export function tenantPlatformSecret(
  record: Pick<TenantPlatformCredentialRecord, 'id' | 'tenant_id' | 'platform'> & Partial<Record<TenantPlatformCredentialField, string>>,
  field: TenantPlatformCredentialField,
): string {
  const result = decryptCredential(record[field], tenantPlatformCredentialContext(record, field));
  return result.ok ? result.value : '';
}

export function tenantPlatformSecretMask(
  record: Pick<TenantPlatformCredentialRecord, 'id' | 'tenant_id' | 'platform'> & Partial<Record<TenantPlatformCredentialField, string>>,
  field: TenantPlatformCredentialField,
): string {
  return credentialMask(record[field], tenantPlatformCredentialContext(record, field));
}

export function sealTenantPlatformSecret(
  record: Pick<TenantPlatformCredentialRecord, 'id' | 'tenant_id' | 'platform'>,
  field: TenantPlatformCredentialField,
  plaintext: string,
): string {
  return encryptCredential(plaintext, tenantPlatformCredentialContext(record, field));
}

function youtubeContext(record: Pick<YouTubeCredentialRecord, 'id' | 'tenantId'>, field: string): CredentialContext {
  return context({
    scope: 'youtube_account',
    tenantId: record.tenantId,
    recordId: record.id,
    platform: 'youtube',
    field,
  });
}

function socialContext(record: Pick<SocialCredentialRecord, 'id' | 'tenantId' | 'platform'>, field: string): CredentialContext {
  return context({
    scope: 'social_account',
    tenantId: record.tenantId,
    recordId: record.id,
    platform: record.platform,
    field,
  });
}

export function sealYouTubeAccountCredentials(
  record: Pick<YouTubeCredentialRecord, 'id' | 'tenantId'>,
  input: { clientSecret: string; refreshToken: string; accessToken?: string },
): Pick<YouTubeCredentialRecord, 'clientSecret' | 'refreshToken' | 'accessToken' | 'credentialVersion' | 'credentialState'> {
  return {
    clientSecret: encryptCredential(input.clientSecret, youtubeContext(record, 'clientSecret')),
    refreshToken: encryptCredential(input.refreshToken, youtubeContext(record, 'refreshToken')),
    accessToken: input.accessToken ? encryptCredential(input.accessToken, youtubeContext(record, 'accessToken')) : '',
    credentialVersion: CREDENTIAL_ENVELOPE_VERSION,
    credentialState: 'ready',
  };
}

export function sealSocialAccountCredentials(
  record: Pick<SocialCredentialRecord, 'id' | 'tenantId' | 'platform'>,
  input: { accessToken: string; refreshToken?: string },
): Pick<SocialCredentialRecord, 'accessToken' | 'refreshToken' | 'credentialVersion' | 'credentialState'> {
  return {
    accessToken: encryptCredential(input.accessToken, socialContext(record, 'accessToken')),
    refreshToken: input.refreshToken ? encryptCredential(input.refreshToken, socialContext(record, 'refreshToken')) : '',
    credentialVersion: CREDENTIAL_ENVELOPE_VERSION,
    credentialState: 'ready',
  };
}

function decryptRequired(value: unknown, aad: CredentialContext): string | null {
  const result = decryptCredential(value, aad);
  return result.ok ? result.value : null;
}

function decryptOptional(value: unknown, aad: CredentialContext): string | null {
  if (!value) return '';
  const result = decryptCredential(value, aad);
  return result.ok ? result.value : null;
}

async function quarantineAccountCredentials(
  collection: 'youtube_accounts' | 'social_accounts',
  record: YouTubeCredentialRecord | SocialCredentialRecord,
  fields: string[],
): Promise<void> {
  const revision = Number(record.credentialRevision || 0);
  const expected: Record<string, string | number | boolean> = record.credentialRevision === undefined
    ? { status: String(record.status || '') }
    : { credentialRevision: revision };
  const cleared = Object.fromEntries(fields.map(field => [field, '']));
  await store.compareAndSet(collection, record.id, expected, {
    ...cleared,
    status: 'expired',
    credentialVersion: CREDENTIAL_ENVELOPE_VERSION,
    credentialState: 'reconnect_required',
    credentialRevision: revision + 1,
  }).catch(() => ({ ok: false as const, reason: 'conflict' as const }));
}

export async function youtubeAccountCredentials(record: YouTubeCredentialRecord): Promise<{
  clientSecret: string;
  refreshToken: string;
  accessToken?: string;
}> {
  const clientSecret = decryptRequired(record.clientSecret, youtubeContext(record, 'clientSecret'));
  const refreshToken = decryptRequired(record.refreshToken, youtubeContext(record, 'refreshToken'));
  const accessToken = decryptOptional(record.accessToken, youtubeContext(record, 'accessToken'));
  if (clientSecret === null || refreshToken === null || accessToken === null) {
    await quarantineAccountCredentials('youtube_accounts', record, ['clientSecret', 'refreshToken', 'accessToken']);
    throw new Error('account_credentials_reconnect_required');
  }
  return { clientSecret, refreshToken, accessToken: accessToken || undefined };
}

export async function socialAccountCredentials(record: SocialCredentialRecord): Promise<{
  accessToken: string;
  refreshToken?: string;
}> {
  const accessToken = decryptRequired(record.accessToken, socialContext(record, 'accessToken'));
  const refreshToken = decryptOptional(record.refreshToken, socialContext(record, 'refreshToken'));
  if (accessToken === null || refreshToken === null) {
    await quarantineAccountCredentials('social_accounts', record, ['accessToken', 'refreshToken']);
    throw new Error('account_credentials_reconnect_required');
  }
  return { accessToken, refreshToken: refreshToken || undefined };
}

export async function quarantineInvalidTenantPlatformCredentials<T extends TenantPlatformCredentialRecord>(record: T): Promise<T> {
  const credentialFields: TenantPlatformCredentialField[] = ['app_secret', 'access_token', 'wecom_encoding_aes_key'];
  if (record.platform === 'wecom') credentialFields.push('webhook_verify_token');
  const invalidFields = credentialFields.filter(field => {
    const value = record[field];
    return Boolean(value) && !decryptCredential(value, tenantPlatformCredentialContext(record, field)).ok;
  });
  if (!invalidFields.length) return record;

  const revision = Number(record.credential_revision || 0);
  const expected: Record<string, string | number | boolean> = record.credential_revision === undefined
    ? { status: String(record.status || '') }
    : { credential_revision: revision };
  const patch = {
    ...Object.fromEntries(invalidFields.map(field => [field, ''])),
    status: 'error',
    credential_version: CREDENTIAL_ENVELOPE_VERSION,
    credential_state: 'reconnect_required',
    credential_revision: revision + 1,
  };
  const result = await store.compareAndSet<T>('tenant_platform_apps', record.id, expected, patch)
    .catch(() => ({ ok: false as const, reason: 'conflict' as const }));
  return result.ok ? result.record : { ...record, ...patch } as T;
}
