import assert from 'node:assert/strict';
import {
  parseProcessRole,
  processRoleStartsBackgroundJobs,
  processRoleStartsHttp,
  type ProcessRole,
} from './processRole.js';

const previousSplitEnabled = process.env.PROCESS_ROLE_SPLIT_ENABLED;
try {
  delete process.env.PROCESS_ROLE_SPLIT_ENABLED;
  assert.equal(parseProcessRole(undefined), 'all');
  assert.equal(parseProcessRole(''), 'all');
  assert.equal(parseProcessRole('   '), 'all');
  assert.equal(parseProcessRole(' all '), 'all');
  assert.throws(
    () => parseProcessRole('web'),
    /web\/worker process splitting requires the persistent queue and scheduler migration first/,
  );
  assert.throws(
    () => parseProcessRole('worker'),
    /PROCESS_ROLE_SPLIT_ENABLED=true/,
  );

  process.env.PROCESS_ROLE_SPLIT_ENABLED = 'false';
  assert.throws(() => parseProcessRole('web'), /PROCESS_ROLE="web" is disabled/);

  process.env.PROCESS_ROLE_SPLIT_ENABLED = 'true';
  assert.equal(parseProcessRole('web'), 'web');
  assert.equal(parseProcessRole('worker'), 'worker');
  assert.equal(parseProcessRole(' worker '), 'worker');
  assert.throws(
    () => parseProcessRole('api'),
    /Invalid PROCESS_ROLE "api"; expected one of: all, web, worker/,
  );
  assert.throws(() => parseProcessRole('WEB'), /Invalid PROCESS_ROLE/);
} finally {
  if (previousSplitEnabled === undefined) delete process.env.PROCESS_ROLE_SPLIT_ENABLED;
  else process.env.PROCESS_ROLE_SPLIT_ENABLED = previousSplitEnabled;
}

const expectations: Record<ProcessRole, { http: boolean; backgroundJobs: boolean }> = {
  all: { http: true, backgroundJobs: true },
  web: { http: true, backgroundJobs: false },
  worker: { http: false, backgroundJobs: true },
};

for (const [role, expected] of Object.entries(expectations) as Array<[ProcessRole, typeof expectations[ProcessRole]]>) {
  assert.equal(processRoleStartsHttp(role), expected.http, `${role} HTTP startup decision`);
  assert.equal(processRoleStartsBackgroundJobs(role), expected.backgroundJobs, `${role} background job startup decision`);
}

console.log('process role tests passed');
