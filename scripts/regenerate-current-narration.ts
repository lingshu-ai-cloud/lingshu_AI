import '../server/loadEnvironment.js';
import { store } from '../server/storage/index.js';
import { runWithDataAuthority } from '../server/storage/dataAuthority.js';
import { prepareReferenceNarration } from '../server/lib/referenceNarration.js';
import { lockReferenceSpeechTimeline } from '../server/lib/referenceSpeechAnalysis.js';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const execute = promisify(execFile);
const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} 需要显式值`);
  return value;
};
const requiredArgument = (name: string) => {
  const value = argument(name)?.trim();
  if (!value) throw new Error(`必须显式提供 ${name}`);
  return value;
};

const id = requiredArgument('--id');
const tenantId = requiredArgument('--tenant-id');
const executePaid = process.argv.includes('--execute-paid');
const authorizationEvidence = argument('--authorization-evidence')?.trim();
const requestedOutput = argument('--output');
let folder: string | undefined;
const outputFolder = () => {
  if (folder) return folder;
  folder = requestedOutput
    ? path.resolve(requestedOutput)
    : fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-narration-regeneration-'));
  return folder;
};

await runWithDataAuthority('local', async () => {
  const record = await store.getById<any>('trend_videos', id);
  if (!record || record.tenantId !== tenantId) throw new Error('指定租户下不存在该参考视频记录');
  const analysis = typeof record.aiAnalysis === 'string' ? JSON.parse(record.aiAnalysis) : record.aiAnalysis;
  const relativeMedia = String(record.videoFileId || '').replace(/\\/g, '/');
  const canonical = path.resolve('data/media', 'tenants', tenantId, 'reference-videos', `${id}.mp4`);
  const mediaCandidates = [argument('--video'), canonical,
    relativeMedia.startsWith(`tenants/${tenantId}/`) && !relativeMedia.split('/').includes('..') ? path.resolve('data/media', relativeMedia) : undefined,
  ].filter((value): value is string => Boolean(value));
  const media = mediaCandidates.find(candidate => fs.existsSync(candidate));
  if (!media) throw new Error('本地原片不存在；使用 --video 指定该记录对应的本地源视频');
  const sourceVideoSha256 = createHash('sha256').update(fs.readFileSync(media)).digest('hex');
  if (analysis.contentSha256 && analysis.contentSha256 !== sourceVideoSha256) throw new Error('原片哈希与记录不一致，未发起 ASR');
  let probeLog = '';
  // ffmpeg exits 1 without an output target; its input metadata remains usable.
  try {
    const result = await execute(String(ffmpegStatic || 'ffmpeg'), ['-hide_banner', '-i', media], { timeout: 30_000, maxBuffer: 1024 * 1024 });
    probeLog = result.stderr;
  } catch (error) {
    probeLog = String((error as { stderr?: string }).stderr || '');
  }
  const match = probeLog.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const duration = match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : NaN;
  const fps = Number(probeLog.match(/Video:.*?([\d.]+)\s+fps/)?.[1]);
  if (!(duration > 0 && duration <= 180)) throw new Error('无法验证源视频实际时长，未发起 ASR');

  if (!executePaid) {
    console.log(JSON.stringify({
      status: 'preflight_passed',
      tenantId,
      id,
      duration,
      fps,
      sourceVideoSha256,
      paidRequestSubmitted: false,
      output: requestedOutput ? path.resolve(requestedOutput) : path.join(os.tmpdir(), 'lingshu-narration-regeneration-*'),
    }));
    return;
  }
  if (!authorizationEvidence) {
    throw new Error('付费 ASR 需要同时提供 --execute-paid 和 --authorization-evidence <授权凭据引用>');
  }

  const authorizationEvidenceSha256 = createHash('sha256').update(authorizationEvidence).digest('hex');
  const output = outputFolder();
  fs.mkdirSync(output, { recursive: true });
  const backup = path.join(output, 'reference-before.json');
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, JSON.stringify(record, null, 2), { mode: 0o600 });
  fs.writeFileSync(path.join(output, 'source-probe.log'), probeLog, { mode: 0o600 });
  fs.writeFileSync(path.join(output, 'authorization-evidence.json'), JSON.stringify({
    evidenceSha256: authorizationEvidenceSha256,
    capturedAt: new Date().toISOString(),
  }, null, 2), { mode: 0o600 });

  const result = await prepareReferenceNarration(media, duration, { tenantId });
  if (result.alignmentStatus !== 'aligned' || !result.words?.length) throw new Error('未获得真实词级时间戳，不写入对齐成功');
  fs.writeFileSync(path.join(output, 'measured-narration.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
  // Read again after the paid task so unrelated concurrent record changes survive.
  const current = await store.getById<any>('trend_videos', id);
  if (!current || current.tenantId !== tenantId) throw new Error('付费任务期间记录归属发生变化，拒绝写入');
  const currentAnalysis = typeof current.aiAnalysis === 'string' ? JSON.parse(current.aiAnalysis) : current.aiAnalysis;
  if (!currentAnalysis?.gemini?.scriptDetails15s?.length) throw new Error('该记录没有可对齐的分镜，未修改记录');
  const gemini = lockReferenceSpeechTimeline(currentAnalysis.gemini, result, { duration, ...(fps > 0 ? { fps } : {}) });
  if (!gemini.scriptDetails15s?.every(shot => shot.speechAlignment)) throw new Error('存在无效分镜时间，未修改记录');
  const updated = { ...currentAnalysis, gemini, speechAlignedAt: new Date().toISOString(),
    sourceSpeechAlignment: {
      version: 2,
      sourceVideoSha256,
      durationSeconds: duration,
      taskId: result.taskId,
      model: result.model,
      authorizationEvidenceSha256,
    } };
  if (!await store.update('trend_videos', id, { aiAnalysis: JSON.stringify(updated) })) throw new Error('Local save failed');
  const reloaded = await store.getById<any>('trend_videos', id);
  const persisted = typeof reloaded?.aiAnalysis === 'string' ? JSON.parse(reloaded.aiAnalysis) : reloaded?.aiAnalysis;
  if (persisted?.gemini?.audioTranscript?.taskId !== result.taskId || !persisted.gemini.scriptDetails15s.every((shot: any) => shot.speechAlignment)) {
    throw new Error('落库复读验收失败');
  }
  fs.writeFileSync(path.join(output, 'reference-after.json'), JSON.stringify(reloaded, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ id, tenantId, duration, fps, sourceVideoSha256, taskId: result.taskId, model: result.model,
    authorizationEvidenceSha256, wordCount: result.words.length, sentenceCount: result.segments.length,
    shotCount: gemini.scriptDetails15s?.length, speechAlignmentSummary: gemini.speechAlignmentSummary, output }));
});
