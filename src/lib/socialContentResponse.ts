import type {
  SocialContentSourceOptionPage,
  SocialContentTaskDetail,
  SocialContentTaskPage,
  SocialContentTaskSummary,
  SocialContentWorkspace,
} from '../../shared/contracts/socialContentWorkflow';
import { SOCIAL_CONTENT_TASK_STATUSES } from '../../shared/contracts/socialContentWorkflow';

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function invalidResponse(): never {
  throw new Error('读取到的内容不完整，请重新加载');
}

function nonNegativeInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validTime(value: unknown, nullable = false): boolean {
  if (nullable && value === null) return true;
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

const MUTATION_IDENTITY_FIELD = {
  source: 'sourceId',
  artifact: 'artifactId',
  deliveryPackage: 'packageId',
  publication: 'publicationId',
  metricSubmission: 'submissionId',
} as const;

function taskSummary(value: unknown): SocialContentTaskSummary {
  const item = record(value);
  const brief = record(item?.brief);
  const readiness = record(item?.readiness);
  const countFields = ['sourceCount', 'artifactCount', 'approvedArtifactCount', 'deliveryPackageCount', 'publicationCount', 'metricSubmissionCount'];
  if (!item || !brief
    || typeof item.taskId !== 'string' || typeof item.version !== 'string'
    || !SOCIAL_CONTENT_TASK_STATUSES.includes(item.status as typeof SOCIAL_CONTENT_TASK_STATUSES[number])
    || typeof brief.title !== 'string' || typeof brief.objective !== 'string'
    || !Array.isArray(brief.markets) || !Array.isArray(brief.languages) || !Array.isArray(brief.platforms) || !Array.isArray(brief.formats)
    || !validTime(brief.dueAt, true) || !Array.isArray(item.packageSelection)
    || !readiness || typeof readiness.complete !== 'boolean' || !Array.isArray(readiness.missing)
    || !readiness.missing.every(missing => typeof missing === 'string')
    || !countFields.every(field => nonNegativeInteger(item[field]))
    || !validTime(item.createdAt) || !validTime(item.updatedAt)) invalidResponse();
  return item as unknown as SocialContentTaskSummary;
}

export function socialTaskDetail(value: unknown): SocialContentTaskDetail {
  const task = taskSummary(value) as SocialContentTaskDetail;
  if (!Array.isArray(task.sources) || !Array.isArray(task.artifacts) || !Array.isArray(task.deliveryPackages)
    || !Array.isArray(task.publications) || !Array.isArray(task.metricSubmissions)) invalidResponse();
  return task;
}

export function socialTaskEnvelope(value: unknown): SocialContentTaskDetail {
  const envelope = record(value);
  if (!envelope) invalidResponse();
  return socialTaskDetail(envelope.task);
}

export function socialMutationEnvelope<T extends keyof typeof MUTATION_IDENTITY_FIELD>(value: unknown, entityKey: T): Record<T, Record<string, unknown>> & { task: SocialContentTaskDetail } {
  const envelope = record(value);
  const entity = record(envelope?.[entityKey]);
  const identityField = MUTATION_IDENTITY_FIELD[entityKey];
  if (!envelope || !entity || typeof entity[identityField] !== 'string' || !String(entity[identityField]).trim()) invalidResponse();
  const task = socialTaskDetail(envelope.task);
  if (typeof entity.taskId !== 'string' || entity.taskId !== task.taskId) invalidResponse();
  return { ...envelope, [entityKey]: entity, task } as Record<T, Record<string, unknown>> & { task: SocialContentTaskDetail };
}

export function socialTaskPage(value: unknown): SocialContentTaskPage {
  const result = record(value);
  if (!result || !Array.isArray(result.items)
    || !nonNegativeInteger(result.page) || Number(result.page) < 1
    || !nonNegativeInteger(result.perPage) || Number(result.perPage) < 1 || Number(result.perPage) > 100
    || !nonNegativeInteger(result.totalItems) || !nonNegativeInteger(result.totalPages)) invalidResponse();
  const page = Number(result.page);
  const perPage = Number(result.perPage);
  const totalItems = Number(result.totalItems);
  const totalPages = Number(result.totalPages);
  if (totalPages !== (totalItems === 0 ? 0 : Math.ceil(totalItems / perPage))
    || result.items.length > perPage || result.items.length > totalItems
    || (page > totalPages && result.items.length > 0)) invalidResponse();
  const tasks = result.items.map(taskSummary);
  if (new Set(tasks.map(task => task.taskId)).size !== tasks.length) invalidResponse();
  return { items: tasks, page, perPage, totalItems, totalPages };
}

export function socialWorkspaceResponse(value: unknown): SocialContentWorkspace {
  const workspace = record(value);
  if (!workspace || !Array.isArray(workspace.catalog) || !Array.isArray(workspace.tasks)
    || !record(workspace.taskList) || (workspace.currentTask !== null && !record(workspace.currentTask))) invalidResponse();
  const tasks = socialTaskPage({ ...workspace.taskList as Record<string, unknown>, items: workspace.tasks }).items;
  const currentTask = workspace.currentTask ? socialTaskDetail(workspace.currentTask) : null;
  if (currentTask && !tasks.some(task => task.taskId === currentTask.taskId)) invalidResponse();
  for (const card of workspace.catalog) {
    const item = record(card);
    if (!item || typeof item.kind !== 'string' || typeof item.packageKey !== 'string'
      || typeof item.version !== 'string' || typeof item.name !== 'string' || typeof item.available !== 'boolean'
      || !Array.isArray(item.requiredInputs) || !Array.isArray(item.deliverables)) invalidResponse();
  }
  return workspace as unknown as SocialContentWorkspace;
}

export function socialSourceOptionPage(value: unknown): SocialContentSourceOptionPage {
  const page = record(value);
  if (!page || !Array.isArray(page.items) || !['ready', 'partial', 'unavailable'].includes(String(page.status))
    || !nonNegativeInteger(page.page) || Number(page.page) < 1 || !nonNegativeInteger(page.perPage) || Number(page.perPage) < 1
    || !nonNegativeInteger(page.totalItems) || !nonNegativeInteger(page.totalPages)) invalidResponse();
  for (const option of page.items) {
    const item = record(option);
    if (!item || typeof item.optionId !== 'string' || !['knowledge', 'material'].includes(String(item.kind))
      || typeof item.sourceRef !== 'string' || typeof item.sourceVersion !== 'string'
      || typeof item.label !== 'string' || typeof item.type !== 'string'
      || (item.thumbnailHref !== null && typeof item.thumbnailHref !== 'string')) invalidResponse();
  }
  return page as unknown as SocialContentSourceOptionPage;
}
