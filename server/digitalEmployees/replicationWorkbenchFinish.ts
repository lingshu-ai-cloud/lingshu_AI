import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-static';
import { readMaterialLibrary, type MaterialRecord } from '../lib/materialLibrary.js';
import { readTenantMaterialBytes } from '../lib/sentenceReplicationProduction.js';
import { measureAvatarSourceCaptions } from '../lib/avatarSourceCaptions.js';
import { studioPaidBudget } from '../lib/studioPaidBudget.js';
import { withPaidOperationLock } from '../lib/paidOperationLock.js';
import { synthesizeStudioVoiceForAutomation } from '../routes/studio.js';
import { inspectRenderedVisuals, inspectRenderedScenes } from '../lib/renderVisualQuality.js';
import { paginateAlignedCues, subtitleCuesAreSafe } from '../lib/subtitleCues.js';
import { finishContent } from './contentFinish.js';
import { CONTENT_SCRIPT_QUALITY_RULE_VERSION } from './contentQualityContract.js';
import { store } from '../storage/index.js';
import { digitalHumanQualityState } from '../../src/lib/digitalHumanQuality.js';
import { shotFingerprint } from '../../src/lib/shotProduction.js';

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const composite = (require('../../desktop/render.cjs') as { composite: (manifest: any, progress?: unknown, outputDir?: string) => Promise<{ ok: boolean; outputPath?: string; error?: string }> }).composite;
type Cue = { start: number; end: number; text: string };
type Probe = { duration: number; hasAudio: boolean };
const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const normalizedSpeech = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

async function probe(file: string): Promise<Probe> {
  const result = await run(String(ffmpeg || 'ffmpeg'), ['-hide_banner', '-nostdin', '-xerror', '-protocol_whitelist', 'file,pipe', '-f', 'mov', '-i', file, '-map', '0:v:0', '-map', '0:a:0?', '-f', 'null', '-'], { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
  const time = result.stderr.match(/Duration: (\d+):(\d+):([\d.]+)/);
  if (!time || !/Stream .*Video:/.test(result.stderr)) throw new Error('逐镜复刻视频无法完整解码');
  return { duration: Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]), hasAudio: /Stream .*Audio:/.test(result.stderr) };
}

export type ReplicationFinishDependencies = {
  materials?: () => MaterialRecord[] | Promise<MaterialRecord[]>;
  readMaterial?: typeof readTenantMaterialBytes;
  probe?: typeof probe;
  captions?: typeof measureAvatarSourceCaptions;
  reserveAsr?: (id: string) => Promise<unknown>;
  verifyPersonAdoption?: (value: { tenantId: string; projectId: string; assemblyId: string; shotId: string; materialId: string; contentSha256: string; adoption: any }) => Promise<void>;
  synthesize?: typeof synthesizeStudioVoiceForAutomation;
  render?: typeof composite;
  visuals?: typeof inspectRenderedVisuals;
  scenes?: typeof inspectRenderedScenes;
  finish?: typeof finishContent;
  workRoot?: string;
};

/** Finish only a fully adopted, real-video workbench. Never borrow reference audio. */
export async function finishReplicationWorkbench(input: { tenantId: string; projectId: string; spec: Record<string, any> }, deps: ReplicationFinishDependencies = {}): Promise<Record<string, any>> {
  const { tenantId, projectId, spec } = input;
  const shots = spec.automatedReplicationShots as Array<{ shotId: string; slotId: string; kind: 'person' | 'nonperson' | 'blocked'; start: number; end: number; productionState?: 'ready' | 'blocked'; blocker?: string; fingerprintContext?: string }>;
  if (!tenantId || !projectId || !Array.isArray(shots) || !shots.length || shots.length > 32) throw new Error('逐镜装配缺少有效时间轴');
  const blocked = shots.filter(shot => shot.kind === 'blocked' || shot.productionState === 'blocked');
  if (blocked.length) throw new Error(`逐镜装配仍有必需镜头未就绪：${blocked.map(shot => shot.blocker || shot.shotId).join('；')}`);
  const root = path.resolve(deps.workRoot || 'data/replication-workbench-finish', digest(`${tenantId}:${projectId}`));
  return withPaidOperationLock(path.join(root, '.locks'), 'finish', async () => {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const materials = deps.materials ? await deps.materials() : (await readMaterialLibrary(tenantId)).items;
    const timeline: any[] = [];
    const cues: Cue[] = [];
    const receipts: any[] = [];
    const voiceFiles: string[] = [];
    let voiceCursor = 0, cursor = 0;
    const language = String(spec.activeVoiceLang || spec.lang || 'en');
    for (const [index, slot] of shots.entries()) {
      const materialId = String(spec.storyboardAssignments?.[slot.slotId] || '');
      const material = materials.find(item => String(item.id) === materialId);
      if (!material || material.type !== 'video' || String(material.tenantId || material.tenant_id || '') !== tenantId || material.scope !== 'own') throw new Error(`第 ${index + 1} 镜缺少本企业真实替换视频`);
      if (/reference|viral-sentence-first-frame|catalog/i.test(String(material.sourceType || '')) || material.usage === 'analysis') throw new Error(`第 ${index + 1} 镜仍是分析参考素材，禁止出片`);
      const production = spec.shotProductions?.[`${spec.activeAssemblyId}:${slot.shotId}`];
      const adopted = production?.candidates?.find((candidate: any) => candidate.id === production.adoptedId && candidate.materialId === materialId);
      const progress = spec.automatedReplicationProgress?.[slot.shotId];
      if (!adopted && !(progress?.adopted === true && progress.materialId === materialId && progress.qualityChecked === true)) throw new Error(`第 ${index + 1} 镜未采用当前替换视频候选`);
      const loaded = await (deps.readMaterial || readTenantMaterialBytes)(material, tenantId);
      const hash = digest(loaded.bytes);
      if (material.contentSha256 && material.contentSha256 !== hash) throw new Error(`第 ${index + 1} 镜素材哈希已变化`);
      if (progress?.videoContentSha256 && progress.videoContentSha256 !== hash) throw new Error(`第 ${index + 1} 镜已质检视频内容已变化`);
      const file = path.join(root, `${hash}.mp4`);
      if (!fs.existsSync(file)) fs.writeFileSync(file, loaded.bytes, { mode: 0o600 });
      const media = await (deps.probe || probe)(file);
      const targetDuration = Number(slot.end) - Number(slot.start);
      const trimStart = slot.kind === 'person' ? 0 : Number(spec.clipEdits?.[slot.slotId]?.trimStart ?? spec.automatedReplicationMaterialMatches?.[slot.slotId]?.trimStart ?? progress?.trimStart ?? 0);
      if (!(targetDuration > 0) || !Number.isFinite(trimStart) || trimStart < 0 || media.duration + .05 < trimStart + targetDuration) throw new Error(`第 ${index + 1} 镜视频短于装配时长，禁止静帧补齐`);
      const base = { index, name: material.name, type: 'video', url: `data:video/mp4;base64,${loaded.bytes.toString('base64')}`, targetStart: cursor, targetDuration, trimStart, trimEnd: trimStart + targetDuration, speed: 1 };
      const narration = String(production?.narration || '').trim();
      if (!narration && slot.kind === 'nonperson') {
        timeline.push({ ...base, production: { sound: 'silent' } });
        receipts.push({ shotId: slot.shotId, materialId, contentSha256: hash, audioSource: 'intentional_silence', captionSource: 'no_frozen_narration' });
        cursor += targetDuration;
        continue;
      }
      if (slot.kind === 'person') {
        const adoption = spec.digitalHumanAssemblyAdoptions?.[`${spec.activeAssemblyId}:${slot.shotId}`];
        if (!adoption?.executionId || adoption.materialId !== materialId || adoption.candidateContentSha256 !== hash) throw new Error(`第 ${index + 1} 镜缺少当前数字人执行装配凭据`);
        if (shotFingerprint(production, String(slot.fingerprintContext || spec.shotProductionContext || ''), slot.shotId) !== adoption.fingerprint) throw new Error(`第 ${index + 1} 镜采用后参数已变化，请重新生成并采用当前版本`);
        const proof = { tenantId, projectId, assemblyId: String(spec.activeAssemblyId), shotId: slot.shotId, materialId, contentSha256: hash, adoption };
        if (deps.verifyPersonAdoption) await deps.verifyPersonAdoption(proof);
        else {
          const execution = await store.getById<any>('studio_digital_human_executions', adoption.executionId);
          const payload = execution?.payload;
          if (!execution || execution.tenant_id !== tenantId || execution.project_id !== projectId || payload?.state !== 'completed'
            || payload.assemblyId !== proof.assemblyId || payload.shotId !== slot.shotId || payload.materialId !== materialId
            || payload.candidateOutput?.contentSha256 !== hash || payload.adoption?.materialId !== materialId
            || payload.fingerprint !== adoption.fingerprint || digitalHumanQualityState(payload.quality?.checks || []) !== 'accepted') throw new Error(`第 ${index + 1} 镜数字人执行质量或版本凭据失效`);
        }
        const tasks = material.providerTaskId ? [material.providerTaskId] : material.providerTaskIds;
        if ((narration && !media.hasAudio) || !Array.isArray(tasks) || !tasks.length || !['digital-human-sentence-video', 'viral-sentence-replication'].includes(String(material.sourceType))) throw new Error(`第 ${index + 1} 镜缺少真实数字人原声音轨或供应商凭据`);
        if (!narration) {
          timeline.push({ ...base, production: { sound: 'silent' } });
          receipts.push({ shotId: slot.shotId, materialId, contentSha256: hash, providerTaskIds: tasks, executionId: adoption.executionId, audioSource: 'intentional_silence', captionSource: 'no_frozen_narration' });
          cursor += targetDuration;
          continue;
        }
        const captionFile = path.join(root, `${hash}.captions.json`);
        let measured: Awaited<ReturnType<typeof measureAvatarSourceCaptions>>;
        if (fs.existsSync(captionFile)) measured = JSON.parse(fs.readFileSync(captionFile, 'utf8'));
        else {
          await (deps.reserveAsr || (id => studioPaidBudget.reserve('qwen_asr', id)))(`replication-finish:${tenantId}:${projectId}:${hash}`);
          measured = await (deps.captions || measureAvatarSourceCaptions)({ ...material, duration: media.duration }, tenantId, loaded.bytes);
          if (measured.sourceHash !== hash || !measured.cues.length) throw new Error(`第 ${index + 1} 镜原声字幕缺少实测绑定`);
          fs.writeFileSync(captionFile, JSON.stringify(measured), { mode: 0o600 });
        }
        if (measured.sourceHash !== hash || !measured.provenance || !measured.cues.length) throw new Error('人物原声字幕缓存与视频不符');
        const expectedSpeech = normalizedSpeech(String(production?.narration || ''));
        if (!expectedSpeech || normalizedSpeech(measured.transcript) !== expectedSpeech) throw new Error(`第 ${index + 1} 镜实测人物口播与冻结脚本不一致，请修复生成或转写`);
        if (measured.cues.some(cue => cue.end > targetDuration + .05)) throw new Error(`第 ${index + 1} 镜裁切会截断人物口播，需重新规划时长`);
        cues.push(...measured.cues.map(cue => ({ start: cursor + cue.start, end: cursor + cue.end, text: cue.text })));
        timeline.push({ ...base, production: { sound: 'source' } });
        receipts.push({ shotId: slot.shotId, materialId, contentSha256: hash, providerTaskIds: tasks, executionId: adoption.executionId, audioSource: 'generated_video', captionSource: measured.provenance });
      } else {
        const voiceKey = digest(JSON.stringify({ tenantId, projectId, slot: slot.shotId, narration, language, voice: spec.voice || 'v1' }));
        const voiceReceipt = path.join(root, `${voiceKey}.voice.json`);
        let voice: Awaited<ReturnType<typeof synthesizeStudioVoiceForAutomation>> & { audioSha256?: string };
        if (fs.existsSync(voiceReceipt)) voice = JSON.parse(fs.readFileSync(voiceReceipt, 'utf8'));
        else {
          // Reserve an intent before TTS. An interrupted request is reconciled instead of charged again.
          const intent = path.join(root, `${voiceKey}.intent`);
          if (fs.existsSync(intent)) throw new Error(`第 ${index + 1} 镜配音请求状态未知，请核对原请求，禁止重复计费`);
          fs.writeFileSync(intent, new Date().toISOString(), { flag: 'wx', mode: 0o600 });
          voice = await (deps.synthesize || synthesizeStudioVoiceForAutomation)({ tenantId, text: narration, language, voice: String(spec.voice || 'v1'), targetDuration, sentenceLines: [narration], measuredSentenceTiming: true });
          if (!voice.ok || !voice.localPath || !voice.duration || !voice.cues?.length || voice.text !== narration || voice.alignmentSource !== 'synthesized_sentence_audio' || voice.qualityReport?.passed !== true) throw new Error(`第 ${index + 1} 镜配音未通过真实声音与实测对齐检查：${voice.error || '缺少证据'}`);
          voice.audioSha256 = digest(fs.readFileSync(voice.localPath));
          fs.writeFileSync(voiceReceipt, JSON.stringify(voice), { mode: 0o600 });
          fs.unlinkSync(intent);
        }
        if (!voice.localPath || !fs.existsSync(voice.localPath) || !voice.duration || !voice.cues?.length || voice.text !== narration || voice.qualityReport?.passed !== true || voice.alignmentSource !== 'synthesized_sentence_audio') throw new Error(`第 ${index + 1} 镜实测配音缓存无效`);
        if (!voice.audioSha256 || digest(fs.readFileSync(voice.localPath)) !== voice.audioSha256) throw new Error(`第 ${index + 1} 镜配音文件版本已变化`);
        if (voice.duration > targetDuration + .01) throw new Error(`第 ${index + 1} 镜实测口播 ${voice.duration.toFixed(2)} 秒超过镜头 ${targetDuration.toFixed(2)} 秒，禁止自动加速或截断`);
        cues.push(...voice.cues.map(cue => ({ start: cursor + cue.start, end: cursor + cue.end, text: cue.text })));
        timeline.push({ ...base, production: { sound: 'voiceover' }, voiceAligned: true, voiceStart: voiceCursor, voiceEnd: voiceCursor + voice.duration });
        voiceFiles.push(voice.localPath); voiceCursor += voice.duration;
        receipts.push({ shotId: slot.shotId, materialId, contentSha256: hash, audioSource: voice.source, audioSha256: voice.audioSha256, captionSource: voice.alignmentSource });
      }
      cursor += targetDuration;
    }
    const subtitles = paginateAlignedCues(cues, cursor);
    if (!subtitles || !subtitleCuesAreSafe(subtitles, cursor)) throw new Error('最终字幕缺少有效的实测音频时间轴');
    let voiceover: { url: string } | undefined;
    if (voiceFiles.length) {
      const voicePath = path.join(root, `voice-${digest(voiceFiles.join(':'))}.wav`);
      if (!fs.existsSync(voicePath)) await run(String(ffmpeg || 'ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-nostdin', ...voiceFiles.flatMap(file => ['-i', file]), '-filter_complex', voiceFiles.map((_, i) => `[${i}:a]`).join('') + `concat=n=${voiceFiles.length}:v=0:a=1[out]`, '-map', '[out]', '-c:a', 'pcm_s16le', '-y', voicePath], { timeout: 120_000 });
      voiceover = { url: `data:audio/wav;base64,${fs.readFileSync(voicePath).toString('base64')}` };
    }
    const fingerprint = digest(JSON.stringify({ receipts, subtitles, ratio: spec.ratio, duration: cursor }));
    const outputDir = path.resolve('data/publishing-uploads', tenantId.replace(/[^\w.-]+/g, '-'));
    fs.mkdirSync(outputDir, { recursive: true });
    const result = await (deps.render || composite)({ jobId: `replication-${fingerprint.slice(0, 24)}`, requireVisualAssets: true,
      spec: { ratio: spec.ratio || '9:16', resolution: spec.exportSpec?.resolution || '1080p', duration: cursor, language, voiceVol: 100, bgmVol: 0 }, timeline, voiceover,
      subtitles: { mode: 'target', cues: subtitles, style: spec.subtitleStyle || {} } }, undefined, outputDir);
    if (!result.ok || !result.outputPath || !fs.existsSync(result.outputPath)) throw new Error(`逐镜成片合成失败：${result.error || '无输出文件'}`);
    const visuals = await (deps.visuals || inspectRenderedVisuals)({ outputPath: result.outputPath, expectedDuration: cursor, expectedUniqueScenes: Math.min(2, shots.length), minSharpFrameRatio: .5, evidenceDir: path.join(outputDir, `${fingerprint}-quality`) });
    let sceneCursor = 0;
    const scenes = await (deps.scenes || inspectRenderedScenes)({ outputPath: result.outputPath, requireDistinct: false, scenes: timeline.map(item => { const start = sceneCursor; sceneCursor += item.targetDuration; return { start, end: sceneCursor }; }) });
    if (!visuals.passed || !scenes.passed) throw new Error(`逐镜成片自动质检失败：${[...visuals.failures, ...scenes.issues.map(issue => issue.reason)].join('；')}`);
    const finished = await (deps.finish || finishContent)(result.outputPath, { ...spec, duration: cursor, bgm: null, bgmVol: 0 });
    return { ...finished, duration: cursor, renderOutputPath: result.outputPath, activeStepId: 'preview', subtitlesOn: true, subMode: 'target', alignedCuesByLang: { ...(spec.alignedCuesByLang || {}), [language]: subtitles }, subtitleAlignmentSource: 'replication_measured_audio',
      automatedReplicationFinish: { fingerprint, receipts, outputContentSha256: digest(fs.readFileSync(result.outputPath)), audioPolicy: 'generated_person_source_and_measured_nonperson_tts', checkedAt: new Date().toISOString() },
      automation: { ...spec.automation, stage: 'completed', status: 'ready_for_approval', approvalState: 'ready_for_approval', blocker: '', renderOutputPath: result.outputPath, completedAt: new Date().toISOString(), quality: { passed: true, ruleVersion: CONTENT_SCRIPT_QUALITY_RULE_VERSION, checks: { perShotReplication: true, actualVideoBound: true, voiceAndSubtitles: true, visualContent: true }, visualMetrics: visuals.metrics, evidenceFrames: visuals.evidenceFrames, sceneDiagnostics: scenes, outputBytes: fs.statSync(result.outputPath).size } } };
  });
}
