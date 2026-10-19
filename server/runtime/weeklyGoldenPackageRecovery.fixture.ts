/**
 * Sanitised structural baseline for weekly-package recovery regressions.
 *
 * This is deliberately not an export of a live tenant.  It contains no
 * credentials, provider payloads, asset URLs, or customer content.  Tests
 * should seed the existing weekly-package fixtures from these invariants and
 * exercise the real recovery modules against the same durable store.
 */
export const WEEKLY_GOLDEN_PACKAGE_BASELINE = {
  fixtureVersion: 'weekly-golden-package-v1',
  naturalWeekPolicy: 'latest_only',
  historicalWeekPolicy: 'audit_only',
  restartRequired: true,
  expectedBoundaries: {
    templateAcceptedOnce: true,
    userRequiredBeforeFinalReview: false,
    automaticBudgetIncrease: false,
    publishingAuthorized: false,
    messagingAuthorized: false,
  },
  requiredBranches: ['business_outline', 'benchmark_collection'],
} as const;

export type WeeklyRecoveryFault = {
  id: string;
  originalBlockedState: string;
  durableEvidence: string;
  restartTrigger: string;
  expectedRecovery: string;
  mustNotHappen: readonly string[];
  regressionOwner: string;
};

export const WEEKLY_RECOVERY_FAULT_MATRIX: readonly WeeklyRecoveryFault[] = [
  {
    id: 'execution_window_required',
    originalBlockedState: 'weekly_preproduction_execution_window_required',
    durableEvidence: '原 job、周包版本与已接受模板',
    restartTrigger: '预生产窗口可用后重启扫描器',
    expectedRecovery: '同包同版本同任务重新评估并继续',
    mustNotHappen: ['要求用户再次接受模板', '用新周包替代原阻塞状态'],
    regressionOwner: 'weekly preproduction recovery',
  },
  {
    id: 'durable_gate_busy',
    originalBlockedState: 'package durable lease busy',
    durableEvidence: '既有租约与等待中的任务',
    restartTrigger: '租约释放后重启或定时扫描',
    expectedRecovery: '恢复器自动重试等待任务',
    mustNotHappen: ['标记执行器失败', '创建用户决策卡'],
    regressionOwner: 'durable lease recovery',
  },
  {
    id: 'orphan_local_store_lock',
    originalBlockedState: 'orphan local-store lock',
    durableEvidence: '锁文件、持有者与过期时间',
    restartTrigger: '进程重启后的锁恢复检查',
    expectedRecovery: '仅回收可证明已孤立的锁并继续原任务',
    mustNotHappen: ['删除有效锁', '创建重复执行'],
    regressionOwner: 'local store lock recovery',
  },
  {
    id: 'provider_outcome_unknown',
    originalBlockedState: 'running without verifiable provider receipt',
    durableEvidence: '原运行键、running 状态与最后心跳',
    restartTrigger: '超过恢复时限后重启扫描器',
    expectedRecovery: '结算为 weekly_discovery_original_execution_interrupted',
    mustNotHappen: ['再次付费提交', '永久保持 pending'],
    regressionOwner: 'weekly discovery interruption recovery',
  },
  {
    id: 'retired_discovery_scope',
    originalBlockedState: 'weekly_preproduction_scope_changed',
    durableEvidence: '旧范围、当前批准范围与 migration receipt',
    restartTrigger: '采集范围迁移扫描器重启',
    expectedRecovery: '仅为最新自然周创建不可变修订并重新绑定',
    mustNotHappen: ['原地修改旧 job', '修订历史自然周'],
    regressionOwner: 'weekly discovery scope migration',
  },
  {
    id: 'migration_binding_interrupted',
    originalBlockedState: 'revision committed before downstream binding',
    durableEvidence: '未完成 migration receipt 与已创建修订版本',
    restartTrigger: '迁移扫描器重启',
    expectedRecovery: '从 receipt 恢复既有修订的接线',
    mustNotHappen: ['再次创建修订', '改写源版本'],
    regressionOwner: 'weekly discovery scope migration',
  },
  {
    id: 'historical_week_candidate',
    originalBlockedState: 'historical week still has stale scope',
    durableEvidence: '项目全部自然周及各自最新版本',
    restartTrigger: '恢复扫描器重启',
    expectedRecovery: '历史周只保留审计并标记既有意图 superseded',
    mustNotHappen: ['自动修订历史周', '把历史周选作恢复目标'],
    regressionOwner: 'latest natural week selection',
  },
  {
    id: 'whole_graph_schedule_blocked',
    originalBlockedState: 'whole graph schedule unavailable',
    durableEvidence: '已接受模板与 independent admission',
    restartTrigger: '重启后的独立预生产消费者扫描',
    expectedRecovery: '经营提纲与采集分支在原修订版本独立推进',
    mustNotHappen: ['授权发布', '授权消息发送'],
    regressionOwner: 'weekly independent admission',
  },
  {
    id: 'daily_collection_limit_cross_day',
    originalBlockedState: 'daily_collection_limit_reached',
    durableEvidence: '原运行、当日配额账本与业务日期',
    restartTrigger: '下一业务日按正常日额度重启扫描',
    expectedRecovery: '以新尝试身份继续并保留原运行',
    mustNotHappen: ['复用临时加次授权', '静默重置额度', '覆盖原运行'],
    regressionOwner: 'weekly preproduction retry attempts',
  },
] as const;
