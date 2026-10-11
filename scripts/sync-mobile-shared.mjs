import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--check')) {
  console.error('Usage: node scripts/sync-mobile-shared.mjs [--check]');
  process.exit(2);
}

// Native WeChat packages cannot resolve modules outside the miniapp root.
// Keep generated copies checked in, and detect drift before either client builds.
for (const script of [
  'generate-design-tokens.mjs',
  'sync-mobile-domain.mjs',
  'generate-miniapp-request-policy.mjs',
]) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', script), ...args], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
