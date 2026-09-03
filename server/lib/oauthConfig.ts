import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { validProductionPublicBaseUrl } from '../ops/productionConfig.js';
import {
  CREDENTIAL_ENVELOPE_VERSION,
  credentialMask,
  decryptCredential,
  encryptCredential,
  type CredentialContext,
} from '../security/credentialEnvelope.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(__dirname, '../../data/oauth-config.json');
const CONFIG_LOCK_FILE = `${CONFIG_FILE}.lock`;

export type OAuthPlatform = 'youtube' | 'meta' | 'tiktok';

export interface StoredOAuthConfig {
  youtubeOAuthClientId?: string;
  youtubeOAuthClientSecret?: string;
  metaSocialAppId?: string;
  metaSocialAppSecret?: string;
  tiktokClientKey?: string;
  tiktokClientSecret?: string;
  disabledPlatforms?: OAuthPlatform[];
  advancedManualConnectEnabled?: boolean;
  updatedAt?: string;
  revision?: number;
  credentialVersion?: string;
  credentialState?: Partial<Record<OAuthPlatform, 'ready' | 'reconnect_required'>>;
}

export interface EffectiveOAuthConfig {
  youtubeOAuthClientId: string;
  youtubeOAuthClientSecret: string;
  metaSocialAppId: string;
  metaSocialAppSecret: string;
  tiktokClientKey: string;
  tiktokClientSecret: string;
  advancedManualConnectEnabled: boolean;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function envText(key: string): string {
  return text(process.env[key]);
}

function platformDisabled(config: StoredOAuthConfig, platform: OAuthPlatform): boolean {
  return (Array.isArray(config.disabledPlatforms) && config.disabledPlatforms.includes(platform))
    || config.credentialState?.[platform] === 'reconnect_required';
}

export function parseStoredOAuthConfig(raw: string): StoredOAuthConfig {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error('oauth_config_invalid_json'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('oauth_config_invalid_shape');
  const config = parsed as StoredOAuthConfig;
  if (config.revision !== undefined && (!Number.isSafeInteger(config.revision) || Number(config.revision) < 0)) {
    throw new Error('oauth_config_invalid_revision');
  }
  if (config.disabledPlatforms !== undefined && (!Array.isArray(config.disabledPlatforms)
    || config.disabledPlatforms.some(platform => !['youtube', 'meta', 'tiktok'].includes(String(platform))))) {
    throw new Error('oauth_config_invalid_disabled_platforms');
  }
  if (config.credentialState !== undefined && (!config.credentialState || typeof config.credentialState !== 'object'
    || Array.isArray(config.credentialState)
    || Object.entries(config.credentialState).some(([platform, state]) =>
      !['youtube', 'meta', 'tiktok'].includes(platform) || !['ready', 'reconnect_required'].includes(String(state))))) {
    throw new Error('oauth_config_invalid_credential_state');
  }
  return config;
}

function secretContext(platform: OAuthPlatform, field: string): CredentialContext {
  return {
    scope: 'oauth_config',
    tenantId: 'global',
    recordId: 'oauth-config',
    platform,
    field,
  };
}

function storedSecret(value: unknown, platform: OAuthPlatform, field: string): string {
  const result = decryptCredential(value, secretContext(platform, field));
  return result.ok ? result.value : '';
}

export function oauthSecretMask(value: unknown, platform: OAuthPlatform, field: string): string {
  return credentialMask(value, secretContext(platform, field));
}

function acquireConfigLock(): number {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = fs.openSync(CONFIG_LOCK_FILE, 'wx', 0o600);
      fs.writeFileSync(descriptor, `${process.pid} ${Date.now()}\n`, 'utf8');
      fs.fsyncSync(descriptor);
      return descriptor;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw error;
      try {
        const age = Date.now() - fs.statSync(CONFIG_LOCK_FILE).mtimeMs;
        if (age > 60_000) {
          fs.unlinkSync(CONFIG_LOCK_FILE);
          continue;
        }
      } catch (lockError) {
        if ((lockError as NodeJS.ErrnoException).code === 'ENOENT') continue;
      }
      throw new Error('oauth_config_write_conflict');
    }
  }
  throw new Error('oauth_config_write_conflict');
}

function persistConfigAtomically(config: StoredOAuthConfig): void {
  const temporary = `${CONFIG_FILE}.${process.pid}-${randomUUID()}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(descriptor, JSON.stringify(config, null, 2), 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, CONFIG_FILE);
    fs.chmodSync(CONFIG_FILE, 0o600);
    try {
      const directory = fs.openSync(path.dirname(CONFIG_FILE), 'r');
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    } catch {
      // Some filesystems do not support fsync on directories.
    }
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* best effort */ }
    }
    try { fs.unlinkSync(temporary); } catch { /* rename succeeded or cleanup best effort */ }
  }
}

export function readOAuthConfig(): StoredOAuthConfig {
  let metadata: fs.Stats;
  try { metadata = fs.lstatSync(CONFIG_FILE); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(`oauth_config_unreadable:${String((error as NodeJS.ErrnoException).code || 'unknown')}`);
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 1024 * 1024) {
    throw new Error('oauth_config_file_invalid');
  }
  if (process.env.NODE_ENV === 'production') {
    if ((metadata.mode & 0o077) !== 0) throw new Error('oauth_config_permissions_insecure');
    if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) throw new Error('oauth_config_owner_invalid');
  }
  let raw: string;
  try { raw = fs.readFileSync(CONFIG_FILE, 'utf8'); }
  catch (error) { throw new Error(`oauth_config_unreadable:${String((error as NodeJS.ErrnoException).code || 'unknown')}`); }
  return parseStoredOAuthConfig(raw);
}

export function oauthConfigurationHealthCheck(): { ok: boolean; message?: string } {
  try {
    readOAuthConfig();
    return { ok: true };
  } catch (error) {
    return { ok: false, message: String((error as Error)?.message || 'oauth_config_invalid').slice(0, 160) };
  }
}

export function writeOAuthConfig(patch: Partial<StoredOAuthConfig>, expectedRevision?: number): StoredOAuthConfig {
  const lock = acquireConfigLock();
  try {
    const current = readOAuthConfig();
    const revision = Number(current.revision || 0);
    if (expectedRevision !== undefined && revision !== expectedRevision) throw new Error('oauth_config_write_conflict');
    const sanitizedCurrent: StoredOAuthConfig = { ...current };
    const disabled = new Set(current.disabledPlatforms ?? []);
    const forcedReconnect = new Set<OAuthPlatform>();
    const credentialState: Partial<Record<OAuthPlatform, 'ready' | 'reconnect_required'>> = { ...current.credentialState };
    const definitions: Array<{ platform: OAuthPlatform; field: keyof StoredOAuthConfig }> = [
      { platform: 'youtube', field: 'youtubeOAuthClientSecret' },
      { platform: 'meta', field: 'metaSocialAppSecret' },
      { platform: 'tiktok', field: 'tiktokClientSecret' },
    ];
    for (const definition of definitions) {
      const raw = sanitizedCurrent[definition.field];
      if (!raw) continue;
      if (!decryptCredential(raw, secretContext(definition.platform, String(definition.field))).ok) {
        (sanitizedCurrent as Record<string, unknown>)[definition.field] = '';
        disabled.add(definition.platform);
        forcedReconnect.add(definition.platform);
        credentialState[definition.platform] = 'reconnect_required';
      }
    }
    const protectedPatch = { ...patch };
    if (patch.youtubeOAuthClientSecret) {
      protectedPatch.youtubeOAuthClientSecret = encryptCredential(
        patch.youtubeOAuthClientSecret,
        secretContext('youtube', 'youtubeOAuthClientSecret'),
      );
      credentialState.youtube = 'ready';
      forcedReconnect.delete('youtube');
    }
    if (patch.metaSocialAppSecret) {
      protectedPatch.metaSocialAppSecret = encryptCredential(
        patch.metaSocialAppSecret,
        secretContext('meta', 'metaSocialAppSecret'),
      );
      credentialState.meta = 'ready';
      forcedReconnect.delete('meta');
    }
    if (patch.tiktokClientSecret) {
      protectedPatch.tiktokClientSecret = encryptCredential(
        patch.tiktokClientSecret,
        secretContext('tiktok', 'tiktokClientSecret'),
      );
      credentialState.tiktok = 'ready';
      forcedReconnect.delete('tiktok');
    }
    const finalDisabled = new Set(patch.disabledPlatforms ?? Array.from(disabled));
    for (const platform of forcedReconnect) finalDisabled.add(platform);
    if (patch.youtubeOAuthClientSecret) finalDisabled.delete('youtube');
    if (patch.metaSocialAppSecret) finalDisabled.delete('meta');
    if (patch.tiktokClientSecret) finalDisabled.delete('tiktok');
    const next: StoredOAuthConfig = {
      ...sanitizedCurrent,
      ...protectedPatch,
      disabledPlatforms: Array.from(finalDisabled),
      updatedAt: new Date().toISOString(),
      revision: revision + 1,
      credentialVersion: CREDENTIAL_ENVELOPE_VERSION,
      credentialState,
    };
    persistConfigAtomically(next);
    return next;
  } finally {
    try { fs.closeSync(lock); } catch { /* best effort */ }
    try { fs.unlinkSync(CONFIG_LOCK_FILE); } catch { /* best effort */ }
  }
}

export function effectiveOAuthConfig(): EffectiveOAuthConfig {
  const stored = readOAuthConfig();
  const youtubeDisabled = platformDisabled(stored, 'youtube');
  const metaDisabled = platformDisabled(stored, 'meta');
  const tiktokDisabled = platformDisabled(stored, 'tiktok');
  return {
    youtubeOAuthClientId: youtubeDisabled ? '' : text(stored.youtubeOAuthClientId) || envText('YOUTUBE_OAUTH_CLIENT_ID'),
    youtubeOAuthClientSecret: youtubeDisabled ? '' : stored.youtubeOAuthClientSecret
      ? storedSecret(stored.youtubeOAuthClientSecret, 'youtube', 'youtubeOAuthClientSecret')
      : envText('YOUTUBE_OAUTH_CLIENT_SECRET'),
    metaSocialAppId: metaDisabled ? '' : text(stored.metaSocialAppId) || envText('META_SOCIAL_APP_ID') || envText('WHATSAPP_EMBEDDED_SIGNUP_APP_ID'),
    metaSocialAppSecret: metaDisabled ? '' : stored.metaSocialAppSecret
      ? storedSecret(stored.metaSocialAppSecret, 'meta', 'metaSocialAppSecret')
      : envText('META_SOCIAL_APP_SECRET') || envText('WHATSAPP_EMBEDDED_SIGNUP_APP_SECRET'),
    tiktokClientKey: tiktokDisabled ? '' : text(stored.tiktokClientKey) || envText('TIKTOK_CLIENT_KEY'),
    tiktokClientSecret: tiktokDisabled ? '' : stored.tiktokClientSecret
      ? storedSecret(stored.tiktokClientSecret, 'tiktok', 'tiktokClientSecret')
      : envText('TIKTOK_CLIENT_SECRET'),
    advancedManualConnectEnabled: stored.advancedManualConnectEnabled ?? envText('ADVANCED_MANUAL_CONNECT_ENABLED') === 'true',
  };
}

export function getYouTubeOAuthClient(): { clientId: string; clientSecret: string } | null {
  const config = effectiveOAuthConfig();
  if (!config.youtubeOAuthClientId || !config.youtubeOAuthClientSecret) return null;
  return { clientId: config.youtubeOAuthClientId, clientSecret: config.youtubeOAuthClientSecret };
}

export function getMetaOAuthClient(): { appId: string; appSecret: string } | null {
  const config = effectiveOAuthConfig();
  if (!config.metaSocialAppId || !config.metaSocialAppSecret) return null;
  return { appId: config.metaSocialAppId, appSecret: config.metaSocialAppSecret };
}

export function getTikTokOAuthClient(): { clientKey: string; clientSecret: string } | null {
  const config = effectiveOAuthConfig();
  if (!config.tiktokClientKey || !config.tiktokClientSecret) return null;
  return { clientKey: config.tiktokClientKey, clientSecret: config.tiktokClientSecret };
}

export function advancedManualConnectEnabled(): boolean {
  return effectiveOAuthConfig().advancedManualConnectEnabled;
}

export function getPublicOrigin(req: Request): string {
  const configured = envText('PUBLIC_BASE_URL').replace(/\/$/, '');
  if (configured && validProductionPublicBaseUrl(configured)) return new URL(configured).origin;
  if (process.env.NODE_ENV === 'production') throw new Error('PUBLIC_BASE_URL is invalid for production');

  const forwardedProto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim();
  const proto = forwardedProto || req.protocol || 'http';
  const host = req.get('host') || `localhost:${process.env.PORT ?? 8788}`;
  return `${proto}://${host}`;
}

export function oauthCallbackUrls(req: Request) {
  const origin = getPublicOrigin(req);
  return {
    youtube: `${origin}/api/overseas/youtube/oauth/callback`,
    instagram: `${origin}/api/overseas/social/oauth/instagram/callback`,
    facebook: `${origin}/api/overseas/social/oauth/facebook/callback`,
    tiktok: `${origin}/api/overseas/social/oauth/tiktok/callback`,
  };
}

export async function getTenantAwareMetaOAuthClient(tenantId?: string): Promise<{ appId: string; appSecret: string } | null> {
  const { getTenantMetaOAuthClient } = await import('./tenantPlatformApps.js');
  return getTenantMetaOAuthClient(tenantId);
}

export async function getTenantAwareGoogleOAuthClient(tenantId?: string): Promise<{ clientId: string; clientSecret: string } | null> {
  const { getTenantGoogleOAuthClient } = await import('./tenantPlatformApps.js');
  return getTenantGoogleOAuthClient(tenantId);
}

export async function getTenantAwareTikTokOAuthClient(tenantId?: string): Promise<{ clientKey: string; clientSecret: string } | null> {
  const { getTenantTikTokOAuthClient } = await import('./tenantPlatformApps.js');
  return getTenantTikTokOAuthClient(tenantId);
}
