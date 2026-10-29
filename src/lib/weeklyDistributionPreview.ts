import type { VideoCreationPlan } from '../../shared/contracts/videoCreationPlan';
import type { WeeklyPackage } from './weeklyPackage';
import { balancedWeeklyPublishSlots } from '../../shared/contracts/weeklyPublishSchedule';

export const weeklyDistributionPlatforms = ['facebook', 'linkedin'] as const;
export function weeklyDistributionPreview(pack: WeeklyPackage | undefined, startsAt: string, endsAt: string) {
  const plans = pack?.tasks.find(task => task.templateId === 'production')?.videoPlans || [];
  const originals = plans.filter(plan => plan.productionRole !== 'platform_adaptation');
  const mixedSlots = pack?.mixedContentSlots || [];
  const originalVideoSlots = mixedSlots.filter(slot => slot.kind === 'video' && slot.productionRole === 'original');
  const planBySlotId = new Map(originalVideoSlots.map((slot, index) => [slot.slotId, originals[index]] as const));
  const media = (plan: VideoCreationPlan | undefined, index: number) => ({
    title: plan?.publication?.title || plan?.preproduction?.benchmark.title || plan?.planningEvidence?.referenceTitle || `视频 ${index + 1}（标题待确认）`,
    thumbnail: plan?.preproduction?.benchmark.thumbnailUrl || plan?.planningEvidence?.referenceThumbnailUrl
      || (plan?.referenceId ? `/api/overseas/videos/${encodeURIComponent(plan.referenceId)}/thumbnail` : ''),
  });
  const rows = mixedSlots.length ? mixedSlots.map((slot, index) => {
    const source = mixedSlots.find(item => item.slotId === slot.originalSlotId) || slot;
    const plan = source.kind === 'video' ? planBySlotId.get(source.slotId) : undefined;
    return { key: slot.slotId, kind: source.kind, platform: slot.platform, account: slot.accountId,
      ...(source.kind === 'video' ? media(plan, index) : { title: source.referenceTitle || '图文标题待确认', thumbnail: source.referenceThumbnailUrl || (source.referenceId ? `/api/overseas/videos/${encodeURIComponent(source.referenceId)}/thumbnail` : '') }),
      reused: slot.productionRole === 'adaptation' };
  }) : plans.map((plan, index) => ({
    key: plan.contentId || `legacy-${index}`, kind: 'video' as const,
    platform: (weeklyDistributionPlatforms as readonly string[]).includes(plan.platform) ? plan.platform : weeklyDistributionPlatforms[index % weeklyDistributionPlatforms.length]!,
    account: plan.matrix?.accountId || '', ...media(plan, index), reused: plan.productionRole === 'platform_adaptation',
  }));
  const start = Date.parse(`${startsAt}T00:00:00Z`);
  const seventhDay = Number.isFinite(start) ? new Date(start + 6 * 86_400_000).toISOString().slice(0, 10) : endsAt;
  const weekEnd = endsAt && endsAt < seventhDay ? endsAt : seventhDay;
  // Presentation of the provisional plan only; never rewrites frozen publication jobs.
  const slots = balancedWeeklyPublishSlots(startsAt, weekEnd, rows.map(row => `${row.platform}:${row.account}`));
  return rows.map((row, index) => ({ ...row, date: slots[index]?.date || '', scheduledAt: slots[index]?.scheduledAt || '' }))
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt) || a.key.localeCompare(b.key));
}
