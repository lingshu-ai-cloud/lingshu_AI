import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AccountAuditLog } from './audit.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'account-hub-audit-'));
try {
  const audit = new AccountAuditLog(root);
  await Promise.all([
    audit.record({ actorId: 'admin_one', action: 'POST', target: '/accounts', status: 201 }),
    audit.record({ actorId: 'admin_one', action: 'POST', target: '/accounts/acct/local-release', status: 200 }),
  ]);
  const lines = (await fs.readFile(audit.file, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
  assert.equal(lines.length, 2);
  assert.equal(lines[0]?.actorId, 'admin_one');
  assert.equal(lines[1]?.target, '/accounts/acct/local-release');
  assert.equal((await fs.stat(audit.file)).mode & 0o777, 0o600);
  assert.equal(JSON.stringify(lines).includes('body'), false);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

console.log('account hub audit tests passed');
