import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isPublicOrServiceAuthenticatedApiPath, requiredRolesForApiWrite } from '../middleware/apiAccessPolicy.js';

assert.equal(isPublicOrServiceAuthenticatedApiPath('POST', '/api/overseas/auth/login'), true);
assert.equal(isPublicOrServiceAuthenticatedApiPath('GET', '/api/webhooks/meta/tenant-1'), true);
assert.equal(isPublicOrServiceAuthenticatedApiPath('POST', '/api/v1/products/bulk'), true);
assert.equal(isPublicOrServiceAuthenticatedApiPath('GET', '/api/overseas/youtube/oauth/callback'), true);
assert.equal(isPublicOrServiceAuthenticatedApiPath('GET', '/api/assist-links/capability-token'), true);
assert.equal(isPublicOrServiceAuthenticatedApiPath('POST', '/api/assist-links/capability-token/start'), true);
assert.equal(isPublicOrServiceAuthenticatedApiPath('POST', '/api/assist-links/capability-token/complete'), false);
assert.equal(isPublicOrServiceAuthenticatedApiPath('POST', '/api/overseas/copywriting'), false);
assert.equal(isPublicOrServiceAuthenticatedApiPath('GET', '/api/overseas/channels'), false);
assert.equal(isPublicOrServiceAuthenticatedApiPath('POST', '/api/overseas/auth/employees'), false);

assert.deepEqual(requiredRolesForApiWrite('/api/overseas/enterprise/profile'), ['super_admin', 'admin']);
assert.deepEqual(requiredRolesForApiWrite('/api/overseas/enterprise/product-api/rotate'), ['super_admin', 'admin']);
assert.deepEqual(requiredRolesForApiWrite('/api/oauth/whatsapp/exchange'), ['super_admin', 'admin']);
assert.deepEqual(requiredRolesForApiWrite('/api/overseas/support-access/settings'), ['super_admin', 'admin']);
assert.deepEqual(requiredRolesForApiWrite('/api/overseas/plugins/shopify/config'), ['super_admin', 'admin']);
assert.deepEqual(requiredRolesForApiWrite('/api/overseas/publishing/calendar'), ['super_admin', 'admin', 'social_operator']);
assert.deepEqual(requiredRolesForApiWrite('/api/overseas/studio/projects'), ['super_admin', 'admin', 'social_operator']);
assert.equal(requiredRolesForApiWrite('/api/overseas/customers/templates'), null);

const indexSource = fs.readFileSync(fileURLToPath(new URL('../index.ts', import.meta.url)), 'utf8');
const authBoundary = indexSource.indexOf("app.use('/api', apiAuthenticationBoundary)");
const firstLegacyRoute = indexSource.indexOf("app.use('/api/overseas/copywriting'");
assert.ok(authBoundary >= 0 && firstLegacyRoute > authBoundary, 'default API auth boundary must precede every business router');

const authMiddlewareSource = fs.readFileSync(fileURLToPath(new URL('../middleware/auth.ts', import.meta.url)), 'utf8');
assert.match(authMiddlewareSource, /supportAccess[\s\S]*\['GET', 'HEAD', 'OPTIONS'\][\s\S]*status\(403\)/, 'support sessions must be globally read-only');
console.log('default API authentication and role boundary tests passed');
