import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('whole-film preflight reads the versioned local catalogue before network pricing fallbacks', () => {
  const source = fs.readFileSync(new URL('./socialContentProductionBudgetPreflight.ts', import.meta.url), 'utf8');
  const fixedReader = source.indexOf('await readFixedRuntimeTariff(intent)');
  const heygenFallback = source.indexOf("intent.provider==='heygen' && intent.stage==='tts' ? await readHeyGenPublishedTariff", fixedReader);
  const seedreamFallback = source.indexOf("intent.provider==='seedream'?await readSeedreamPublishedTariff", fixedReader);
  const wanFallback = source.indexOf("intent.provider==='wan'?await readWanPublishedTariff", fixedReader);
  assert.ok(fixedReader > 0 && heygenFallback > fixedReader && seedreamFallback > fixedReader && wanFallback > fixedReader);
  assert.match(source, /readNativeVoiceFixedPublishedTariff\(intent\)/);
});
