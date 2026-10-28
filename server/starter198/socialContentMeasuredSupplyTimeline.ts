import {measureSentenceSlots} from './socialContentSentenceSlotMapping.js';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import type {SocialDirectorBrief} from '../../shared/contracts/socialContentAgentContract.js';
import {assertVoiceDrivenFilmDuration} from '../../shared/contracts/productionBudgetPolicy.js';
import type {SocialTaskBudgetScope} from '../lib/socialContentTaskBudget.js';
import {verifiedAudioCues} from '../integrations/qwenAlignment.js';
import {verifiedNativePhraseCues} from '../lib/heygenNativeSubtitles.js';
import {paidProductionHash} from './socialContentPaidOperationPlan.js';
import type {PreparedWholeVoice} from './socialContentPreparedWholeVoice.js';
import {mapMeasuredSceneTimeline, type MeasuredSceneTime} from './socialContentMeasuredSceneTimeline.js';

type DirectorScenes = SocialDirectorBrief['scenes'];
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const same = (left: unknown, right: unknown) => paidProductionHash(left) === paidProductionHash(right);
export interface VerifiedMeasuredSupplyTiming {
  timeline: MeasuredSceneTime[];
  durationSeconds: number;
  wholeTrackSha256: string;
  preparedReceiptRef: string;
  preparedReceiptSha256: string;
  alignmentReceiptRef: string;
  alignmentReceiptSha256: string;
  sourceReceipts: Array<{receiptRef: string; sha256: string; operationId: string}>;
}

/** Read the original paid evidence again before quoting any measured visual
 * work. Caller-supplied timings alone can never authorize another request. */
export async function verifyMeasuredSupplyVoice(input: {
  prepared: PreparedWholeVoice;
  scope: SocialTaskBudgetScope;
  scenes: DirectorScenes;
  spokenScenes?: Array<{sceneId: string; voiceover?: string | null; narration?: string | null}>;
}): Promise<VerifiedMeasuredSupplyTiming> {
  const {prepared, scope, scenes} = input;
  const bytes = await fs.readFile(prepared.receiptRef);
  const state = JSON.parse(bytes.toString());
  const proof = {sourceReceiptRefs: prepared.sourceReceiptRefs, alignmentReceiptRef: prepared.alignmentReceiptRef, nativeVoice: prepared.nativeVoice};
  if (prepared.timingPolicy !== 'voice-driven-slots.v1' || state.status !== 'completed' || state.voiceDriven !== true
    || state.inputHash !== prepared.inputHash || !same(state.scope, scope) || !same(state.voice, prepared.voice)
    || !same(state.proof, proof) || state.wholeTrackSha256 !== prepared.wholeTrackSha256)
    throw Error('measured_supply_voice_receipt_changed');
  if (!Array.isArray(state.scenes) || !state.scenes.length || state.scenes.length !== scenes.length)
    throw Error('measured_supply_original_scenes_changed');
  for (let index = 0; index < scenes.length; index++) {
    const original = state.scenes[index], scene = scenes[index]!;
    if (original.shotId !== scene.sceneId || typeof original.spokenText !== 'string'
      || original.startSeconds !== scene.duration.startSeconds || original.endSeconds !== scene.duration.endSeconds
      || !Number.isFinite(original.durationSeconds)
      || Math.abs(original.durationSeconds - (scene.duration.endSeconds - scene.duration.startSeconds)) > .000001)
      throw Error('measured_supply_original_scenes_changed');
    if (input.spokenScenes) {
      const spoken = input.spokenScenes.filter(item => item.sceneId === scene.sceneId);
      if (spoken.length !== 1 || original.spokenText !== (spoken[0]!.voiceover || spoken[0]!.narration || ''))
        throw Error('measured_supply_original_speech_changed');
    }
  }
  assertVoiceDrivenFilmDuration(prepared.voice.duration);
  if (sha(await fs.readFile(prepared.voice.localPath)) !== prepared.wholeTrackSha256)
    throw Error('prepared_whole_voice_bytes_changed');
  const alignmentBytes = await fs.readFile(prepared.alignmentReceiptRef);
  const alignment = JSON.parse(alignmentBytes.toString());
  if (alignment.state !== 'completed' || alignment.scope?.audioSha256 !== prepared.wholeTrackSha256)
    throw Error('prepared_whole_voice_alignment_changed');
  if ((alignment.source === 'heygen_native_subtitles' || alignment.source === 'heygen_native')
    && (prepared.nativeVoice.provider !== 'heygen' || !prepared.sourceReceiptRefs.includes(alignment.sourceReceiptRef)
      || !/^[a-f0-9]{64}$/.test(alignment.sourceReceiptSha256)))
    throw Error('prepared_whole_voice_original_receipt_changed');
  const text = state.scenes.map((scene: {spokenText: string}) => scene.spokenText).filter(Boolean).join(' ');
  const cues = alignment.source === 'heygen_native_subtitles' && alignment.precision === 'phrase' && alignment.independentAsr === false
    ? verifiedNativePhraseCues(alignment.result, text, prepared.voice.duration)
    : verifiedAudioCues(alignment.result, text, prepared.voice.duration);
  if (!same(cues, prepared.voice.cues)) throw Error('prepared_whole_voice_measured_cues_changed');
  if (state.sentenceLines && (!same(measureSentenceSlots(state.sentenceLines, cues), prepared.measuredSentenceSlots)
    || !same(state.measuredSentenceSlots, prepared.measuredSentenceSlots))) throw Error('sentence_slot_measurement_changed');
  const timeline = mapMeasuredSceneTimeline({scenes: state.scenes, cues, durationSeconds: prepared.voice.duration});
  if (!same(timeline, prepared.measuredSceneTimeline) || !same(timeline, state.measuredTimeline))
    throw Error('prepared_whole_voice_timeline_changed');
  if (!prepared.sourceReceiptRefs.length) throw Error('prepared_whole_voice_original_receipt_missing');
  const sourceReceipts = await Promise.all(prepared.sourceReceiptRefs.map(async receiptRef => {
    const sourceBytes = await fs.readFile(receiptRef), source = JSON.parse(sourceBytes.toString());
    if (!same(source.scope, scope) || source.provider !== prepared.nativeVoice.provider || source.model !== prepared.nativeVoice.model
      || source.voiceId !== prepared.nativeVoice.physicalVoiceId || typeof source.operationId !== 'string' || !source.operationId)
      throw Error('prepared_whole_voice_original_receipt_changed');
    if (alignment.sourceReceiptRef === receiptRef && alignment.sourceReceiptSha256 !== sha(sourceBytes))
      throw Error('prepared_whole_voice_original_receipt_changed');
    return {receiptRef, sha256: sha(sourceBytes), operationId: source.operationId};
  }));
  if (alignment.sourceReceiptRef && !prepared.sourceReceiptRefs.includes(alignment.sourceReceiptRef))
    throw Error('prepared_whole_voice_original_receipt_changed');
  return {timeline, durationSeconds: prepared.voice.duration, wholeTrackSha256: prepared.wholeTrackSha256,
    preparedReceiptRef: prepared.receiptRef, preparedReceiptSha256: sha(bytes),
    alignmentReceiptRef: prepared.alignmentReceiptRef, alignmentReceiptSha256: sha(alignmentBytes), sourceReceipts};
}

/** Timing projection only: no new slot, reordering, text, route or expression. */
export function projectMeasuredDirectorScenes(input: {scenes: DirectorScenes; timeline: MeasuredSceneTime[]}): DirectorScenes {
  if (!input.scenes.length || input.scenes.length !== input.timeline.length
    || new Set(input.scenes.map(scene => scene.sceneId)).size !== input.scenes.length)
    throw Error('measured_supply_scene_projection_changed');
  let previousEnd = 0;
  return input.scenes.map((scene, index) => {
    const time = input.timeline[index]!;
    if (time.shotId !== scene.sceneId || !Number.isFinite(time.start) || !Number.isFinite(time.end)
      || time.end <= time.start || Math.abs(time.start - previousEnd) > .000001)
      throw Error('measured_supply_scene_projection_changed');
    previousEnd = time.end;
    return {...scene, duration: {startSeconds: time.start, endSeconds: time.end, targetSeconds: time.end - time.start}};
  });
}
