import type { DataStore, Record_ } from '../../storage/datastore.js';
import { store } from '../../storage/index.js';
import type { BusinessSceneSelection } from '../../../shared/contracts/assistantBusinessScene.js';
import { inWindow, object, pick, scanTenantRecords } from './readScope.js';
const definitions = [
  ['weekly_goals', 'starts_at', '经营目标'], ['workflow_tasks', 'updated_at', '任务状态更新'],
  ['approval_requests', 'created_at', '审批申请'], ['weekly_reviews', 'created_at', '经营复盘'],
  ['social_weekly_execution_tasks', 'updated_at', '经营执行任务'], ['starter_social_content_tasks', 'updated_at', '内容任务状态更新'],
  ['starter_social_publications', 'published_at', '发布登记'], ['starter_social_metric_submissions', 'captured_at', '效果证据采集'],
  ['posts', 'published_at', '所选期间发布的内容'], ['starter_quote_inquiries', 'created_at', '报价询盘'],
  ['tenant_orders', 'orderDate', '订单台账'],
] as const;
const finite = (v: unknown) => (typeof v === 'number' || typeof v === 'string' && v.trim()) && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null;
function summary(rows: Record_[], collection: string) {
  const byStatus: Record<string, number> = Object.create(null);
  for (const row of rows) { const status = String(row.status || object(row.order).status || 'unknown'); byStatus[status] = (byStatus[status] || 0) + 1; }
  const base = { recordsInPeriod: rows.length, byStatus };
  if (collection === 'posts') {
    const byPlatform: Record<string, { posts: number; views: number | null }> = Object.create(null);
    const byAccount: Record<string, { posts: number; views: number | null }> = Object.create(null);
    for (const row of rows) {
      const key = String(row.platform || 'unknown'), count = finite(object(row.stats).views ?? object(row.stats).playCount);
      const entry = byPlatform[key] ?? { posts: 0, views: 0 }; entry.posts++;
      entry.views = entry.views === null || count === null ? null : entry.views + count; byPlatform[key] = entry;
      const accountKey = String(row.account_id || row.accountId || object(row.stats).accountId || 'unknown');
      const account = byAccount[`${key}:${accountKey}`] ?? { posts: 0, views: 0 }; account.posts++;
      account.views = account.views === null || count === null ? null : account.views + count; byAccount[`${key}:${accountKey}`] = account;
    }
    return { ...base, byPlatform, byAccount, metricScope: '按发布时间筛选的内容及其已存累计播放值；不是所选期间新增播放。未知值不补零。' };
  }
  if (collection === 'tenant_orders') {
    const byCurrency: Record<string, { paidOrders: number; recordedPaidAmount: number | null }> = Object.create(null);
    for (const row of rows) {
      const order = object(row.order);
      if (!['paid', 'completed', 'fulfilled'].includes(String(order.status)) || !order.paidAt) continue;
      const key = String(order.currency || 'unknown'), amount = finite(order.amount), entry = byCurrency[key] ?? { paidOrders: 0, recordedPaidAmount: 0 };
      entry.paidOrders++; entry.recordedPaidAmount = amount === null || entry.recordedPaidAmount === null ? null : entry.recordedPaidAmount + amount; byCurrency[key] = entry;
    }
    return { ...base, byCurrency, metricScope: '仅为台账中的已付金额；未扣退款、税费或成本，币种不明不能与已知币种合计，不作为净收入。' };
  }
  return base;
}
export async function operatingSceneEvidence(tenantId: string, selection: BusinessSceneSelection, data: Pick<DataStore, 'list'> = store) {
  const sources = await Promise.all(definitions.map(async ([collection, dateField, label]) => {
    try {
      const rows = await scanTenantRecords(data, collection, tenantId);
      let missingDateCount = 0, testRowsExcluded = 0;
      const selected = rows.filter(row => {
        if (row.test_record === true || object(row.order).isTest === true) { testRowsExcluded++; return false; }
        const value = collection === 'tenant_orders' ? object(row.order).orderDate : row[dateField];
        if (!value || !Number.isFinite(Date.parse(String(value)))) { missingDateCount++; return false; }
        return inWindow(value, selection.from, selection.to);
      });
      const tasks = ['workflow_tasks', 'social_weekly_execution_tasks', 'starter_social_content_tasks'].includes(collection);
      const backlog = tasks ? rows.filter(row => !['completed', 'succeeded', 'cancelled', 'closed', 'published', 'reviewed'].includes(String(row.status))) : [];
      return { collection, label, currentBacklog: tasks ? { asOf: new Date().toISOString(), ...summary(backlog, collection), examples: backlog.slice(0, 20).map(row => ({ ...pick(row, ['id', 'title', 'status', 'blocked_reason', 'updated_at']), brief: pick(object(row.brief), ['title', 'objective']) })), exampleScope: '最多20条当前未结束任务样例；汇总覆盖全部已核验记录，不受更新时间筛选，避免遗漏历史遗留待办。' } : undefined, state: missingDateCount ? 'partial_dates' : 'complete', scannedRecords: rows.length, missingDateCount, testRowsExcluded,
        period: { from: selection.from, to: selection.to, timezone: 'Asia/Shanghai', field: dateField }, summary: summary(selected, collection),
        examples: selected.slice(0, 4).map(row => ({ ...pick(row, ['id', 'title', 'status', dateField]), brief: pick(object(row.brief), ['title', 'objective']) })),
        exampleScope: '样例至多4条；summary由完整分页后所选日期内全部可核验记录计算。缺少业务日期的记录排除并单独计数。' };
    } catch { return { collection, label, state: 'unavailable', summary: null, errorCode: 'scene_operating_source_unavailable' }; }
  }));
  const accounts = await Promise.all(['social_accounts', 'youtube_accounts'].map(async collection => {
    try { const rows = await scanTenantRecords(data, collection, tenantId, 'tenantId'); return { collection, state: 'complete', items: rows.map(row => pick(row, ['id', 'name', 'title', 'platform', 'status', 'viewCount', 'views', 'subscriberCount', 'updatedAt', 'lastSyncedAt'])) }; }
    catch { return { collection, state: 'unavailable', items: null }; }
  }));
  return { generatedAt: new Date().toISOString(), sources, accounts,
    rules: '每项时间字段和统计对象独立：任务按更新时间，不代表当周创建或完成；目标按开始时间，不代表完成结果。任务数不是成片数，发布登记不是渠道成功回执，询盘不是订单。partial_dates不能当作全量期间结果，unavailable不能解读为零。不同来源不可相加，不同币种不可合并。' };
}
