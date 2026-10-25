import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-static';
import { HeyGenClient, HeyGenRequestError } from './heygen.js';
import { withPaidOperationLock } from './paidOperationLock.js';
import { wavDurationFromBytes } from './wavDuration.js';

export interface NativeSpeechTrackInput {
  scope: { tenantId: string; taskId: string; runId: string };
  avatarId: string; voiceId: string; script: string; ratio: string;
  maximumDurationSeconds: number; operationId: string;
}
export interface NativeSpeechTrackReceipt {
  identity: string; input: NativeSpeechTrackInput; status: 'submitting' | 'accepted' | 'completed' | 'failed';
  request?: Record<string, unknown>; providerTaskId?: string;
  acceptance?: Record<string, unknown>; providerStatus?: Record<string, unknown>;
  videoSha256?: string; audioSha256?: string; duration?: number; subtitleSha256?: string;
  rejection?: { status: number; code: string };
}
export interface NativeSpeechTrackPorts {
  root: string; key: string; fetch?: typeof fetch;
  /** Durable atomic store. Missing is null; malformed/unreadable must throw. */
  receipts: { read(operationId: string): Promise<NativeSpeechTrackReceipt | null>; write(operationId: string, receipt: NativeSpeechTrackReceipt): Promise<void> };
  /** Original paid authority/permit boundary, not a new budget mechanism. */
  gate: { beforeSubmit(request: Record<string, unknown>, operationId: string): Promise<void>;
    onAccepted(providerTaskId: string, operationId: string, receipt: Record<string, unknown>): Promise<void>;
    assertRecovery(providerTaskId: string, operationId: string): Promise<void>;
    onStatus?(providerTaskId: string, receipt: Record<string, unknown>): Promise<void> };
}
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
/** One full-script native mother clip. No ASR, lip-quality or reference-composition claim. */
export async function prepareHeyGenNativeSpeechTrack(input: NativeSpeechTrackInput, ports: NativeSpeechTrackPorts) {
  if (!input.scope.tenantId || !input.scope.taskId || !input.scope.runId || !input.avatarId || !input.voiceId
    || !input.script.trim() || !input.operationId || !Number.isFinite(input.maximumDurationSeconds) || input.maximumDurationSeconds <= 0
    || !['9:16','16:9','1:1'].includes(input.ratio)) throw Error('native_speech_track_input_invalid');
  const identity = hash(JSON.stringify(input));
  const root = path.resolve(ports.root, hash(JSON.stringify(input.scope)), hash(input.operationId));
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  return withPaidOperationLock(path.join(root, '.locks'), input.operationId, async () => {
    let state = await ports.receipts.read(input.operationId);
    if (state && (state.identity !== identity || hash(JSON.stringify(state.input)) !== identity)) throw Error('native_speech_track_identity_changed');
    if (state?.status === 'submitting' && !state.providerTaskId) throw Error('native_speech_track_submission_unknown_no_repost');
    if (state?.status === 'failed') throw Error(state.rejection ? 'native_speech_track_provider_rejected:' + state.rejection.status + ':' + state.rejection.code
      : 'native_speech_track_provider_failed' + (typeof state.providerStatus?.failure_code === 'string' ? ':' + state.providerStatus.failure_code : ''));
    const persist = async (value: NativeSpeechTrackReceipt) => { await ports.receipts.write(input.operationId, structuredClone(value)); state = value; };
    const client = new HeyGenClient(ports.key, ports.fetch || fetch, {
      beforeSubmit: async (request, operationId) => {
        if (request.avatar_id !== input.avatarId || request.voice_id !== input.voiceId || request.script !== input.script
          || (request.engine as any)?.type !== 'avatar_iv') throw Error('native_speech_track_request_identity_changed');
        await ports.gate.beforeSubmit(request, operationId);
        await persist({ identity, input: structuredClone(input), status: 'submitting', request });
      },
      onAccepted: async (providerTaskId, operationId, receipt = {}) => {
        await persist({ ...state!, status: 'accepted', providerTaskId, acceptance: receipt });
        await ports.gate.onAccepted(providerTaskId, operationId, receipt);
      },
      onStatus: async (providerTaskId, receipt) => {
        if (providerTaskId !== state?.providerTaskId || (receipt.video_id && receipt.video_id !== providerTaskId)
          || (receipt.avatar_id && receipt.avatar_id !== input.avatarId) || (receipt.voice_id && receipt.voice_id !== input.voiceId)
          || (receipt.script && receipt.script !== input.script)) throw Error('native_speech_track_provider_identity_changed');
        await persist({ ...state, providerStatus: receipt });
        await ports.gate.onStatus?.(providerTaskId, receipt);
      },
    });
    if (!state) {
      try {
        await client.create({ avatarId: input.avatarId, voiceId: input.voiceId, script: input.script,
          engine: 'avatar_iv', caption: { file_format: 'srt' }, ratio: input.ratio, transparent: false, title: 'Full-script native speech track' }, input.operationId);
      } catch (error) {
        // A supplier's explicit client-error response is retained separately
        // from an unknown transport/server outcome. The original budget hold
        // remains intact: this is no release proof and never permits a repost.
        if (error instanceof HeyGenRequestError && [400, 401, 402, 403, 422].includes(error.status)) {
          const submitted = await ports.receipts.read(input.operationId);
          if (submitted?.identity === identity && submitted.status === 'submitting' && !submitted.providerTaskId) {
            await persist({ ...submitted, status: 'failed', rejection: { status: error.status, code: error.code } });
            throw Error('native_speech_track_provider_rejected:' + error.status + ':' + error.code);
          }
        }
        throw error;
      }
    }
    if (!state?.providerTaskId || !state.request || state.request.avatar_id !== input.avatarId
      || state.request.voice_id !== input.voiceId || state.request.script !== input.script
      || (state.request.engine as any)?.type !== 'avatar_iv' || state.request.aspect_ratio !== input.ratio) throw Error('native_speech_track_original_receipt_missing');
    await ports.gate.assertRecovery(state.providerTaskId, input.operationId);
    const status = state.status === 'completed' && state.providerStatus?.status === 'completed'
      ? { status: 'completed' as const, url: String(state.providerStatus.video_url || ''), duration: Number(state.providerStatus.duration),
        ...(typeof state.providerStatus.subtitle_url === 'string' ? { subtitleUrl: state.providerStatus.subtitle_url } : {}) }
      : await client.status(state.providerTaskId);
    if (status.status === 'failed') { await persist({ ...state, status: 'failed' }); throw Error('native_speech_track_provider_failed:' + status.error); }
    if (status.status !== 'completed') return { status: 'pending' as const, providerTaskId: state.providerTaskId, receipt: state };
    if (!status.duration || status.duration > input.maximumDurationSeconds) throw Error('native_speech_track_duration_exceeded');
    const videoPath = path.join(root, 'native.mp4'), audioPath = path.join(root, 'speech.wav');
    let video: Buffer;
    try { video = await fs.readFile(videoPath); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const url = new URL(status.url!);
      if (url.protocol !== 'https:' || !/(^|\.)heygen\.(ai|com)$/.test(url.hostname)) throw Error('native_speech_track_video_url_invalid');
      const response = await (ports.fetch || fetch)(url, { redirect: 'error', signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw Error('native_speech_track_download_failed');
      video = Buffer.from(await response.arrayBuffer());
      if (!video.length || video.length > 256 * 1024 * 1024) throw Error('native_speech_track_video_invalid');
      await fs.writeFile(videoPath, video, { mode: 0o600 });
    }
    const videoSha256 = hash(video);
    if (state.videoSha256 && state.videoSha256 !== videoSha256) throw Error('native_speech_track_video_hash_changed');
    if (state.audioSha256) {
      try { if (hash(await fs.readFile(audioPath)) !== state.audioSha256) throw Error('native_speech_track_audio_hash_changed'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    try {
      await promisify(execFile)(ffmpeg || 'ffmpeg', ['-hide_banner','-loglevel','error','-i',videoPath,'-map','0:v:0','-frames:v','1','-f','null','-'], { timeout: 30000 });
      await promisify(execFile)(ffmpeg || 'ffmpeg', ['-hide_banner','-loglevel','error','-y','-i',videoPath,'-map','0:a:0','-vn','-ar','24000','-ac','1','-c:a','pcm_s16le',audioPath], { timeout: 60000 });
    } catch { throw Error('native_speech_track_audio_missing_or_invalid'); }
    const audio = await fs.readFile(audioPath), duration = wavDurationFromBytes(audio), audioSha256 = hash(audio);
    if (!(duration > 0) || duration > input.maximumDurationSeconds || Math.abs(duration - status.duration) > 0.3) throw Error('native_speech_track_audio_duration_mismatch');
    if (state.audioSha256 && state.audioSha256 !== audioSha256) throw Error('native_speech_track_audio_hash_changed');
    let subtitlePath: string | undefined, subtitleSha256: string | undefined;
    if (status.subtitleUrl) {
      const url = new URL(status.subtitleUrl);
      if (url.protocol !== 'https:' || !/(^|\.)heygen\.(ai|com)$/.test(url.hostname)) throw Error('native_speech_track_subtitle_url_invalid');
      subtitlePath = path.join(root, 'speech.srt');
      let subtitle: Buffer;
      try { subtitle = await fs.readFile(subtitlePath); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        const response = await (ports.fetch || fetch)(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw Error('native_speech_track_subtitle_download_failed');
        subtitle = Buffer.from(await response.arrayBuffer());
        if (!subtitle.length || subtitle.length > 2 * 1024 * 1024) throw Error('native_speech_track_subtitle_invalid');
        await fs.writeFile(subtitlePath, subtitle, { mode: 0o600 });
      }
      subtitleSha256 = hash(subtitle);
      if (state.subtitleSha256 && subtitleSha256 !== state.subtitleSha256) throw Error('native_speech_track_subtitle_hash_changed');
    }
    await persist({ ...state, status: 'completed', videoSha256, audioSha256, duration, ...(subtitleSha256 ? { subtitleSha256 } : {}) });
    return { status: 'completed' as const, providerTaskId: state!.providerTaskId!, videoPath, audioPath, videoSha256, audioSha256, duration,
      ...(subtitlePath ? { subtitlePath, subtitleSha256 } : {}), avatarId: input.avatarId, voiceId: input.voiceId, scriptSha256: hash(input.script), receipt: state!, humanReviewRequired: true as const };
  });
}
