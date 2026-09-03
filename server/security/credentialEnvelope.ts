import crypto from 'node:crypto';

export const CREDENTIAL_ENVELOPE_VERSION = 'cred:v1';
export const CREDENTIAL_ENCRYPTION_KEY_ENV = 'CREDENTIAL_ENCRYPTION_KEY';

export type CredentialContext = {
  scope: 'oauth_config' | 'tenant_platform_app' | 'youtube_account' | 'social_account' | 'plugin_config' | 'publish_operation';
  tenantId: string;
  recordId: string;
  platform: string;
  field: string;
};

export type CredentialDecryptResult =
  | { ok: true; value: string }
  | {
      ok: false;
      reason:
        | 'empty'
        | 'legacy_plaintext'
        | 'unknown_version'
        | 'key_unavailable'
        | 'key_mismatch'
        | 'invalid_envelope'
        | 'authentication_failed';
    };

const LOCAL_DEVELOPMENT_KEY = 'lingshu-local-only-credential-envelope-key-v1';
const KEY_ID_BYTES = 9;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requireContext(context: CredentialContext): CredentialContext {
  const normalized = {
    scope: context.scope,
    tenantId: text(context.tenantId),
    recordId: text(context.recordId),
    platform: text(context.platform).toLowerCase(),
    field: text(context.field),
  };
  if (!normalized.scope || !normalized.tenantId || !normalized.recordId || !normalized.platform || !normalized.field) {
    throw new Error('credential_context_incomplete');
  }
  return normalized;
}

function configuredMasterKey(): string {
  const configured = text(process.env[CREDENTIAL_ENCRYPTION_KEY_ENV]);
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') throw new Error('credential_encryption_key_unavailable');
  return LOCAL_DEVELOPMENT_KEY;
}

function decodeMasterKey(raw: string): Buffer {
  if (raw.startsWith('base64:')) {
    const encoded = raw.slice('base64:'.length);
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
      throw new Error('credential_encryption_key_invalid');
    }
    const decoded = Buffer.from(encoded, 'base64');
    if (decoded.length < 32) throw new Error('credential_encryption_key_too_short');
    return decoded;
  }
  if (raw.startsWith('hex:')) {
    const encoded = raw.slice('hex:'.length);
    if (!/^[a-f0-9]+$/i.test(encoded) || encoded.length % 2 !== 0) throw new Error('credential_encryption_key_invalid');
    const decoded = Buffer.from(encoded, 'hex');
    if (decoded.length < 32) throw new Error('credential_encryption_key_too_short');
    return decoded;
  }
  if (/^[a-f0-9]{64,}$/i.test(raw) && raw.length % 2 === 0) {
    const decoded = Buffer.from(raw, 'hex');
    if (decoded.length < 32) throw new Error('credential_encryption_key_too_short');
    return decoded;
  }
  if (Buffer.byteLength(raw, 'utf8') < 32) throw new Error('credential_encryption_key_too_short');
  return Buffer.from(raw, 'utf8');
}

export function validCredentialEncryptionKey(value: unknown): boolean {
  const raw = text(value);
  if (!raw) return false;
  try {
    return decodeMasterKey(raw).length >= 32;
  } catch {
    return false;
  }
}

function keyMaterial(): { key: Buffer; keyId: string } {
  const master = decodeMasterKey(configuredMasterKey());
  const key = crypto.hkdfSync(
    'sha256',
    master,
    Buffer.from('lingshu-credential-envelope-salt-v1'),
    Buffer.from('lingshu-platform-credentials'),
    32,
  );
  const keyId = crypto.createHash('sha256').update(master).digest().subarray(0, KEY_ID_BYTES).toString('base64url');
  return { key: Buffer.from(key), keyId };
}

function additionalAuthenticatedData(context: CredentialContext): Buffer {
  const normalized = requireContext(context);
  return Buffer.from(JSON.stringify({
    version: CREDENTIAL_ENVELOPE_VERSION,
    scope: normalized.scope,
    tenantId: normalized.tenantId,
    recordId: normalized.recordId,
    platform: normalized.platform,
    field: normalized.field,
  }), 'utf8');
}

export function isCredentialEnvelope(value: unknown): boolean {
  return text(value).startsWith(`${CREDENTIAL_ENVELOPE_VERSION}:`);
}

export function credentialMask(value: unknown, context: CredentialContext): string {
  return decryptCredential(value, context).ok ? '********' : '';
}

export function encryptCredential(value: string, context: CredentialContext): string {
  const plaintext = text(value);
  if (!plaintext) return '';
  const { key, keyId } = keyMaterial();
  const nonce = crypto.randomBytes(NONCE_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(additionalAuthenticatedData(context));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    CREDENTIAL_ENVELOPE_VERSION,
    keyId,
    nonce.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

export function decryptCredential(value: unknown, context: CredentialContext): CredentialDecryptResult {
  const envelope = text(value);
  if (!envelope) return { ok: false, reason: 'empty' };
  if (!envelope.startsWith('cred:')) return { ok: false, reason: 'legacy_plaintext' };
  if (!envelope.startsWith(`${CREDENTIAL_ENVELOPE_VERSION}:`)) return { ok: false, reason: 'unknown_version' };

  const parts = envelope.split(':');
  if (parts.length !== 6 || parts[0] !== 'cred' || parts[1] !== 'v1') {
    return { ok: false, reason: 'invalid_envelope' };
  }

  let material: ReturnType<typeof keyMaterial>;
  try {
    material = keyMaterial();
  } catch {
    return { ok: false, reason: 'key_unavailable' };
  }
  const [, , keyId, nonceRaw, tagRaw, ciphertextRaw] = parts;
  if (keyId !== material.keyId) return { ok: false, reason: 'key_mismatch' };

  try {
    const nonce = Buffer.from(nonceRaw, 'base64url');
    const tag = Buffer.from(tagRaw, 'base64url');
    const ciphertext = Buffer.from(ciphertextRaw, 'base64url');
    if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES || ciphertext.length === 0) {
      return { ok: false, reason: 'invalid_envelope' };
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', material.key, nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(additionalAuthenticatedData(context));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8').trim();
    return plaintext ? { ok: true, value: plaintext } : { ok: false, reason: 'invalid_envelope' };
  } catch {
    return { ok: false, reason: 'authentication_failed' };
  }
}

export function requireCredential(value: unknown, context: CredentialContext): string {
  const result = decryptCredential(value, context);
  if (!result.ok) throw new Error('credential_reconnect_required');
  return result.value;
}
