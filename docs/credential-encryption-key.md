# CREDENTIAL_ENCRYPTION_KEY

`CREDENTIAL_ENCRYPTION_KEY` is the independent master key for global OAuth client secrets, tenant platform application secrets, and connected YouTube / Meta / TikTok / WhatsApp account tokens.

Generate a dedicated 32-byte value and store it in the production secret manager:

```bash
openssl rand -base64 32
```

Use either the raw OpenSSL output, `base64:<value>`, `hex:<64-hex-characters>`, or a raw UTF-8 secret of at least 32 bytes. Never reuse `TENANT_PLATFORM_APP_KEY`, `OAUTH_STATE_SECRET`, database passwords, or API tokens. Production startup validates the decoded key length and refuses malformed values.

Every stored value is an AES-256-GCM `cred:v1` envelope with a random nonce. Its authenticated data binds the ciphertext to its tenant, record, platform, field, and scope. Moving a ciphertext to another record or field makes authentication fail closed.

## Legacy migration

Migration `1788307205_encrypt_platform_credentials.js` does not trust or copy legacy plaintext and old context-free `v1:` ciphertext. It clears those values, changes connected accounts to `expired` / tenant apps to `error`, and records `reconnect_required`. Operators must reconnect through the platform's OAuth flow or re-enter the application secret. Unknown versions and authentication failures are handled the same way at runtime.

Global `data/oauth-config.json` plaintext is ignored rather than decrypted. Re-enter each global application secret in the admin UI; the next write uses a `0600` temporary file, fsync, revision check, and atomic rename. Remove unencrypted historical copies and rotate any secret that may have appeared in a backup or log.

Back up the key separately from encrypted application data. Losing it requires reconnecting every provider account. A rotation procedure must decrypt and re-encrypt under a controlled offline job with per-record compare-and-set; changing the environment value by itself intentionally makes existing envelopes unusable.
