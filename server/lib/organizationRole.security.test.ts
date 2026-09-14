import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeOrganizationRole,
  organizationRoleOrNull,
} from './organizationRole.js';

assert.equal(
  normalizeOrganizationRole(undefined),
  'customer_service',
  'a missing organization role must normalize to the least-privileged compatible role',
);
assert.equal(
  normalizeOrganizationRole('not-a-role'),
  'customer_service',
  'an invalid organization role must never normalize to tenant Owner',
);
assert.equal(normalizeOrganizationRole('super_admin'), 'super_admin');
assert.equal(organizationRoleOrNull(undefined), null);
assert.equal(organizationRoleOrNull('not-a-role'), null);

const root = process.cwd();
const authSource = fs.readFileSync(path.join(root, 'server/routes/auth.ts'), 'utf8');
const registrationRoute = authSource.slice(
  authSource.indexOf("authRouter.post('/register'"),
  authSource.indexOf('// POST /auth/login'),
);
assert.match(
  registrationRoute,
  /pbCreate\('users',[\s\S]*?role:\s*'super_admin'/,
  'the first user created from a one-use tenant invite must be assigned the tenant Owner compatibility role explicitly',
);

for (const file of ['src/App.tsx', 'src/components/Layout.tsx']) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  assert.doesNotMatch(
    source,
    /(?:user\.role|user\?\.role)\s*\|\|\s*['"]super_admin['"]/,
    `${file} must not elevate a cached session with no role to tenant Owner`,
  );
}

console.log('organization role fail-closed tests passed');
