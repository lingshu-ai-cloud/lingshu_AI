import '../server/loadEnvironment.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SeedanceReferenceAdapter } from '../server/lib/seedanceReferenceAdapter.js';

/** Historical one-shot diagnostic. This did not submit the benchmark hook video,
 * so its output cannot be used to claim high-fidelity hook replication. */
const outputDir = path.resolve('data/analysis-output/seedance-hook-sales-2026-09-28');
const journalPath = path.join(outputDir, 'seedance-task.json');
const salesAsset = 'asset://asset-20260925130116-xjmzj';
await fs.mkdir(outputDir, { recursive: true });
try {
  await fs.access(journalPath);
  throw new Error(`任务日志已存在，禁止重复付费提交：${journalPath}`);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

const journal: Record<string, unknown> = {
  state: 'submission_started', submittedAt: new Date().toISOString(),
  model: process.env.SEEDANCE_MODEL, characterAsset: salesAsset,
  inputPolicy: '仅提交已登记销售人物视频；对标视频未作为供应商输入',
  durationSeconds: 4, resolution: '480p', generateAudio: false,
  estimatedUpperBoundCny: 4.816,
};
await fs.writeFile(journalPath, JSON.stringify(journal, null, 2));
const save = async () => fs.writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
const adapter = new SeedanceReferenceAdapter({
  apiKey: process.env.SEEDANCE_API_KEY || '',
  model: process.env.SEEDANCE_MODEL || 'doubao-seedance-2-0-fast-260128',
  baseUrl: process.env.SEEDANCE_BASE_URL,
  estimatedCostCnyPerSecond: 1.204,
  resolution: '480p', generateAudio: false,
});
try {
  const result = await adapter.submit({
    characterUrl: salesAsset, characterType: 'video', referenceVideoUrl: salesAsset,
    ratio: '9:16', targetDurationSeconds: 4,
    shot: { digitalHuman: {
      action: '用参考的已授权企业销售人物重新演绎一段短视频开场。画面开始时人物面向镜头，一只手在面部旁边；前1秒手快速向镜头伸出，手指弯曲成敲门般的近镜手势，完成两次短促向前动作，随后手迅速回落。后3秒人物站稳正对镜头，双手自然展开，准备口播。动作清晰、节奏紧凑；不需要说话。',
      scene: '9:16 竖屏、单一连续镜头，真实的整洁工厂工作区；中近景开场，机位基本稳定。人物面部、手和身体持续可见；手部靠近镜头时可以短暂遮挡脸部，但不能变形或多出手指。',
      preserve: '严格保持企业销售人物的脸部身份、发型和服装在全片一致。不出现原参考片人物、产品包装、品牌文字、字幕、水印、画外音、配乐或音效。',
    } },
  });
  journal.externalTaskId = result.externalTaskId;
  journal.state = 'submitted'; journal.acceptedAt = new Date().toISOString(); await save();
  console.log(`TASK_ID=${result.externalTaskId}`);
  for (;;) {
    const status = await adapter.status(result.externalTaskId);
    journal.state = status.state; journal.lastPolledAt = new Date().toISOString();
    if (status.state === 'completed') journal.outputUrl = status.outputUrl;
    if (status.state === 'failed') journal.error = status.error;
    await save(); console.log(`STATE=${status.state}`);
    if (status.state === 'failed') throw new Error(status.error || 'Seedance task failed');
    if (status.state === 'completed') {
      const response = await fetch(status.outputUrl, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`Seedance output download HTTP ${response.status}`);
      const outputPath = path.join(outputDir, 'seedance-sales-hook-4s.mp4');
      await fs.writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
      journal.outputPath = outputPath; journal.downloadedAt = new Date().toISOString(); await save();
      console.log(`OUTPUT=${outputPath}`); break;
    }
    await new Promise(resolve => setTimeout(resolve, 8_000));
  }
} catch (error) {
  journal.state = journal.externalTaskId ? 'failed_after_submission' : 'stopped_without_task';
  journal.error = error instanceof Error ? error.message : String(error);
  journal.stoppedAt = new Date().toISOString(); await save();
  throw error;
}
