import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeOrganizationRole, strictOrganizationRole } from '../routes/auth.js';

assert.equal(strictOrganizationRole('super_admin'), 'super_admin');
assert.equal(strictOrganizationRole('admin'), 'admin');
assert.equal(strictOrganizationRole(undefined), null, 'missing roles must never acquire administrator authority');
assert.equal(strictOrganizationRole('owner'), null, 'unknown roles must fail closed');
assert.equal(normalizeOrganizationRole(undefined), 'customer_service', 'legacy display fallback must be least privilege');
assert.equal(normalizeOrganizationRole('unexpected'), 'customer_service');

const authSource = fs.readFileSync(fileURLToPath(new URL('../routes/auth.ts', import.meta.url)), 'utf8');
for (const route of [
  "authRouter.post('/employees'",
  "authRouter.patch('/employees/:employeeId/role'",
  "authRouter.delete('/employees/:employeeId'",
]) {
  const start = authSource.indexOf(route);
  assert.ok(start >= 0, `${route} must exist`);
  const block = authSource.slice(start, start + 1_000);
  assert.match(block, /identity\.supportAccess[\s\S]*status\(403\)/, `${route} must keep support sessions read-only`);
  assert.match(block, /requestOrganizationRoleStrict[\s\S]*super_admin/, `${route} must use strict role lookup`);
}
console.log('organization role fail-closed policy tests passed');
