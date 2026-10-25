import { currentContentProviderReceipt } from '../contentExecution/context.js';
import { beginContentProviderOperation, acceptContentProviderOperation, completeContentProviderOperation, failContentProviderOperation, markContentProviderOperationUnknown } from '../contentExecution/providerGateway.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { prepareHeyGenNativeSpeechTrack, type NativeSpeechTrackReceipt } from './heygenNativeSpeechTrack.js';
import { studioVoicePaidContext, type StudioVoicePaidRequest } from './studioVoicePaidOperation.js';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
async function writeAtomic(file: string, value: unknown) {
  const temp = file + '.' + randomUUID() + '.tmp';
  const handle = await fs.open(temp, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(temp, file);
  const directory = await fs.open(path.dirname(file), 'r'); try { await directory.sync(); } finally { await directory.close(); }
}
/** Explicit funded Avatar IV full-script route, never an implicit Orca fallback. */
export async function synthesizeNativeHeyGenVoice(input: { text: string; voiceId: string; output: string }, ports: { key?: string; root?: string; fetch?: typeof fetch } = {}) {
  const context = studioVoicePaidContext(), key = ports.key || process.env.HEYGEN_API_KEY?.trim();
  if (!context || context.primaryProvider !== 'heygen' || context.primaryModel !== 'avatar_iv' || !context.nativeSpeech || !key)
    throw Error('native_speech_track_funded_context_required');
  const native = context.nativeSpeech;
  const body = { type: 'avatar', avatar_id: native.avatarId, voice_id: input.voiceId, script: input.text,
    engine: { type: 'avatar_iv' }, caption: { file_format: 'srt' }, aspect_ratio: '9:16', resolution: '720p', title: 'Full-script native speech track', output_format: 'mp4' };
  const request: StudioVoicePaidRequest = { stage: 'tts', provider: 'heygen', model: 'avatar_iv', voiceId: input.voiceId,
    endpoint: 'https://api.heygen.com/v3/videos', accountKeyHash: hash(key), request: body, audioSeconds: native.maximumDurationSeconds };
  const call = await context.forRequest(request);
  if (call.intent.stage !== 'tts' || call.intent.provider !== 'heygen' || call.intent.model !== 'avatar_iv'
    || call.intent.maximumUnits.providerSeconds !== native.maximumDurationSeconds) throw Error('native_speech_track_frozen_route_changed');
  await call.assertProviderBinding(request);
  const root = path.resolve(ports.root || 'data/social-content-native-speech'), operationRoot = path.join(root, hash(call.intent.operationId));
  await fs.mkdir(operationRoot, { recursive: true, mode: 0o700 });
  const file = path.join(operationRoot, 'receipt.json');
  const trackInput = { scope: native.scope, avatarId: native.avatarId, voiceId: input.voiceId, script: input.text,
    ratio: '9:16', maximumDurationSeconds: native.maximumDurationSeconds, operationId: call.intent.operationId };
  const syncReceipt = async (row: NativeSpeechTrackReceipt, recovered = false) => {
    if (row.identity !== hash(JSON.stringify(trackInput)) || hash(JSON.stringify(row.input)) !== row.identity) throw Error('native_speech_track_identity_changed');
    const failureCode = row.rejection?.code || (typeof row.providerStatus?.failure_code === 'string' ? row.providerStatus.failure_code : undefined);
    const receipt = { provider: 'heygen', requestId: call.intent.operationId, providerTaskId: row.providerTaskId || null,
      metadata: { stage: 'tts', model: 'avatar_iv', operationId: call.intent.operationId, receiptRef: file,
        ...(failureCode ? { failureCode } : {}), ...(row.rejection ? { httpStatus: row.rejection.status } : {}) } };
    if (row.status === 'failed' || row.providerStatus?.status === 'failed') await failContentProviderOperation(receipt);
    else if (row.status === 'completed') await completeContentProviderOperation(receipt);
    else if (row.providerTaskId) await acceptContentProviderOperation({ ...receipt, providerTaskId: row.providerTaskId });
    else if (recovered) await markContentProviderOperationUnknown(receipt);
  };
  const readReceipt = async () => {
    let text: string;
    try { text = await fs.readFile(file, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    let row: NativeSpeechTrackReceipt;
    try { row = JSON.parse(text); } catch { throw Error('native_speech_track_receipt_corrupt_no_repost'); }
    await syncReceipt(row, true); return row;
  };
  let result: Awaited<ReturnType<typeof prepareHeyGenNativeSpeechTrack>>;
  try { result = await prepareHeyGenNativeSpeechTrack(trackInput, {
    root, key, fetch: ports.fetch,
    receipts: {
      read: readReceipt,
      write: async (_id, value) => { await writeAtomic(file, value); await syncReceipt(value); },
    },
    gate: {
      beforeSubmit: async (actual, operationId) => {
        if (JSON.stringify(actual) !== JSON.stringify(body) || operationId !== call.intent.operationId) throw Error('native_speech_track_actual_body_changed');
        await call.assertProviderBinding({ ...request, request: actual });
        const units = await call.measureUsage(request);
        if (Object.keys(units).length !== 1 || units.providerSeconds !== native.maximumDurationSeconds) throw Error('native_speech_track_actual_usage_changed');
        const prior = currentContentProviderReceipt({ provider: 'heygen', requestId: operationId });
        if (prior) throw Error('native_speech_track_submission_unknown_no_repost:' + (prior.providerTaskId || operationId));
        const { maximumUnits: _, ...binding } = call.intent;
        await call.permit.beforeSubmit({ ...binding, actualUnits: units });
        // Local validation/permit rejection is not a supplier submission. Only
        // a successful durable permit may create the gateway submission fence.
        const admission = await beginContentProviderOperation({ provider: 'heygen', requestId: operationId, metadata: { stage: 'tts', model: 'avatar_iv', receiptRef: file } });
        if (admission.action !== 'submit') throw Error('native_speech_track_submission_unknown_no_repost:' + (admission.receipt?.providerTaskId || operationId));
      },
      onAccepted: async (providerTaskId) => call.permit.markOutcome(call.intent.operationId, 'accepted', 'heygen:' + providerTaskId),
      assertRecovery: async () => { await call.permit.assertRecovery(call.intent.operationId); },
    },
  }); } catch (error) { await readReceipt(); throw error; }
  if (result.status === 'pending') throw Error('native_speech_track_pending_reconcile:' + result.providerTaskId);
  // The canonical receipt records actual returned media, not a synthetic TTS
  // response. Re-running this idempotent writer restores the caller's proof map.
  const receipt = await call.persistProviderReceipt({ requestSha256: hash(JSON.stringify(body)),
    response: { nativeSpeechTrack: result.receipt, videoPath: result.videoPath, audioPath: result.audioPath,
      ...(result.subtitlePath ? { subtitlePath: result.subtitlePath, subtitleSha256: result.subtitleSha256 } : {}) },
    audioSha256: result.audioSha256, audioSeconds: result.duration });
  if (!receipt) throw Error('native_speech_track_original_receipt_missing');
  await call.permit.markOutcome(call.intent.operationId, 'completed', receipt);
  await fs.mkdir(path.dirname(input.output), { recursive: true }); await fs.copyFile(result.audioPath, input.output);
  return { duration: result.duration, voiceId: input.voiceId, nativeSpeechTrack: result };
}
