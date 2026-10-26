import { hydrateSocialContentPreviews } from './socialContentPreviewProjection.js';
import { hydrateSocialContentExecutionSummaries } from './socialContentQueueProjection.js';
import type { SocialContentTaskPage, SocialContentWorkspace } from '../../shared/contracts/socialContentWorkflow.js';
import { enterpriseProductIdentity } from '../lib/enterpriseProductIdentity.js';
import { STARTER_COLLECTIONS, type Starter198Repository } from './repository.js';
import { readSocialTaskDetail, socialTaskSummary } from './socialContentRecords.js';
import { SOCIAL_THEME_CATALOG } from './socialContentThemes.js';
import { listSocialWeeklyPlans } from './socialContentTaskSupport.js';
import { SocialContentWorkflowError, socialJson, socialObject, socialText } from './socialContentValidation.js';
import { listActiveSocialWorkPackageCards } from './socialWorkPackages.js';
import { socialContentTaskCover } from './socialContentTaskCover.js';

export async function listSocialContentTasks(input: {
  repository: Starter198Repository;
  tenantId: string;
  status?: string;
  page?: number;
  perPage?: number;
}): Promise<SocialContentTaskPage> {
  const result = await input.repository.list(STARTER_COLLECTIONS.socialContentTasks, input.tenantId, {
    ...(input.status ? { where: { status: input.status } } : {}), sort: '-updated_at', page: input.page, perPage: input.perPage,
  });
  const unavailableItems:NonNullable<SocialContentTaskPage['unavailableItems']>=[];
  const parsedItems=(await Promise.all(result.items.map(async record=>{
    let task;
    try {task=socialTaskSummary(record);}
    catch(error){
      if(!(error instanceof SocialContentWorkflowError)||!error.code.endsWith('_invalid'))throw error;
      const brief=socialObject(socialJson(record.brief));
      const createdAt=socialText(record.created_at);
      unavailableItems.push({taskId:socialText(record.task_id)||`unreadable:${record.id}`,title:socialText(brief?.title)||'任务资料待核对',createdAt:Number.isFinite(Date.parse(createdAt))?createdAt:null,errorCode:error.code});
      return null;
    }
    return task;
  }))).filter((item):item is NonNullable<typeof item>=>item!==null);
  const executedItems=await hydrateSocialContentExecutionSummaries({store:input.repository.dataStore,
    tenantId:input.tenantId,items:parsedItems});
  const previewItems=await hydrateSocialContentPreviews({...input,items:executedItems});
  const items=await Promise.all(previewItems.map(async task=>{
    if(!task.artifactCount)return {...task,preview:{coverUrl:null,sourceStatus:'available' as const}};
    try {
      const artifacts=await input.repository.list(STARTER_COLLECTIONS.socialContentArtifacts,input.tenantId,{where:{task_id:task.taskId,artifact_kind:'short_video'},sort:'-updated_at',page:1,perPage:50});
      return {...task,preview:{coverUrl:socialContentTaskCover(artifacts.items,input.tenantId,task.taskId),sourceStatus:'available' as const}};
    }catch{return {...task,preview:{coverUrl:null,sourceStatus:'unavailable' as const}};}
  }));
  return {...result,items,unavailableItems};
}

export async function readSocialContentWorkspace(input: {
  repository: Starter198Repository;
  tenantId: string;
  now?: Date;
  taskId?: string;
}): Promise<SocialContentWorkspace> {
  const [catalog, list, weeklyPlans] = await Promise.all([
    listActiveSocialWorkPackageCards(input),
    listSocialContentTasks({ ...input, page: 1, perPage: 50 }),
    listSocialWeeklyPlans(input),
  ]);
  const current = list.items.find(item => !['reviewed'].includes(item.status)) ?? list.items[0] ?? null;
  const currentTask = input.taskId ? await readSocialTaskDetail({ ...input, taskId: input.taskId })
    : current ? await readSocialTaskDetail({ ...input, taskId: current.taskId }) : null;
  if (input.taskId && !currentTask) throw new SocialContentWorkflowError('social_task_not_found', 404);
  return { catalog, tasks: list.items,
    taskList: { page: list.page, perPage: list.perPage, totalItems: list.totalItems, totalPages: list.totalPages },
    currentTask,
    weeklyPlans, themes: [...SOCIAL_THEME_CATALOG] };
}

export function resolveEnterpriseProductSelection<T extends { id?: unknown; productId?: unknown; sku?: unknown; name?: unknown }>(
  items: T[], selection: { productId?: unknown; productRef?: unknown },
): { item: T; canonicalId: string } | null {
  const selectedId = socialText(selection.productId), selectedName = socialText(selection.productRef).toLocaleLowerCase();
  const indexed = items.map((item, index) => ({ item, canonicalId: enterpriseProductIdentity(item, index) }));
  const idMatch = selectedId ? indexed.find(candidate => candidate.canonicalId === selectedId) : undefined;
  if (selectedId) return idMatch ?? null;
  if (!selectedName) return null;
  const fallback = indexed.filter(({ item }) => [item.name, item.sku]
    .some(value => socialText(value).toLocaleLowerCase() === selectedName));
  return fallback.length === 1 ? fallback[0]! : null;
}

/** Validate explicit multi-product identities against the same tenant profile resolver. */
export async function assertSocialTaskProductSelection(tenantId: string, selection: {
  productId?: string | null; productIds?: string[];
  productMaterialSelection?: import('../../shared/contracts/socialContentTaskContract.js').ProductMaterialSelectionState;
}) {
  if (selection.productIds === undefined) return;
  const { readTenantEnterpriseProfile } = await import('../lib/socialContentLegacyPorts.js');
  const profile = await readTenantEnterpriseProfile(tenantId);
  if (selection.productIds.some(productId => !resolveEnterpriseProductSelection(profile?.products.items ?? [], { productId }))
    || (selection.productId && !selection.productIds.includes(selection.productId))
    || selection.productMaterialSelection?.productIds.some(id => !selection.productIds!.includes(id))) {
    throw new SocialContentWorkflowError('social_content_product_not_found', 400);
  }
}
