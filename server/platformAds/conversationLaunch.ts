import { z } from 'zod';
import { getPlatformAdTask, changePlatformAdManagement, withPlatformAdTaskLock, PlatformAdTaskValidationError, PlatformAdTaskConflictError } from './tasks.js';
import { validatePlatformAdCreativeSource } from './creatives.js';
import { getAdCreativePreview } from './creativeLibrary.js';
import { saveAdLaunch } from './launch.js';
import { assertAdReleaseAction } from './releasePolicy.js';
import { validateMetaVideoInput } from './metaAdapter.js';

export const conversationLaunchSchema = z.object({
  expectedVersion: z.number().int().positive(), creativeId: z.string().min(1).max(100), pageId: z.string().regex(/^\d+$/),
  launchMode: z.enum(['create_paused', 'create_and_activate']),
  expiresAt: z.string().datetime({ offset: true }),
  lead: z.object({ messageDestination: z.string(), whatsappPhoneNumber: z.string(), instagramActorId: z.string(), instagramUsername: z.string(), leadFormId: z.string(), pixelId: z.string() }).strict(),
}).strict();
export const conversationLaunchReaders = {
  lock: withPlatformAdTaskLock, task: getPlatformAdTask, creative: validatePlatformAdCreativeSource,
  preview: getAdCreativePreview, management: changePlatformAdManagement, launch: saveAdLaunch, release: assertAdReleaseAction,
};

/** Reuses the same plan, limited grant, launch ledger and worker. No provider creation in HTTP. */
export async function enqueueConversationPlan(tenantId: string, userId: string, taskId: string, raw: unknown, read = conversationLaunchReaders) {
  const input = conversationLaunchSchema.parse(raw);
  return read.lock(tenantId, `conversation-${taskId}`, async () => {
    const task = await read.task(tenantId, taskId);
    if (!task || task.status !== 'draft' || task.managementMode !== 'manual' || task.version !== input.expectedVersion) throw new PlatformAdTaskConflictError('计划或授权状态已变化，请到计划管理核对原记录，不要重复创建。');
    const config = task.configuration, connectionId = config.accountConnectionId;
    if (!connectionId || !task.channels.length || !task.channels.every(c => ['Facebook', 'Instagram'].includes(c))) throw new PlatformAdTaskValidationError('当前对话入队仅支持已选择账户的 Meta 计划。');
    read.release('meta', input.launchMode === 'create_paused' ? 'create' : 'activate');
    const creative = await read.creative(tenantId, input.creativeId);
    if (creative.taskId !== task.id || creative.taskVersion !== task.version || creative.connectionId !== connectionId || creative.status !== 'ready' || !config.materialSource || creative.sha256 !== config.materialSource.sha256 || creative.sourceTaskId !== config.materialSource.sourceTaskId || creative.artifactId !== config.materialSource.artifactId) throw new PlatformAdTaskConflictError('素材、账户或计划版本已变化，请重新核对素材。');
    const preview = await read.preview(tenantId, creative.id);
    const meta = validateMetaVideoInput({ ...input.lead, pageId: input.pageId, videoId: preview.videoId, imageUrl: preview.thumbnailUrl,
      linkUrl: config.landingPageUrl || '', message: config.adMessage || '', countries: config.countries || [], dailyBudget: config.dailyBudget, targeting: config.metaTargeting }, task.budget, task.goal);
    const managed = await read.management(tenantId, userId, task.id, { expectedVersion: task.version, managementMode: 'managed', authorization: {
      accountIds: [connectionId], allowedActions: input.launchMode === 'create_paused' ? ['create'] : ['create', 'activate'], maxDailyBudget: meta.dailyBudget, maxTotalBudget: task.budget, maxAdjustmentPercent: 0, expiresAt: input.expiresAt,
    } });
    if (!managed) throw new PlatformAdTaskConflictError('计划已不可访问。');
    const launch = await read.launch(tenantId, task.id, { expectedVersion: managed.version, connectionId, launchMode: input.launchMode, meta });
    return { task: managed, launch };
  });
}
