export interface MetaPlanAuditEntry {
  executionId: string; connectionId: string; accountId: string; accountName: string; currency: string; timezone: string;
  campaignId: string; adsetId: string; creativeId: string; adId: string;
  pageId: string; videoId: string; linkUrl: string; objective: string; optimizationGoal: string; destinationType: string; billingEvent: string;
  spendCap: number | null; dailyBudget: number | null; startsAt: string; endsAt: string; countries: string[]; platforms: string[];
  campaignStatus: string; adsetStatus: string; adStatus: string; adEffectiveStatus: string;
  issues: Array<{ code: number; message: string }>;
  bindingId: string; sha256: string; mapping: 'creation_binding' | 'post_execution' | 'unmapped';
  checks: Array<{ name: string; status: 'pass' | 'warning' | 'mismatch'; detail: string }>;
}
export interface MetaPlanAudit { taskId: string; taskVersion: number; checkedAt: string; entries: MetaPlanAuditEntry[]; truncated: boolean; pendingCount: number }
export interface MetaSetup {
  account: { id: string; name: string; currency: string; timezone: string; status: number; minSpendCap: number | null; minDailyBudget: number | null };
  pages: Array<{ id: string; name: string; tasks: string[] }>; hasMorePages: boolean;
}
