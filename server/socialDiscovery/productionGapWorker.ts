import { executeApprovedDiscoveryRun } from './service.js';
import { advanceProductionGapTask, ReferenceSelector, saveProductionGapTask, type InventoryCandidate, type ProductionGapTask } from './orchestration.js';

export interface ProductionGapWorkerDependencies {
  loadInventory(task: ProductionGapTask): Promise<InventoryCandidate[]>;
  resumeUpstreamTask(task: ProductionGapTask): Promise<void>;
  executeRun?: typeof executeApprovedDiscoveryRun;
}

/** Inventory first; one bounded top-up at a time; always leaves a recoverable task state. */
export async function runProductionGapWorker(
  task: ProductionGapTask,
  dependencies: ProductionGapWorkerDependencies,
): Promise<ProductionGapTask> {
  if (task.status !== 'collecting') return task;
  const selector = new ReferenceSelector();
  const select = (candidates: InventoryCandidate[]) => selector.select({ candidates, minimumReferences: 1 });
  let selection = select(await dependencies.loadInventory(task));
  if (selection.status === 'selected') {
    const resumed = advanceProductionGapTask({ task, selection });
    await saveProductionGapTask(resumed);
    await dependencies.resumeUpstreamTask(resumed);
    return resumed;
  }
  if (task.spentCny >= task.budgetLimitCny) {
    const blocked = advanceProductionGapTask({ task, selection, addedCostCny: 0 });
    await saveProductionGapTask(blocked);
    return blocked;
  }
  const result = await (dependencies.executeRun ?? executeApprovedDiscoveryRun)({
    tenantId: task.tenantId,
    triggerType: 'production_gap',
    requestedModes: ['momentum', 'account', 'innovation'],
  });
  selection = select(await dependencies.loadInventory(task));
  const knownCost = result.run
    ? Object.values(result.run.modeStats).reduce<number | null>((sum, stats) => stats?.costCny === null || stats?.costCny === undefined || sum === null ? null : sum + stats.costCny, 0)
    : 0;
  // Unknown spend is not silently treated as free: reserve all remaining budget.
  const chargedCost = knownCost === null ? task.budgetLimitCny - task.spentCny : knownCost;
  const updated = advanceProductionGapTask({ task, selection, addedCostCny: chargedCost, runRef: result.run?.runId });
  await saveProductionGapTask(updated);
  if (updated.status === 'resumed') await dependencies.resumeUpstreamTask(updated);
  return updated;
}
