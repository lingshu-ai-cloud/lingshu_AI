import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { restoreStudioVoiceComposition } from '../../../tests/fixtures/studioVoiceComposition';

const source = readFileSync(new URL('../AiCreateStudio.tsx', import.meta.url), 'utf8');

test('source contracts compose current voice state, model, action and Effect bodies', () => {
  const restored = restoreStudioVoiceComposition(source);
  assert.match(restored, /const genTts = async/);
  assert.match(restored, /const generateVoiceDrafts = async/);
  assert.match(restored, /const ttsRequestRef = useRef\(0\)/);
  assert.doesNotMatch(restored, /const voicePorts:/);
});

test('source composition rejects crossed voice ports, actions and returned bindings', () => {
  const crossedPort = source.replace('get voiceLangs() { return voiceLangs; }', 'get voiceLangs() { return enterpriseVoiceLangs; }');
  assert.notEqual(crossedPort, source);
  assert.throws(() => restoreStudioVoiceComposition(crossedPort), /port binding mismatch/);
  const crossedAction = source.replace('const genTts = voiceSynthesis.genTts;', 'const genTts = voiceSynthesis.clearVoiceover;');
  assert.notEqual(crossedAction, source);
  assert.throws(() => restoreStudioVoiceComposition(crossedAction), /action binding mismatch/);
  const crossedReturn = source.replace('voice, setVoice, voiceCandidates,', 'voice: script, setVoice, voiceCandidates,');
  assert.notEqual(crossedReturn, source);
  assert.throws(() => restoreStudioVoiceComposition(crossedReturn), /hook return mismatch/);
});

test('source composition rejects a missing or duplicated lifecycle registration', () => {
  const call = 'useStudioVoiceTranslationCleanup(voicePorts);';
  assert.ok(source.includes(call));
  assert.throws(() => restoreStudioVoiceComposition(source.replace(call, '')), /Missing Studio Hook/);
  assert.throws(() => restoreStudioVoiceComposition(source.replace(call, call + call)), /Duplicated Studio Hook/);
});
