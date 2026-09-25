import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from 'dotenv';
import { SeedanceReferenceAdapter } from '../server/lib/seedanceReferenceAdapter.js';

config({ path: path.resolve('.env.local'), quiet: true });

const [characterUrl, referenceVideoUrl, outputDirArg, characterTypeArg = 'image'] = process.argv.slice(2);
if (!characterUrl || !referenceVideoUrl || !outputDirArg || !['image', 'video'].includes(characterTypeArg)) {
  throw new Error('usage: characterUrl referenceVideoUrl outputDir [image|video]');
}
const characterType = characterTypeArg as 'image' | 'video';
const outputDir = path.resolve(outputDirArg);
const journalPath = path.join(outputDir, 'seedance-task.json');
await fs.mkdir(outputDir, { recursive: true });

let journal: Record<string, unknown> = {};
try { journal = JSON.parse(await fs.readFile(journalPath, 'utf8')); } catch {}
if (journal.submissionStartedAt) throw new Error(`refusing a second paid submission; inspect ${journalPath}`);

const estimatedUpperBoundCny = 4.816;
await fs.writeFile(journalPath, JSON.stringify({
  submissionStartedAt: new Date().toISOString(),
  model: process.env.SEEDANCE_MODEL,
  resolution: '480p',
  durationSeconds: 4,
  generateAudio: false,
  characterType,
  purpose: '爆款裂变：参考视频重新演绎（可信资产链路验证）',
  estimatedUpperBoundCny,
  state: 'submission_started',
}, null, 2));

const adapter = new SeedanceReferenceAdapter({
  apiKey: process.env.SEEDANCE_API_KEY || '',
  model: process.env.SEEDANCE_MODEL || 'doubao-seedance-2-0-fast-260128',
  baseUrl: process.env.SEEDANCE_BASE_URL,
  estimatedCostCnyPerSecond: 1.204,
  resolution: '480p',
  generateAudio: false,
});

try {
  const submitted = await adapter.submit({
    characterUrl,
    characterType,
    referenceVideoUrl,
    ratio: '9:16',
    targetDurationSeconds: 4,
    shot: { digitalHuman: {
      action: '按参考视频中的动作、表情、镜头节奏重新演绎一条4秒B2B销售开场，人物面对镜头自然抬手示意',
      scene: '保持参考视频的镜头位置、构图、背景和光线稳定',
      preserve: '保持销售人物的身份和面部特征一致；不添加字幕、水印或额外人物',
    } },
  });
  journal = { ...journal, externalTaskId: submitted.externalTaskId, state: 'submitted', submittedAt: new Date().toISOString() };
  await fs.writeFile(journalPath, JSON.stringify(journal, null, 2));
  process.stdout.write(`TASK_ID=${submitted.externalTaskId}\n`);

  for (;;) {
    const status = await adapter.status(submitted.externalTaskId);
    journal = { ...journal, state: status.state, lastPolledAt: new Date().toISOString(), ...(status.state === 'completed' ? { outputUrl: status.outputUrl } : {}), ...(status.state === 'failed' ? { error: status.error } : {}) };
    await fs.writeFile(journalPath, JSON.stringify(journal, null, 2));
    process.stdout.write(`STATE=${status.state}\n`);
    if (status.state === 'failed') throw new Error(status.error || 'Seedance task failed');
    if (status.state === 'completed') {
      const response = await fetch(status.outputUrl);
      if (!response.ok) throw new Error(`output download failed: HTTP ${response.status}`);
      const outputPath = path.join(outputDir, 'seedance-reference-4s.mp4');
      await fs.writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
      journal = { ...journal, outputPath, downloadedAt: new Date().toISOString() };
      await fs.writeFile(journalPath, JSON.stringify(journal, null, 2));
      process.stdout.write(`OUTPUT=${outputPath}\n`);
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 8_000));
  }
} catch (error) {
  journal = { ...journal, state: 'stopped_without_retry', stoppedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) };
  await fs.writeFile(journalPath, JSON.stringify(journal, null, 2));
  throw error;
}
