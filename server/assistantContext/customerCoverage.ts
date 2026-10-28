import { readSceneCustomers } from './businessScenes/customerEvidence.js';
/** Same tenant-admitted read model as the customer workspace; summary only, no contact or message text. */
export function summarizeCustomerCoverage(rows: Record<string, unknown>[]) {
  const count = (predicate: (row: Record<string, unknown>) => boolean) => rows.filter(predicate).length;
  return { state: 'available' as const, source: 'customer_workspace_read_model', returnedProfiles: rows.length,
    verifiedLiveProfiles: count(row => row.isReal === true && row.isHistorical !== true && row.isMock !== true && row.test_record !== true && row.isTest !== true && row.readOnly !== true),
    historicalProfiles: count(row => row.isHistorical === true), localProfiles: count(row => row.isLocal === true),
    testProfiles: count(row => row.isMock === true || row.test_record === true || row.isTest === true), readOnlyProfiles: count(row => row.readOnly === true),
    profilesWithMessages: count(row => Array.isArray(row.timeline) && row.timeline.length > 0),
    scope: '客户页当前授权读模型返回的档案覆盖；各分类可能重叠，不相加。档案、消息、报价询盘和新增询盘事件是不同对象，不能相互替代。历史、本地、测试资料即使展示也不是当期真实询盘；返回零不证明平台历史没有客户。' };
}
export async function readCustomerCoverage(tenantId: string, read = readSceneCustomers) {
  const rows = await read(tenantId);
  if (rows.some(row => row.tenantId !== undefined && row.tenantId !== tenantId)) throw Error('customer_coverage_scope_invalid');
  return summarizeCustomerCoverage(rows);
}
export type CustomerCoverage = Awaited<ReturnType<typeof readCustomerCoverage>> | { state: 'unavailable'; source: 'customer_workspace_read_model' };
