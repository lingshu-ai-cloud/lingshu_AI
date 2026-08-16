import { Router } from 'express';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { buildDailyTotals, buildMetricTrend, currentMetricTotal, SOCIAL_METRIC_KEYS } from '../socialMetrics/aggregation.js';
import { listSocialMetricSnapshots } from '../socialMetrics/store.js';

export const socialMetricsRouter = Router();
socialMetricsRouter.use(requireAuth);

function platformParam(value: unknown): string | undefined {
  const platform = typeof value === 'string' ? value.toLowerCase() : '';
  return ['facebook', 'instagram', 'tiktok', 'youtube'].includes(platform) ? platform : undefined;
}

socialMetricsRouter.get('/overview', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const platform = platformParam(req.query.platform);
  const days = Math.min(90, Math.max(7, Number(req.query.days) || 7));
  const snapshots = await listSocialMetricSnapshots(tenantId, platform);
  const platforms = [...new Set(snapshots.map(item => item.platform))];
  const metrics = SOCIAL_METRIC_KEYS.map(key => ({
    key,
    total: currentMetricTotal(snapshots, key),
    trend: buildMetricTrend(snapshots, key, days),
  }));
  res.json({
    periodDays: days,
    platforms,
    snapshotCount: snapshots.length,
    dataStatus: snapshots.length ? 'available' : 'not_connected_or_not_synced',
    totalSemantics: 'latest_observed_value_per_entity',
    trendSemantics: 'daily_increment',
    metrics,
  });
});

socialMetricsRouter.get('/trends', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const platform = platformParam(req.query.platform);
  const snapshots = await listSocialMetricSnapshots(tenantId, platform);
  const requested = typeof req.query.metric === 'string' ? req.query.metric : 'views';
  const metric = SOCIAL_METRIC_KEYS.find(key => key === requested) || 'views';
  res.json({
    metric,
    platform: platform || 'all',
    available: snapshots.some(item => typeof item.metrics[metric] === 'number'),
    pointSemantics: 'daily_increment',
    points: buildDailyTotals(snapshots, metric),
  });
});
