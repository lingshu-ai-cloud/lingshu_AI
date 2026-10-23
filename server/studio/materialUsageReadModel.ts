import { store } from '../storage/index.js';
import { type StudioMaterialPublishLink, type StudioMaterialUsageProject } from '../lib/materialUsageTracking.js';


export function recordValue(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, any> : {};
    } catch { /* malformed durable evidence is ignored */ }
  }
  return {};
}

export async function listAllTenantRows<T extends { id?: string }>(collection: string, tenantId: string): Promise<T[]> {
  const rows: T[] = [];
  const identities = new Set<string>();
  let expectedTotal: number | null = null;
  for (let page = 1; page <= 10_000; page += 1) {
    const result = await store.list<T>(collection, { where: { tenant_id: tenantId }, page, perPage: 500 });
    if (!Number.isSafeInteger(result.totalItems) || result.totalItems < 0
      || expectedTotal !== null && result.totalItems !== expectedTotal) throw new Error(`${collection}_scan_changed`);
    expectedTotal = result.totalItems;
    for (const row of result.items) {
      const identity = String(row.id || '').trim();
      if (identity && identities.has(identity)) throw new Error(`${collection}_scan_duplicate`);
      if (identity) identities.add(identity);
      rows.push(row);
    }
    if (rows.length === expectedTotal) return rows;
    if (!result.items.length || rows.length > expectedTotal) throw new Error(`${collection}_scan_incomplete`);
  }
  throw new Error(`${collection}_scan_limit`);
}

export async function loadDurableMaterialPublishLinks(
  tenantId: string,
  projects: StudioMaterialUsageProject[],
): Promise<StudioMaterialPublishLink[]> {
  const scopedProjects = projects.flatMap(project => {
    const artifactId = String(recordValue(recordValue(project.spec).socialProductionOutput).artifactId || '').trim();
    return artifactId ? [{ project, artifactId }] : [];
  });
  if (!scopedProjects.length) return [];
  const [artifacts, assignments, attempts, metricSnapshots] = await Promise.all([
    listAllTenantRows<Record<string, any>>('starter_social_content_artifacts', tenantId),
    listAllTenantRows<Record<string, any>>('social_publication_assignments', tenantId),
    listAllTenantRows<Record<string, any>>('social_publication_attempts', tenantId),
    listAllTenantRows<Record<string, any>>('social_metric_snapshots', tenantId),
  ]);
  const links: StudioMaterialPublishLink[] = [];
  for (const { project, artifactId } of scopedProjects) {
    const artifact = artifacts.find(item => String(item.artifact_id || '') === artifactId);
    const productionResultId = String(recordValue(recordValue(artifact?.content).productionResult).productionResultId || '').trim();
    if (!productionResultId) continue;
    for (const assignment of assignments.filter(item => String(item.production_result_id || '') === productionResultId)) {
      for (const attempt of attempts.filter(item => item.assignment_id === assignment.assignment_id
        && item.status === 'published' && String(item.platform_post_id || '').trim())) {
        const resolvedAt = String(attempt.resolved_at || attempt.updated_at || '').trim();
        const snapshots = metricSnapshots.filter(item => item.account_id === assignment.account_id
          && item.platform === assignment.platform
          && String(item.content_id || '') === String(attempt.platform_post_id)
          && !item.mock && !item.simulated && !/mock|simulat/i.test(String(item.source || ''))
          && (!resolvedAt || Date.parse(String(item.captured_at || '')) >= Date.parse(resolvedAt)))
          .sort((a, b) => Date.parse(String(b.captured_at || '')) - Date.parse(String(a.captured_at || '')));
        const latestMetrics = recordValue(snapshots[0]?.metrics);
        links.push({
          id: String(attempt.attempt_id || attempt.id || ''),
          projectId: project.id,
          platform: String(assignment.platform || ''),
          publishedAt: resolvedAt,
          publishResult: { ok: true, deliveryStatus: 'published', platformPostId: attempt.platform_post_id },
          metrics: snapshots.length ? Object.fromEntries(
            (['views', 'likes', 'comments', 'shares'] as const)
              .filter(key => typeof latestMetrics[key] === 'number' && Number.isFinite(latestMetrics[key]) && latestMetrics[key] >= 0)
              .map(key => [key, latestMetrics[key]]),
          ) : undefined,
        });
      }
    }
  }
  return links;
}
