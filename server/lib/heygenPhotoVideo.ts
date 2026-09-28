import { HeyGenClient } from './heygen.js';
import { studioPaidBudget } from './studioPaidBudget.js';

/** The exact image is uploaded; no avatar-training step or fallback to a different identity. */
export async function generateHeyGenPhotoVideo(input: {
  bytes: Uint8Array; mimeType: string; voiceId: string; script: string; ratio: string; requestId: string;
  onSubmitted?: (id: string) => Promise<void> | void; client?: HeyGenClient;
  reserve?: (operationId: string) => Promise<void>; pollMs?: number; timeoutMs?: number;
}): Promise<{ taskId: string; videoUrl: string; duration: number }> {
  if (!input.voiceId.trim() || !input.script.trim()) throw new Error('请选择口播声音并确认台词');
  if (!['9:16', '16:9', '1:1'].includes(input.ratio)) throw new Error('照片口播画幅无效');
  const client = input.client || new HeyGenClient(process.env.HEYGEN_API_KEY || '');
  const imageAssetId = await client.uploadImage(input.bytes, input.mimeType, `${input.requestId}:image`);
  await (input.reserve || (id => studioPaidBudget.reserve('heygen', id)))(input.requestId);
  const taskId = await client.create({ avatarId: '', imageAssetId, voiceId: input.voiceId, script: input.script,
    ratio: input.ratio, transparent: false, title: '灵枢照片口播' }, input.requestId);
  await input.onSubmitted?.(taskId);
  const deadline = Date.now() + (input.timeoutMs ?? 30 * 60_000);
  while (Date.now() < deadline) {
    const result = await client.status(taskId);
    if (result.status === 'completed' && result.url && result.duration) return { taskId, videoUrl: result.url, duration: result.duration };
    if (result.status === 'failed') throw new Error(result.error || 'HeyGen照片口播生成失败');
    await new Promise(resolve => setTimeout(resolve, input.pollMs ?? 30_000));
  }
  throw new Error(`HeyGen照片口播仍在处理，任务 ${taskId} 已留档；请查询原任务，不要重复提交`);
}
