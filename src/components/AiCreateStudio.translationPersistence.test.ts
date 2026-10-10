import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { formatVoiceoverWithTimestamps } from './AiCreateStudio.js';

// Execute the restoration and invalidation code together to catch the React
// effect marking restored translations stale after the batched state update.
const transpile = (code: string) => ts.transpile(code, { target: ts.ScriptTarget.ES2022 });
const source = readFileSync(new URL('./AiCreateStudio.tsx', import.meta.url), 'utf8');
const detectScriptLanguageCode = vm.runInNewContext(transpile('(' + source.slice(source.indexOf('function detectScriptLanguageCode('), source.indexOf('function cleanTimestampNumber(')).trim() + ')'));
const restore = source.slice(source.indexOf('    const restoredScript ='), source.indexOf('    if (s.scriptType)'));
const staleRestore = source.match(/    setVoiceDraftStaleLangs\(Array\.isArray\(s\.voiceDraftStaleLangs\)[^\n]+/)![0];
const effect = source.slice(source.indexOf('    if (masterScriptSnapshot.current !== script'), source.indexOf('  }, [masterSourceLanguage, script, voiceDrafts, voiceLangs]'));
assert.match(source.slice(source.indexOf('  const collectSpec ='), source.indexOf('  const applySpec =')), /\bvoiceoverLines\b/);
const script = '[0-5s] 欢迎来到我们的工厂';
const voiceDrafts = { zh: script, en: '[0-5s] Welcome to our factory', fr: '[0-5s] Bienvenue dans notre usine' };
function restoreAndRunEffect(spec: Record<string, unknown>, previousScript = 'another project') {
  const state: any = {
    s: JSON.parse(JSON.stringify(spec)), restoredVoiceDrafts: spec.voiceDrafts || {},
    masterScriptSnapshot: { current: previousScript }, script: previousScript,
    voiceDrafts: spec.voiceDrafts || {}, voiceLangs: ['zh', 'en', 'fr'], masterSourceLanguage: 'zh',
    stale: ['en'], lines: 'another project voiceover',
    detectScriptLanguageCode, formatVoiceoverWithTimestamps,
  };
  state.setScript = (value: string) => { state.script = value; };
  state.setVoiceoverLines = (value: string) => { state.lines = value; };
  state.setVoiceDraftStaleLangs = (value: any) => { state.stale = typeof value === 'function' ? value(state.stale) : value; };
  vm.runInNewContext(transpile(`${restore}\n${staleRestore}\n${effect}`), state);
  return state;
}
for (const entry of ['draft', 'reuse']) {
  const saved = { script, voiceoverLines: script, voiceDrafts, voiceDraftStaleLangs: [] };
  const state = restoreAndRunEffect(saved);
  assert.equal(state.lines, script, `${entry} restores source voiceover`);
  assert.equal(state.stale.length, 0, `${entry} must not invalidate saved translations`);
  assert.equal(state.voiceDrafts.en, voiceDrafts.en);
  assert.equal(state.voiceDrafts.fr, voiceDrafts.fr);
  state.script = '[0-5s] 修改后的口播';
  vm.runInNewContext(transpile(effect), state);
  assert.ok(state.stale.includes('en') && state.stale.includes('fr'), 'a real edit still invalidates translations');
}
const legacy = restoreAndRunEffect({ script, voiceDrafts });
assert.equal(legacy.lines, script, 'legacy drafts recover the stored source-language copy');
assert.equal(legacy.stale.length, 0, 'missing stale metadata must not inherit another project state');
const stale = restoreAndRunEffect({ script, voiceDrafts, voiceDraftStaleLangs: ['fr'] });
assert.deepEqual(Array.from(stale.stale), ['fr'], 'genuinely outdated translations remain outdated');
console.log('translation persistence regression passed');
