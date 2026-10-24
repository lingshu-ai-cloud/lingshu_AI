import type { DigitalEmployeeOverview } from './digitalEmployees';
import { safeDeliveryUrl, type DeliveryResource } from './delivery';

export interface EmployeeVideoDelivery {
  id: string;
  title: string;
  subject: string;
  url: string;
  status: string;
  approved: boolean;
  needsReview: boolean;
  updatedAt: string;
  reason: string;
  delivery: DeliveryResource;
}

/** Only persisted rendered outputs in this exact weekly run, never reference media. */
export function employeeVideoDeliveries(data: DigitalEmployeeOverview): EmployeeVideoDelivery[] {
  if (!data.goal?.id || !data.plan?.id || !data.run?.id
    || data.run.goal_id !== data.goal.id || data.run.plan_id !== data.plan.id) return [];
  const seen = new Set<string>();
  const mediaSeen = new Set<string>();
  return (data.deliveries || []).flatMap(delivery => {
    if (delivery.runId !== data.run!.id || delivery.kind !== '内容成片') return [];
    return delivery.artifacts.flatMap(artifact => {
      const url = artifact.kind === 'video' ? safeDeliveryUrl(artifact.url) : '';
      const id = `${delivery.id}:${artifact.id}`;
      if (!url || seen.has(id)) return [];
      let identity: URL;
      try { identity = new URL(url, 'http://local'); } catch { return []; }
      // Ignore this server's temporary signature only; other query fields can
      // identify distinct versions/assets and must remain part of identity.
      identity.searchParams.delete('assetToken');
      identity.pathname = identity.pathname.replace(/\/signed\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\//, '/');
      const mediaId = identity.href;
      if (mediaSeen.has(mediaId)) return [];
      seen.add(id);
      mediaSeen.add(mediaId);
      const failedSample = artifact.label === '质检失败样片';
      return [{ id, title: delivery.title, subject: delivery.subject, url,
        status: artifact.label || delivery.stage, approved: !failedSample && delivery.contentApproval?.approved === true,
        needsReview: !failedSample && Boolean(delivery.contentApproval && !delivery.contentApproval.approved),
        updatedAt: delivery.deliveredAt || delivery.updatedAt, reason: delivery.reason, delivery }];
    });
  });
}

/** Shared boundary rule for wheel, touch and visible navigation controls. */
export function nextEmployeeVideoIndex(index: number, direction: number, length: number): number {
  return Math.max(0, Math.min(Math.max(0, length - 1), index + Math.sign(direction)));
}
