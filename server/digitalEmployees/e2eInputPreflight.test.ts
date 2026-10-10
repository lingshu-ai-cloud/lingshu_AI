import assert from 'node:assert/strict';
import { requireLocalAcceptanceUrl } from './e2eInputPreflight.js';
for (const url of ['http://localhost:8790/api/overseas', 'http://127.0.0.1:8790/api/overseas', 'http://[::1]:8790/api/overseas']) assert.doesNotThrow(() => requireLocalAcceptanceUrl(url));
for (const url of ['https://internal.example.test/api/overseas', 'https://localhost.example.test', 'file:///tmp/app', 'https://localhost@production.example.test']) assert.throws(() => requireLocalAcceptanceUrl(url));
console.log('Acceptance endpoint isolation tests passed');

const { assetAuthorization } = await import('./contentProduction.js');
assert.deepEqual(assetAuthorization({ licenseEvidence: 'Pexels License; https://www.pexels.com/license/' }, 'enterprise_product'), {
  status: 'licensed', scope: 'tenant', evidence: 'Pexels License; https://www.pexels.com/license/',
});
assert.equal(assetAuthorization({}, 'enterprise_product').status, 'owned');
assert.equal(assetAuthorization({}, 'licensed_shared_material').status, 'unknown');
console.log('Uploaded licensed asset provenance tests passed');
