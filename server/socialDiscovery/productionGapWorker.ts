import { executeApprovedDiscoveryRun } from './service.js';
import {
  advanceProductionGapTask,
  completeProductionGapResume,
  persistReferenceSelection,
  recordProductionGapAttempt,
  ReferenceSelector,
  saveProductionGapTask,
  type InventoryCandidate,
  type ProductionGapTask,
  type ReferenceSelection,
  type VersionedReferenceSelection,
} from './orchestration.js';

export interface ProductionGapWorkerDependencies {
  loadInventory(task: ProductionGapTask): Promise<InventoryCandidate[]>;
  resumeUpstreamTask(task: ProductionGapTask): Promise<void>;
  executeRun?: typeof executeApprovedDiscoveryRun;
  persistSelection?: typeof persistReferenceSelection;
  saveTask?: typeof saveProductionGapTask;
}

/** Inventory first; one bounded top-up at a time; always leaves a recoverable task state. */
export async function runProductionGapWorker(
  task: ProductionGapTask,
  dependencies: ProductionGapWorkerDependencies,
): Promise<ProductionGapTask> {
  const saveTask = dependencies.saveTask ?? saveProductionGapTask;
  if (task.status === 'ready_to_resume') {
    try {
      await dependencies.resumeUpstreamTask(task);
      const resumed = completeProductionGapResume(task);
      await saveTask(resumed);
      return resumed;
    } catch (cause) {
      const recoverable = recordProductionGapAttempt(task, cause);
      await saveTask(recoverable);
      return recoverable;
    }
  }
  if (task.status !== 'collecting') return task;
  const selector = new ReferenceSelector();
  const select = (candidates: InventoryCandidate[]) => selector.select({
    candidates,
    requiredSceneIds: task.taskGap.requiredSceneIds,
    minimumReferences: task.taskGap.minimumReferences,
    requireProductionReady: task.taskGap.requiredReadiness === 'production_reference',
  });
  let selection: ReferenceSelection;
  const persistSelected = async (): Promise<VersionedReferenceSelection> => (dependencies.persistSelection ?? persistReferenceSelection)({
    tenantId: task.tenantId, upstreamTaskRef: task.upstreamTaskRef, selection,
  });
  try {
    selection = select(await dependencies.loadInventory(task));
  } catch (cause) {
    const recoverable = recordProductionGapAttempt(task, cause);
    await saveTask(recoverable);
    return recoverable;
  }
  if (selection.status === 'selected') {
    let persisted: VersionedReferenceSelection;
    try {
      persisted = await persistSelected();
    } catch (cause) {
      const recoverable = recordProductionGapAttempt(task, cause);
      await saveTask(recoverable);
      return recoverable;
    }
    const ready = advanceProductionGapTask({ task, selection, selectionSource: 'inventory', referenceSelectionRef: { selectionId: persisted.selectionId, version: persisted.version } });
    await saveTask(ready);
    return runProductionGapWorker(ready, dependencies);
  }
  if (task.budget.spentCny >= task.budget.limitCny) {
    const blocked = advanceProductionGapTask({ task, selection, addedCostCny: 0 });
    await saveTask(blocked);
    return blocked;
  }
  let result;
  try {
    result = await (dependencies.executeRun ?? executeApprovedDiscoveryRun)({
      tenantId: task.tenantId,
      triggerType: 'production_gap',
      requestedModes: task.taskGap.requestedModes,
      productionGapContext: {
        gapTaskId: task.gapTaskId,
        upstreamTaskRef: task.upstreamTaskRef,
        description: task.taskGap.description,
        remainingBudgetCny: task.budget.limitCny - task.budget.spentCny,
      },
    });
    selection = select(await dependencies.loadInventory(task));
  } catch (cause) {
    const recoverable = recordProductionGapAttempt(task, cause);
    await saveTask(recoverable);
    return recoverable;
  }
  const knownCost = result.run
    ? Object.values(result.run.modeStats).reduce<number | null>((sum, stats) => stats?.costCny === null || stats?.costCny === undefined || sum === null ? null : sum + stats.costCny, 0)
    : 0;
  // Unknown spend is not silently treated as free: reserve all remaining budget.
  const chargedCost = knownCost === null ? task.budget.limitCny - task.budget.spentCny : knownCost;
  let persisted: VersionedReferenceSelection | null = null;
  if (selection.status === 'selected') {
    try {
      persisted = await persistSelected();
    } catch (cause) {
      const recoverable = recordProductionGapAttempt(task, cause);
      await saveTask(recoverable);
      return recoverable;
    }
  }
  const updated = advanceProductionGapTask({
    task, selection, addedCostCny: chargedCost, runRef: result.run?.runId, selectionSource: 'collection',
    referenceSelectionRef: persisted ? { selectionId: persisted.selectionId, version: persisted.version } : null,
  });
  await saveTask(updated);
  return updated.status === 'ready_to_resume' ? runProductionGapWorker(updated, dependencies) : updated;
}
