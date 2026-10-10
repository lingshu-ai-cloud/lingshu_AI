import type { WeeklyExecutionTask } from '../../../shared/contracts/socialProgram';
import type { AgentCalendarTask } from '../smartBusiness/AgentWeeklyCalendar';
import { validPublicationExecutionTarget } from './publicationExecutionCalendarNavigation';

type InventoryTarget = NonNullable<AgentCalendarTask['inventoryTarget']>;
export interface CalendarPublicationScope {
  tenantId: string; programId: string; packageId: string; packageVersion: number;
}
export type CalendarPublicationDestination =
  | { kind: 'publishing'; task: WeeklyExecutionTask }
  | { kind: 'inventory_approval'; task: WeeklyExecutionTask; target: InventoryTarget };

/** Frozen inventory references belong to several steps; only the content approval owns this entrance. */
export function executionInventoryApprovalTarget(task: WeeklyExecutionTask): InventoryTarget | null {
  if (task.workflowKind !== 'content' || task.schedule.stepKind !== 'user_approval'
    || !task.tenantId || !task.programId || !task.packageId || !task.publicationTaskId
    || !task.taskId || !Number.isSafeInteger(task.packageVersion) || task.packageVersion <= 0) return null;
  const publication = task.inputSnapshot?.publicationTask as {
    publicationTaskId?: string; inventoryReuseRef?: { type?: string; id?: string; version?: number };
  } | undefined;
  const ref = publication?.inventoryReuseRef;
  if (!ref || ref.type !== 'weekly_inventory_binding' || ref.version !== 1 || !ref.id
    || publication?.publicationTaskId !== task.publicationTaskId) return null;
  return {
    tenantId: task.tenantId, programId: task.programId, packageId: task.packageId,
    packageVersion: task.packageVersion, taskId: task.taskId,
    publicationTaskId: task.publicationTaskId, bindingId: ref.id,
  };
}

/** Dispatch by the unique persisted workflow and step, never by target property ordering. */
export function validatedCalendarPublicationDestination(
  card: AgentCalendarTask, scope: CalendarPublicationScope, tasks: WeeklyExecutionTask[],
): CalendarPublicationDestination | null {
  if (!scope.tenantId || !scope.programId || !scope.packageId
    || !Number.isSafeInteger(scope.packageVersion) || scope.packageVersion <= 0) return null;
  const matches = tasks.filter(task => task.taskId === card.id && task.tenantId === scope.tenantId
    && task.programId === scope.programId && task.packageId === scope.packageId && task.packageVersion === scope.packageVersion);
  if (matches.length !== 1) return null;
  const task = matches[0]!;
  if (card.executionStep !== undefined && card.executionStep !== task.schedule.stepKind) return null;
  if (task.workflowKind === 'publishing' && task.schedule.stepKind === 'publishing') {
    const valid = validPublicationExecutionTarget(card, scope, tasks);
    return valid === task ? { kind: 'publishing', task } : null;
  }
  const expected = executionInventoryApprovalTarget(task);
  const target = card.inventoryTarget;
  if (!expected || !target || Object.entries(expected).some(([key, value]) => target[key as keyof InventoryTarget] !== value)) return null;
  return { kind: 'inventory_approval', task, target };
}
