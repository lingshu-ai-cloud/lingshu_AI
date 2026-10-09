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
import path from 'node:path';
const execute = promisify(execFile);
const argument = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const id = argument('--id') || 'trend_videos_192e76d4b21244c4a2922e60672c95f2';
const tenantId = 'local_tenant_customer_1b2913131e2c46deab66172228c4df0a';
const folder = path.resolve(argument('--output') || `data/acceptance/narration-regeneration-${id}`);
await runWithDataAuthority('local', async () => {
  const record = await store.getById<any>('trend_videos', id);
  if (!record || record.tenantId !== tenantId) throw new Error('Wrong local record');
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
  try { const result = await execute(String(ffmpegStatic || 'ffmpeg'), ['-hide_banner', '-i', media], { timeout: 30_000, maxBuffer: 1024 * 1024 }); probeLog = result.stderr; }
  catch (error) { probeLog = String((error as { stderr?: string }).stderr || ''); }
  const match = probeLog.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const duration = match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : NaN;
  const fps = Number(probeLog.match(/Video:.*?([\d.]+)\s+fps/)?.[1]);
  if (!(duration > 0 && duration <= 180)) throw new Error('无法验证源视频实际时长，未发起 ASR');
  fs.mkdirSync(folder, { recursive: true });
  const backup = path.join(folder, 'reference-before.json');
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, JSON.stringify(record, null, 2), { mode: 0o600 });
  fs.writeFileSync(path.join(folder, 'source-probe.log'), probeLog);
  const result = await prepareReferenceNarration(media, duration, { tenantId });
  if (result.alignmentStatus !== 'aligned' || !result.words?.length) throw new Error('未获得真实词级时间戳，不写入对齐成功');
  fs.writeFileSync(path.join(folder, 'measured-narration.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
  // Read again after the paid task so unrelated concurrent record changes survive.
  const current = await store.getById<any>('trend_videos', id);
  if (!current || current.tenantId !== tenantId) throw new Error('Local record changed ownership');
  const currentAnalysis = typeof current.aiAnalysis === 'string' ? JSON.parse(current.aiAnalysis) : current.aiAnalysis;
  if (!currentAnalysis?.gemini?.scriptDetails15s?.length) throw new Error('该记录没有可对齐的分镜，未修改记录');
  const gemini = lockReferenceSpeechTimeline(currentAnalysis.gemini, result, { duration, ...(fps > 0 ? { fps } : {}) });
  if (!gemini.scriptDetails15s?.every(shot => shot.speechAlignment)) throw new Error('存在无效分镜时间，未修改记录');
  const updated = { ...currentAnalysis, gemini, speechAlignedAt: new Date().toISOString(),
    sourceSpeechAlignment: { version: 2, sourceVideoSha256, durationSeconds: duration, taskId: result.taskId, model: result.model } };
  if (!await store.update('trend_videos', id, { aiAnalysis: JSON.stringify(updated) })) throw new Error('Local save failed');
  const reloaded = await store.getById<any>('trend_videos', id);
  const persisted = typeof reloaded?.aiAnalysis === 'string' ? JSON.parse(reloaded.aiAnalysis) : reloaded?.aiAnalysis;
  if (persisted?.gemini?.audioTranscript?.taskId !== result.taskId || !persisted.gemini.scriptDetails15s.every((shot: any) => shot.speechAlignment)) throw new Error('落库复读验收失败');
  fs.writeFileSync(path.join(folder, 'reference-after.json'), JSON.stringify(reloaded, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ id, duration, fps, sourceVideoSha256, taskId: result.taskId, model: result.model,
    wordCount: result.words.length, sentenceCount: result.segments.length, shotCount: gemini.scriptDetails15s?.length,
    speechAlignmentSummary: gemini.speechAlignmentSummary, output: folder }));
});
