import assert from 'node:assert/strict';
import test from 'node:test';
import { studioApi, type SubCue, type TtsAudioResult } from '../../lib/studioApi';
import { createStudioVoiceTranslationActions } from './studioVoiceTranslationActions';
import { createStudioVoiceSynthesisActions } from './studioVoiceSynthesisActions';
import { createStudioSubtitleActions } from './useStudioSubtitleReview';
import { createStudioSoundtrackActions } from './studioVoiceSoundtrack';
import { createStudioVoicePlaybackActions } from './studioVoicePlayback';
import type { StudioVoiceLifecyclePorts } from './studioVoiceLifecyclePorts';
import { formatVoiceoverWithTimestamps, voiceoverDraftCoversSource } from './studioVoiceoverRules';
import { materialVersionKey } from './studioMaterialPresentation';

const source = '[0-3s] Welcome to our factory.';
const spanish = '[0-3s] Bienvenidos a nuestra fábrica.';
const cues: SubCue[] = [{ start: 0, end: 3, text: 'Welcome to our factory.' }];
const audio: TtsAudioResult = { ok: true, url: '/fixture/en.wav', duration: 3,
  text: 'Welcome to our factory.', cues, alignmentSource: 'synthesized_sentence_audio' };
const ref = <T>(current: T) => ({ current });

function fixture() {
  const state = {
    activeVoiceLang: 'en', lang: 'en', voiceLangs: ['en', 'es'], scriptView: 'voiceover',
    script: source, voiceoverLines: source, workflowSourceLanguage: 'en',
    voiceDrafts: { en: source, es: spanish } as Record<string, string>,
    voiceDraftStaleLangs: [] as string[], voiceDraftPendingLangs: [] as string[],
    voiceDraftFailedLangs: [] as string[], voiceDraftLoading: false, voiceDraftNotice: '',
    voiceoverAudios: {} as StudioVoiceLifecyclePorts['voiceoverAudios'],
    voiceoverStaleLangs: [] as string[], alignedCuesByLang: {} as Record<string, SubCue[]>,
    ttsLanguageSettings: {} as StudioVoiceLifecyclePorts['ttsLanguageSettings'],
    ttsFailuresByLang: {} as Record<string, string>, ttsActiveLangs: [] as string[],
    ttsLoading: false, ttsLoadingScope: null as 'all' | 'single' | 'upload' | null,
    ttsNotice: '', voiceoverMode: 'none', voiceoverUrl: null as string | null,
    voiceoverDur: 0, uploadedVoiceName: '', ttsPlaying: false,
    renderOutputPath: '/fixture/old.mp4' as string | null, renderOutputPreviewUrl: 'old' as string | null,
    languageRenderOutputs: { old: {} }, languageRenderVersions: { old: [] },
    storyboardVideoVersions: { old: [] }, productVideoVersions: [{}], subtitlesOn: false, subMode: 'bilingual',
    subtitleGenerating: false, subtitleNotice: '', bgm: '', assemblyBgms: {} as Record<string, string>,
    materialVersionBgms: {} as Record<string, string>, rendered: true, favoriteBgms: [] as string[], playingBgm: null as string | null,
  };
  const fields: Record<string, unknown> = {};
  const values = state as unknown as Record<string, unknown>;
  for (const name of Object.keys(state)) {
    Object.defineProperty(fields, name, { get: () => values[name] });
    fields['set' + name[0]!.toUpperCase() + name.slice(1)] = (next: unknown) => {
      values[name] = typeof next === 'function' ? (next as (current: unknown) => unknown)(values[name]) : next;
    };
  }
  Object.assign(fields, {
    voiceDraftRunRef: ref(0), voiceDraftAbortRef: ref<AbortController | null>(null), studioSpecEpochRef: ref(0),
    ttsRequestRef: ref(0), ttsAudioRef: ref<HTMLAudioElement | null>(null), audioRef: ref<HTMLAudioElement | null>(null),
    storyboardSlots: [], hasAvatarSourceVoice: () => false, storyboardTimelineEnd: 3,
    mode: 'material', useReferenceVoiceStyle: false, referenceVoice: { available: false },
    duration: 3, totalDur: 3, threeStepWorkflow: true, presentationMode: 'material', voice: 'v1', activeAssemblyId: 'assembly-1',
    extractVoiceoverText: formatVoiceoverWithTimestamps,
  });
  const ports = fields as unknown as StudioVoiceLifecyclePorts;
  return { state, ports };
}

test.beforeEach(t => {
  if (!('mock' in t)) throw Error('Voice tests require a per-test context');
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { setTimeout, clearTimeout } });
  const network = t.mock.method(globalThis, 'fetch', async () => { throw Error('unexpected real network'); });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
    assert.equal(network.mock.callCount(), 0, 'all API calls must be explicit substitutes');
  });
});

test('removing a translation keeps the original, aborts prior translation, and clears only that language and generated render outputs', () => {
  const { state, ports } = fixture();
  const controller = new AbortController();
  ports.voiceDraftAbortRef.current = controller;
  state.voiceDraftLoading = true;
  state.activeVoiceLang = 'es';
  state.voiceoverAudios = { en: { url: '/en', duration: 3 }, es: { url: '/es', duration: 3 } };
  state.alignedCuesByLang = { en: cues, es: cues };
  const actions = createStudioVoiceTranslationActions(ports);
  actions.removeTranslationLanguage('en');
  assert.deepEqual(state.voiceLangs, ['en', 'es']);
  assert.equal(controller.signal.aborted, false);
  actions.removeTranslationLanguage('es');
  assert.equal(controller.signal.aborted, true);
  assert.equal(ports.voiceDraftAbortRef.current, null);
  assert.equal(state.voiceDraftLoading, false);
  assert.deepEqual(state.voiceLangs, ['en']);
  assert.deepEqual(state.voiceDrafts, { en: source });
  assert.deepEqual(state.alignedCuesByLang, { en: cues });
  assert.equal(state.voiceoverAudios.en?.url, '/en');
  assert.equal(state.voiceoverAudios.es, undefined);
  assert.equal(state.activeVoiceLang, 'en');
  assert.deepEqual(state.languageRenderOutputs, {});
  assert.equal(state.renderOutputPath, null);
});

test('a translation retry cannot write into a different restored project epoch', async t => {
  const { state, ports } = fixture();
  let finish!: (value: Awaited<ReturnType<typeof studioApi.translate>>) => void;
  t.mock.method(studioApi, 'translate', () => new Promise<Awaited<ReturnType<typeof studioApi.translate>>>(resolve => { finish = resolve; }));
  const pending = createStudioVoiceTranslationActions(ports).retryVoiceDraft('es');
  assert.deepEqual(state.voiceDraftPendingLangs, ['es']);
  ports.studioSpecEpochRef.current++;
  state.voiceDrafts = { en: 'new project' };
  state.voiceDraftPendingLangs = [];
  finish({ ok: true, text: spanish });
  await pending;
  assert.deepEqual(state.voiceDrafts, { en: 'new project' });
  assert.deepEqual(state.voiceDraftPendingLangs, []);
});

test('a new translation run aborts the old request and only the new run completes its state', async t => {
  const { state, ports } = fixture();
  let attempts = 0;
  const signals: AbortSignal[] = [];
  t.mock.method(studioApi, 'translateBatch', async (_input: Parameters<typeof studioApi.translateBatch>[0], options: Parameters<typeof studioApi.translateBatch>[1]) => {
    attempts++;
    const signal = options!.signal!;
    signals.push(signal);
    if (attempts === 1) return new Promise<Awaited<ReturnType<typeof studioApi.translateBatch>>>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
    });
    return { ok: true, translations: { es: spanish } };
  });
  const actions = createStudioVoiceTranslationActions(ports);
  const first = actions.generateVoiceDrafts();
  const second = actions.generateVoiceDrafts();
  await Promise.all([first, second]);
  assert.equal(signals[0]!.aborted, true);
  assert.equal(attempts, 2);
  assert.equal(ports.voiceDraftRunRef.current, 2);
  assert.equal(ports.voiceDraftAbortRef.current, null);
  assert.equal(state.voiceDraftLoading, false);
  assert.match(state.voiceDrafts.es!, /fábrica/);
  assert.deepEqual(state.voiceDraftPendingLangs, []);
  assert.deepEqual(state.voiceDraftFailedLangs, []);
});

test('partial translation retains successful languages and reports the failed language after the existing single retry', async t => {
  const { state, ports } = fixture();
  state.voiceLangs = ['en', 'es', 'fr'];
  t.mock.method(studioApi, 'translateBatch', async () => ({ ok: true, translations: { es: spanish } }));
  const retry = t.mock.method(studioApi, 'translate', async () => ({ ok: false, text: '', error: 'fixture unavailable' }));
  await createStudioVoiceTranslationActions(ports).generateVoiceDrafts();
  assert.equal(retry.mock.callCount(), 1);
  assert.match(state.voiceDrafts.es!, /fábrica/);
  assert.deepEqual(state.voiceDraftFailedLangs, ['fr']);
  assert.deepEqual(state.voiceDraftStaleLangs, ['fr']);
  assert.deepEqual(state.voiceDraftPendingLangs, []);
  assert.equal(state.voiceDraftLoading, false);
});

test('single-language synthesis preserves other language audio and the timestamped draft, using measured cues without another alignment call', async t => {
  const { state, ports } = fixture();
  state.voiceoverAudios = { es: { url: '/old-es', duration: 4 } };
  state.voiceoverStaleLangs = ['en', 'es'];
  const synthesis = t.mock.method(studioApi, 'tts', async () => audio);
  const align = t.mock.method(studioApi, 'alignTts', async () => { throw Error('measured cues need no re-alignment'); });
  await createStudioVoiceSynthesisActions(ports).genTts('en');
  assert.equal(synthesis.mock.callCount(), 1);
  assert.equal(synthesis.mock.calls[0]!.arguments[0]!.measuredSentenceTiming, true);
  assert.equal(align.mock.callCount(), 0);
  assert.equal(state.voiceoverAudios.en?.url, audio.url);
  assert.equal(state.voiceoverAudios.es?.url, '/old-es');
  assert.equal(voiceoverDraftCoversSource(source, state.voiceDrafts.en!), true);
  // Synthesis stores provider cues with the audio. The separate subtitle
  // action owns the editable aligned-cue drafts, as in the original flow.
  assert.deepEqual(state.voiceoverAudios.en?.cues, cues);
  assert.equal(state.alignedCuesByLang.en, undefined);
  assert.deepEqual(state.voiceoverStaleLangs, ['es']);
  assert.equal(state.voiceoverMode, 'ai');
  assert.equal(state.ttsLoading, false);
  assert.deepEqual(state.languageRenderOutputs, {});
});

test('an older synthesis response cannot overwrite restored audio or clear a newer loading state', async t => {
  const { state, ports } = fixture();
  let finish!: (result: TtsAudioResult) => void;
  t.mock.method(studioApi, 'tts', () => new Promise<TtsAudioResult>(resolve => { finish = resolve; }));
  const pending = createStudioVoiceSynthesisActions(ports).genTts('en');
  ports.ttsRequestRef.current++;
  state.voiceoverAudios = { en: { url: '/new-project', duration: 9 } };
  state.ttsLoadingScope = 'all';
  finish(audio);
  await pending;
  assert.equal(state.voiceoverAudios.en?.url, '/new-project');
  assert.equal(state.ttsLoading, true);
  assert.equal(state.ttsLoadingScope, 'all');
});

test('proportional timing stays pending when alignment provides no measured evidence', async t => {
  const { state, ports } = fixture();
  t.mock.method(studioApi, 'tts', async () => ({ ...audio, cues: undefined, alignmentSource: 'proportional' }));
  t.mock.method(studioApi, 'alignTts', async () => ({ ok: true, cues, source: 'proportional' as const }));
  await createStudioVoiceSynthesisActions(ports).genTts('en');
  assert.equal(state.voiceoverAudios.en?.alignmentSource, 'pending_alignment');
  assert.equal(state.alignedCuesByLang.en, undefined);
});

test('batch synthesis groups common styles and retains successful audio while marking one language failed', async t => {
  const { state, ports } = fixture();
  state.voiceoverStaleLangs = ['en', 'es'];
  const batch = t.mock.method(studioApi, 'ttsBatch', async () => ({ ok: false, audios: { en: audio, es: { ok: false, error: 'fixture unavailable' } } }));
  await createStudioVoiceSynthesisActions(ports).genTts();
  assert.equal(batch.mock.callCount(), 1);
  assert.deepEqual(batch.mock.calls[0]!.arguments[0]!.items.map(item => item.code), ['en', 'es']);
  assert.equal(state.voiceoverAudios.en?.url, audio.url);
  assert.equal(state.voiceoverAudios.es, undefined);
  assert.ok(state.ttsFailuresByLang.es);
  assert.deepEqual(state.voiceoverStaleLangs, ['es']);
  assert.equal(state.ttsLoading, false);
});

test('subtitle generation preserves measured audio cues and leaves a missing translation visibly incomplete', async () => {
  const { state, ports } = fixture();
  state.voiceLangs = ['en', 'es', 'fr'];
  state.voiceoverAudios = { en: { url: '/en', duration: 3, cues }, es: { url: '/es', duration: 4 } };
  await createStudioSubtitleActions(ports).generateSubtitleDrafts();
  assert.equal(state.alignedCuesByLang.en, cues);
  assert.ok(state.alignedCuesByLang.es?.length);
  assert.equal(state.alignedCuesByLang.fr, undefined);
  assert.match(state.subtitleNotice, /缺少可用文案/);
  assert.equal(state.subtitleGenerating, false);
});

test('soundtrack changes invalidate the generated preview and persist the assembly/language choice', () => {
  const { state, ports } = fixture();
  createStudioSoundtrackActions(ports).applyWorkbenchBgm('track-1');
  assert.equal(state.rendered, false);
  assert.equal(state.renderOutputPath, null);
  assert.deepEqual(state.languageRenderOutputs, {});
  assert.equal(state.bgm, 'track-1');
  assert.equal(state.assemblyBgms['assembly-1'], 'track-1');
  assert.equal(state.materialVersionBgms[materialVersionKey('assembly-1', 'en')], 'track-1');
});

test('all voice action factories construct without reading future render bindings', () => {
  const { ports } = fixture();
  const deferred = new Proxy(ports, { get() { throw Error('early port read'); } });
  createStudioVoiceTranslationActions(deferred);
  createStudioVoiceSynthesisActions(deferred);
  createStudioVoicePlaybackActions(deferred);
  createStudioSubtitleActions(deferred);
  createStudioSoundtrackActions(deferred);
});
