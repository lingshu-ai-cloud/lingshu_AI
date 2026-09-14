import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./PlatformAdsPage.tsx', import.meta.url), 'utf8');

test('account entry and campaign import cannot retain a stale return-to-create state', () => {
  assert.match(source, /onClick=\{\(\) => \{ setReturnToCreate\(false\); setDialog\("accounts"\); \}\}/);
  assert.match(source, /onTaskImported=\{task => \{ setReturnToCreate\(false\);/);
});
