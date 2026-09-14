import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Request } from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = process.env.NODE_ENV === 'test' && process.env.OAUTH_CONFIG_FILE
  ? path.resolve(process.env.OAUTH_CONFIG_FILE)
  : path.join(__dirname, '../../data/oauth-config.json');

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

export class OAuthConfigUnavailableError extends Error {
  readonly code = 'oauth_config_unavailable';

  constructor(cause?: unknown) {
    super('OAuth configuration storage is unavailable', { cause });
    this.name = 'OAuthConfigUnavailableError';
  }
}

const allowedKeys = new Set([
  'youtubeOAuthClientId', 'youtubeOAuthClientSecret', 'metaSocialAppId', 'metaSocialAppSecret',
  'tiktokClientKey', 'tiktokClientSecret', 'disabledPlatforms', 'advancedManualConnectEnabled', 'updatedAt',
]);
const oauthPlatforms = new Set<OAuthPlatform>(['youtube', 'meta', 'tiktok']);
let mutationQueue: Promise<void> = Promise.resolve();

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function envText(key: string): string {
  return text(process.env[key]);
}

function platformDisabled(config: StoredOAuthConfig, platform: OAuthPlatform): boolean {
  return Array.isArray(config.disabledPlatforms) && config.disabledPlatforms.includes(platform);
}

function isStoredOAuthConfig(value: unknown): value is StoredOAuthConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!Object.keys(record).every(key => allowedKeys.has(key))) return false;
  const stringKeys = [...allowedKeys].filter(key => !['disabledPlatforms', 'advancedManualConnectEnabled'].includes(key));
  if (!stringKeys.every(key => record[key] === undefined || typeof record[key] === 'string')) return false;
  if (record.advancedManualConnectEnabled !== undefined && typeof record.advancedManualConnectEnabled !== 'boolean') return false;
  return record.disabledPlatforms === undefined
    || (Array.isArray(record.disabledPlatforms) && record.disabledPlatforms.every(platform => oauthPlatforms.has(platform as OAuthPlatform)));
}

function unavailable(error: unknown): OAuthConfigUnavailableError {
  return error instanceof OAuthConfigUnavailableError ? error : new OAuthConfigUnavailableError(error);
}

function readJson(file: string): StoredOAuthConfig {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return {};
    throw unavailable(error);
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isStoredOAuthConfig(parsed)) throw new Error('invalid OAuth config schema');
    return parsed;
  } catch (error) {
    throw unavailable(error);
  }
}

export function readOAuthConfig(): StoredOAuthConfig {
  return readJson(CONFIG_FILE);
}

function writeAtomic(config: StoredOAuthConfig): void {
  if (!isStoredOAuthConfig(config)) throw unavailable(new Error('invalid OAuth config schema'));
  const directory = path.dirname(CONFIG_FILE);
  const temporaryFile = path.join(directory, `.${path.basename(CONFIG_FILE)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    descriptor = fs.openSync(temporaryFile, 'wx', 0o600);
    fs.writeFileSync(descriptor, JSON.stringify(config, null, 2), 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.chmodSync(temporaryFile, 0o600);
    fs.renameSync(temporaryFile, CONFIG_FILE);
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* best-effort cleanup */ }
    }
    try { fs.unlinkSync(temporaryFile); } catch { /* best-effort cleanup */ }
    throw unavailable(error);
  }
}

export async function writeOAuthConfig(patch: Partial<StoredOAuthConfig>): Promise<StoredOAuthConfig> {
  const operation = mutationQueue.catch(() => undefined).then(() => {
    const next = { ...readOAuthConfig(), ...patch, updatedAt: new Date().toISOString() };
    writeAtomic(next);
    return next;
  });
  mutationQueue = operation.then(() => undefined, () => undefined);
  try { return await operation; }
  catch (error) { throw unavailable(error); }
}

export function effectiveOAuthConfig(stored: StoredOAuthConfig = readOAuthConfig()): EffectiveOAuthConfig {
  const youtubeDisabled = platformDisabled(stored, 'youtube');
  const metaDisabled = platformDisabled(stored, 'meta');
  const tiktokDisabled = platformDisabled(stored, 'tiktok');
  return {
    youtubeOAuthClientId: youtubeDisabled ? '' : text(stored.youtubeOAuthClientId) || envText('YOUTUBE_OAUTH_CLIENT_ID'),
    youtubeOAuthClientSecret: youtubeDisabled ? '' : text(stored.youtubeOAuthClientSecret) || envText('YOUTUBE_OAUTH_CLIENT_SECRET'),
    metaSocialAppId: metaDisabled ? '' : text(stored.metaSocialAppId) || envText('META_SOCIAL_APP_ID') || envText('WHATSAPP_EMBEDDED_SIGNUP_APP_ID'),
    metaSocialAppSecret: metaDisabled ? '' : text(stored.metaSocialAppSecret) || envText('META_SOCIAL_APP_SECRET') || envText('WHATSAPP_EMBEDDED_SIGNUP_APP_SECRET'),
    tiktokClientKey: tiktokDisabled ? '' : text(stored.tiktokClientKey) || envText('TIKTOK_CLIENT_KEY'),
    tiktokClientSecret: tiktokDisabled ? '' : text(stored.tiktokClientSecret) || envText('TIKTOK_CLIENT_SECRET'),
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
  if (configured && !configured.includes('your-domain.com')) return configured;

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
