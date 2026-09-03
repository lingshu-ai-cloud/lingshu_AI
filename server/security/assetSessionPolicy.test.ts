import assert from 'node:assert/strict';
import fs from 'node:fs';
import { allowLegacyUnscopedAsset, isExplicitAssetRequest } from '../lib/assetAccess.js';

assert.equal(isExplicitAssetRequest('GET', '/media/tenants/t1/video.mp4'), true);
assert.equal(isExplicitAssetRequest('HEAD', '/api/overseas/videos/v1/thumbnail'), true);
assert.equal(isExplicitAssetRequest('GET', '/api/overseas/digital-employees/artifacts/p1/video'), true);
assert.equal(isExplicitAssetRequest('POST', '/media/tenants/t1/video.mp4'), false);
assert.equal(isExplicitAssetRequest('GET', '/api/overseas/admin/oauth-config'), false);
assert.equal(isExplicitAssetRequest('POST', '/api/overseas/publishing/posts'), false);

const previousNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'production';
assert.equal(allowLegacyUnscopedAsset({ userId: 'u1', tenantId: 't1' }), false, 'production must fail closed for unowned legacy root assets');
process.env.NODE_ENV = 'test';
assert.equal(allowLegacyUnscopedAsset({ userId: 'u1', tenantId: 't1' }), true, 'local development may retain authenticated legacy compatibility');
if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = previousNodeEnv;

const source = fs.readFileSync(new URL('../lib/assetAccess.ts', import.meta.url), 'utf8');
assert.match(source, /ASSET_SESSION_TTL_MS = 15 \* 60_000/);
assert.match(source, /encodeAssetSession\(identity\)/);
assert.doesNotMatch(source, /res\.cookie\(ASSET_SESSION_COOKIE,\s*token/);
assert.match(source, /if \(!isExplicitAssetRequest\(req\.method, req\.originalUrl \|\| req\.url\)\) return null/);
assert.match(source, /process\.env\.NODE_ENV !== 'production' && Boolean\(identity\)/);

const authSource = fs.readFileSync(new URL('../middleware/auth.ts', import.meta.url), 'utf8');
assert.match(authSource, /assetRequest \? await assetIdentity\(req\) : null/);
assert.match(authSource, /const signedMedia = assetRequest/);

console.log('short-lived, media-only asset session policy tests passed');
