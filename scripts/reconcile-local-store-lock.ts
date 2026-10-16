import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalStoreLockRecovery } from '../server/storage/localStoreLockRecovery.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const service = createLocalStoreLockRecovery({ repoRoot: root, storeRoot: path.join(root, 'data/local-store'), auditRoot: path.join(root, 'data/acceptance/local-store-lock-recovery') });
if (!process.argv.includes('--apply')) {
  console.log(JSON.stringify({ mode: 'dry_run', ...service.inspect(), notice: 'Read-only. No lock, JSON, business lease, cost or runtime was changed. Apply needs verified all-user or filesystem-owner-restricted writer evidence, no active store users and an exact snapshot hash.' }, null, 2));
} else {
  const index = process.argv.indexOf('--expected-snapshot-hash');
  console.log(JSON.stringify(service.apply(index >= 0 ? process.argv[index + 1] ?? '' : ''), null, 2));
}
