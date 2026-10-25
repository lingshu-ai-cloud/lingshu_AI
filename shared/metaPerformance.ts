export const META_PERFORMANCE_FIELDS = {
  spend: { field: 'spend', label: '花费', unit: 'money' },
  impressions: { field: 'impressions', label: '展示次数', unit: 'count' },
  clicks: { field: 'clicks', label: '点击次数（全部）', unit: 'count' },
  linkClicks: { field: 'inline_link_clicks', label: '链接点击', unit: 'count' },
  thruPlays: { field: 'video_thruplay_watched_actions', label: 'ThruPlay', unit: 'count' },
  reach: { field: 'reach', label: '覆盖人数（不累加）', unit: 'count' },
  frequency: { field: 'frequency', label: '展示频次（不平均）', unit: 'ratio' },
  cpm: { field: 'cpm', label: 'CPM', unit: 'money' },
  cpc: { field: 'cpc', label: 'CPC（全部点击）', unit: 'money' },
  ctr: { field: 'ctr', label: 'CTR（全部点击）', unit: 'percent' },
  linkCtr: { field: 'inline_link_click_ctr', label: '链接点击率', unit: 'percent' },
  costPerLinkClick: { field: 'cost_per_inline_link_click', label: '单次链接点击成本', unit: 'money' },
  costPerThruPlay: { field: 'cost_per_thruplay', label: '单次 ThruPlay 成本', unit: 'money' },
  instantFormLeads: { field: 'actions', actionType: 'onsite_conversion.lead_grouped', label: 'Meta 即时表单线索', unit: 'count' },
  websiteLeads: { field: 'actions', actionType: 'offsite_conversion.fb_pixel_lead', label: '网站 Lead 事件', unit: 'count' },
  leads: { field: 'actions', actionType: 'lead', label: 'Meta 归因线索（lead）', unit: 'count' },
  messagingConversations: { field: 'actions', actionType: 'onsite_conversion.messaging_conversation_started_7d', label: 'Meta 新消息会话', unit: 'count' },
  purchaseValue: { field: 'action_values', actionType: 'omni_purchase', label: 'Meta 归因购买金额', unit: 'money' },
  purchaseRoas: { field: 'purchase_roas', actionType: 'omni_purchase', label: 'Meta 购买 ROAS（非利润 ROI）', unit: 'ratio' },
} as const;
export type MetaMetricKey = keyof typeof META_PERFORMANCE_FIELDS;
export type MetaMetricValues = Record<MetaMetricKey, number | null>;
export type MetaReportLevel = 'campaign' | 'adset' | 'ad';
export interface MetaPerformanceReport {
  source: 'provider'; level: MetaReportLevel; resourceId: string; executionId: string;
  videoId: string; pageId: string;
  accountId: string; accountName: string; currency: string; reportTimezone: string;
  configuredStatus: string; effectiveStatus: string; objective: string; optimizationGoal: string;
  adConfiguredStatus: string; adEffectiveStatus: string;
  attributionSpec: Array<{ event_type: string; window_days: number }>;
  issues: Array<{ code: number; message: string }>;
  window: { since: string; until: string }; reportedAt: string;
  actionReportTime: 'impression'; useUnifiedAttributionSetting: true;
  totals: MetaMetricValues | null; daily: Array<MetaMetricValues & { date: string }>;
  historyScope?: 'maximum'; windowAvailable?: boolean;
}
export function metaAccountDate(timeZone: string, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function metaDateRange(since: string, until: string) {
  const start = Date.parse(`${since}T12:00:00Z`), end = Date.parse(`${until}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(until) || !Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 92 * 86400000 || new Date(start).toISOString().slice(0, 10) !== since || new Date(end).toISOString().slice(0, 10) !== until) return [];
  return Array.from({ length: Math.round((end - start) / 86400000) + 1 }, (_, i) => new Date(start + i * 86400000).toISOString().slice(0, 10));
}
/** Only additive metrics, same scope/account/currency/timezone/window, de-duplicated resource IDs. */
export function metaPerformanceSummary(reports: MetaPerformanceReport[], expected: number) {
  const unique = [...new Map(reports.map(r => [`${r.accountId}:${r.level}:${r.resourceId}`, r])).values()];
  const first = unique[0];
  const compatible = unique.every(r => r.accountId === first?.accountId && r.level === first?.level && r.currency === first?.currency && r.reportTimezone === first?.reportTimezone && r.window.since === first?.window.since && r.window.until === first?.window.until);
  const total = (key: 'spend' | 'impressions' | 'clicks' | 'linkClicks') => compatible && unique.length === expected && expected > 0 && unique.every(r => r.totals?.[key] != null) ? unique.reduce((n, r) => n + r.totals![key]!, 0) : null;
  return { spend: total('spend'), impressions: total('impressions'), clicks: total('clicks'), linkClicks: total('linkClicks') };
}
