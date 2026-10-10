import { getToken } from './auth';
import type { WeeklyScheduleTargetGraph, WeeklyScheduleCapacityInput, WeeklyScheduleProposal, WeeklyScheduleConfirmation } from '../../shared/contracts/socialWeeklyScheduleRevision';
import type {WeeklyProductionRepairCase} from '../../shared/contracts/weeklyProductionRepairCase';
import type {SceneReworkAdmissionPreview} from '../../server/starter198/socialContentSceneReworkAdmission';
import type {WeeklyCreativeRepairCapacityPreview} from '../../shared/contracts/weeklyCreativeRepairExecution';
import type {CreativeRepairConfiguration} from '../../server/socialPrograms/weeklyCreativeRepairConfiguration';
export interface WeeklyTechnicalRepairCapacityPreview{caseRecordHash:string;preview:SceneReworkAdmissionPreview;maximumCaseCostCny:number|null;deadlineAt:string|null;estimatedDurationMinutes:number|null;admission:WeeklyProductionRepairCase['admission']}
import type { WeeklyRecoveryInput, WeeklyRecoveryAssessment } from '../../server/socialPrograms/weeklyRecoveryAssessment';
import type { WeeklyBackwardSchedule, WeeklyBackwardScheduleInput } from '../../server/socialPrograms/weeklyBackwardSchedule';
import type { WeeklyCustomerStep, WeeklyCustomerStepEvidence, readWeeklyCustomerCalendar } from '../../server/runtime/socialWeeklyCustomerBridge';
import type {
  AccountPlaybook,
  OwnedSocialAccount,
  SocialMonthlyPlan,
  SocialProgram,
  SocialWeeklyPlan,
  WeeklyAgentPlanningState,
  WeeklyAgentPlanningMutation,
  WeeklyExecutionTask,
  WeeklyCancellationSummary,
  WeeklyOperatingPackage,
} from '../../shared/contracts/socialProgram';
import type {
  OperatingPlanningRequest,
  OperatingPlanningResolution,
  SocialOperatingConstraints,
} from '../../shared/contracts/socialOperatingDecision';

export class SocialProgramRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const response = await fetch(`/api/overseas/social-programs${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new SocialProgramRequestError(
      response.status,
      'social_program_invalid_response',
      '社媒经营服务尚未正确加载，请刷新服务后重试。',
    );
  }
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new SocialProgramRequestError(
      response.status,
      'social_program_invalid_response',
      '社媒经营服务返回了无法识别的数据。',
    );
  }
  if (!response.ok) {
    throw new SocialProgramRequestError(
      response.status,
      String(payload.error || 'social_program_request_failed'),
      String(payload.message || '社媒经营数据请求失败。'),
    );
  }
  return payload as T;
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

function requireResponseObject<T>(value: unknown, message: string): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SocialProgramRequestError(502, 'social_program_invalid_response', message);
  }
  return value as T;
}

function parseTechnicalRepairCapacityPreview(value: unknown): WeeklyTechnicalRepairCapacityPreview {
  const item = requireResponseObject<WeeklyTechnicalRepairCapacityPreview>(value, '返工容量预览格式不正确。');
  const preview = requireResponseObject<SceneReworkAdmissionPreview>(item.preview, '返工执行方案格式不正确。');
  if (!/^[a-f0-9]{64}$/.test(item.caseRecordHash) || !/^[a-f0-9]{64}$/.test(preview.previewHash)) {
    throw new SocialProgramRequestError(502, 'social_program_invalid_response', '返工容量预览缺少可核验版本。');
  }
  return item;
}

function parseRepairCaseMutation(value: unknown, expectedState: WeeklyProductionRepairCase['state'] | WeeklyProductionRepairCase['state'][]): WeeklyProductionRepairCase {
  const item = requireResponseObject<WeeklyProductionRepairCase>(value, '返工任务响应格式不正确。');
  const states = Array.isArray(expectedState) ? expectedState : [expectedState];
  if (!states.includes(item.state)) {
    throw new SocialProgramRequestError(502, 'social_program_invalid_response', '返工任务状态与本次操作不一致。');
  }
  return item;
}

function parseCreativeRepairCapacityPreview(value:unknown,caseId:string):WeeklyCreativeRepairCapacityPreview{
 const item=requireResponseObject<WeeklyCreativeRepairCapacityPreview>(value,'创意返工容量预览格式不正确。');
 if(item.caseId!==caseId||![item.caseRecordHash,item.configurationHash,item.previewHash,item.authorityHash].every(value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value))||!Number.isSafeInteger(item.estimatedDurationMinutes)||item.estimatedDurationMinutes<1||typeof item.maximumCostCny!=='number'||!Number.isFinite(item.maximumCostCny)||item.maximumCostCny<0||typeof item.localOnly!=='boolean'||(item.localOnly?item.quoteHash!==null:typeof item.quoteHash!=='string'||!/^[a-f0-9]{64}$/.test(item.quoteHash))||typeof item.availableUntil!=='string'||!Number.isFinite(Date.parse(item.availableUntil)))throw new SocialProgramRequestError(502,'social_program_invalid_response','创意返工容量预览缺少可核验范围。');
 return item;
}

function parseCreativeRepairCase(value:unknown,scope:{programId:string;packageId:string;packageVersion:number;caseId:string},states:WeeklyProductionRepairCase['state'][]){
 const item=parseRepairCaseMutation(value,states);
 if(item.kind!=='creative_revision'||item.programId!==scope.programId||item.packageId!==scope.packageId||item.packageVersion!==scope.packageVersion||item.caseId!==scope.caseId||typeof item.recordHash!=='string'||!/^[a-f0-9]{64}$/.test(item.recordHash))throw new SocialProgramRequestError(502,'social_program_invalid_response','创意返工任务响应与当前周包不一致。');
 return item;
}

function parseCreativeRepairConfiguration(value:unknown,tenantId:string,caseId:string):CreativeRepairConfiguration{
 const item=requireResponseObject<CreativeRepairConfiguration>(value,'创意返工配置响应格式不正确。');
 if(item.type!=='weekly_creative_repair_configuration'||item.version!==1||item.tenantId!==tenantId||item.caseId!==caseId||![item.parentArtifactHash,item.feedbackHash,item.recordHash].every(value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value))||typeof item.decisionOperationId!=='string'||!item.decisionOperationId||typeof item.revisionScope!=='string'||!item.revisionScope||!Number.isSafeInteger(item.estimatedDurationMinutes)||item.estimatedDurationMinutes<1||typeof item.maximumCostCny!=='number'||!Number.isFinite(item.maximumCostCny)||item.maximumCostCny<0||![item.deadlineAt,item.confirmedAt].every(value=>typeof value==='string'&&Number.isFinite(Date.parse(value)))||![item.ownerUserId,item.reviewerUserId,item.confirmedBy].every(value=>typeof value==='string'&&Boolean(value)))throw new SocialProgramRequestError(502,'social_program_invalid_response','创意返工配置缺少可核验范围。');
 return item;
}

export const socialProgramApi = {
  async list(): Promise<SocialProgram[]> {
    const payload = await request<{ items: SocialProgram[] }>('/');
    if (!Array.isArray(payload.items)) throw new SocialProgramRequestError(502, 'social_program_invalid_response', '社媒经营项目列表格式不正确。');
    return payload.items;
  },
  async get(programId: string): Promise<SocialProgram> {
    return (await request<{ item: SocialProgram }>(`/${encodeURIComponent(programId)}`)).item;
  },
  async create(input: Record<string, unknown>): Promise<SocialProgram> {
    return (await request<{ item: SocialProgram }>('/', { method: 'POST', ...json(input) })).item;
  },
  async update(programId: string, input: Record<string, unknown>): Promise<SocialProgram> {
    return (await request<{ item: SocialProgram }>(`/${encodeURIComponent(programId)}`, { method: 'PATCH', ...json(input) })).item;
  },
  async listAccounts(programId: string): Promise<OwnedSocialAccount[]> {
    const payload = await request<{ items: OwnedSocialAccount[] }>(`/${encodeURIComponent(programId)}/accounts`);
    if (!Array.isArray(payload.items)) throw new SocialProgramRequestError(502, 'social_program_invalid_response', '自有账号列表格式不正确。');
    return payload.items;
  },
  async createAccount(programId: string, input: Record<string, unknown>): Promise<OwnedSocialAccount> {
    return (await request<{ item: OwnedSocialAccount }>(`/${encodeURIComponent(programId)}/accounts`, { method: 'POST', ...json(input) })).item;
  },
  async savePlaybook(programId: string, accountId: string, input: Record<string, unknown>): Promise<AccountPlaybook> {
    return (await request<{ item: AccountPlaybook }>(`/${encodeURIComponent(programId)}/accounts/${encodeURIComponent(accountId)}/playbook`, { method: 'PUT', ...json(input) })).item;
  },
  async saveMonthlyPlan(programId: string, input: Record<string, unknown>): Promise<SocialMonthlyPlan> {
    return (await request<{ item: SocialMonthlyPlan }>(`/${encodeURIComponent(programId)}/plans/monthly`, { method: 'POST', ...json(input) })).item;
  },
  async saveWeeklyPlan(programId: string, input: Record<string, unknown>): Promise<SocialWeeklyPlan> {
    return (await request<{ item: SocialWeeklyPlan }>(`/${encodeURIComponent(programId)}/plans/weekly`, { method: 'POST', ...json(input) })).item;
  },
  async getOperatingConstraints(programId: string): Promise<SocialOperatingConstraints | null> {
    return (await request<{ item: SocialOperatingConstraints | null }>(`/${encodeURIComponent(programId)}/operating-constraints`)).item;
  },
  async saveOperatingConstraints(programId: string, input: Record<string, unknown>): Promise<SocialOperatingConstraints> {
    return (await request<{ item: SocialOperatingConstraints }>(`/${encodeURIComponent(programId)}/operating-constraints`, { method: 'PUT', ...json(input) })).item;
  },
  async resolveOperatingPlan(programId: string, input: OperatingPlanningRequest): Promise<{
    item: OperatingPlanningResolution;
    weeklyAuthority: Record<string, unknown>;
  }> {
    return request(`/${encodeURIComponent(programId)}/operating-plan/resolve`, { method: 'POST', ...json(input) });
  },
  async listOperatingPackages(programId: string, weekStart?: string): Promise<WeeklyOperatingPackage[]> {
    const query = weekStart ? `?weekStart=${encodeURIComponent(weekStart)}` : '';
    const payload = await request<{ items: WeeklyOperatingPackage[] }>(`/${encodeURIComponent(programId)}/operating-packages${query}`);
    if (!Array.isArray(payload.items)) throw new SocialProgramRequestError(502, 'social_program_invalid_response', '周任务包列表格式不正确。');
    return payload.items;
  },
  async getOperatingPackage(programId: string, packageId: string): Promise<WeeklyOperatingPackage> {
    return (await request<{ item: WeeklyOperatingPackage }>(`/${encodeURIComponent(programId)}/operating-packages/${encodeURIComponent(packageId)}`)).item;
  },
  async createOperatingPackage(programId: string, input: Record<string, unknown>): Promise<WeeklyOperatingPackage> {
    return (await request<{ item: WeeklyOperatingPackage }>(`/${encodeURIComponent(programId)}/operating-packages`, { method: 'POST', ...json(input) })).item;
  },
  async reviseOperatingPackage(programId: string, packageId: string, input: Record<string, unknown>): Promise<WeeklyOperatingPackage> {
    return (await request<{ item: WeeklyOperatingPackage }>(`/${encodeURIComponent(programId)}/operating-packages/${encodeURIComponent(packageId)}`, { method: 'PUT', ...json(input) })).item;
  },
  async activateOperatingPackage(programId: string, packageId: string, input: Record<string, unknown>): Promise<WeeklyOperatingPackage> {
    return (await request<{ item: WeeklyOperatingPackage }>(`/${encodeURIComponent(programId)}/operating-packages/${encodeURIComponent(packageId)}/activate`, { method: 'POST', ...json(input) })).item;
  },
  async retireOperatingPackage(programId: string, packageId: string, input: Record<string, unknown>): Promise<WeeklyOperatingPackage> {
    return (await request<{ item: WeeklyOperatingPackage }>(`/${encodeURIComponent(programId)}/operating-packages/${encodeURIComponent(packageId)}/retire`, { method: 'POST', ...json(input) })).item;
  },
  async getAgentPlanning(programId: string, packageId: string, version?: number): Promise<WeeklyAgentPlanningState> {
    const query = version ? `?version=${version}` : '';
    return (await request<{ item: WeeklyAgentPlanningState }>(`/${encodeURIComponent(programId)}/operating-packages/${encodeURIComponent(packageId)}/agent-planning${query}`)).item;
  },
  async runDirectorPlanning(programId: string, packageId: string, versions: WeeklyAgentPlanningMutation): Promise<WeeklyAgentPlanningState> {
    return (await request<{ item: WeeklyAgentPlanningState }>(`/${encodeURIComponent(programId)}/operating-packages/${encodeURIComponent(packageId)}/agent-planning/director-analysis`, { method: 'POST', ...json(versions) })).item;
  },
  async mergeAgentSchedule(programId: string, packageId: string, versions: WeeklyAgentPlanningMutation): Promise<WeeklyAgentPlanningState> {
    return (await request<{ item: WeeklyAgentPlanningState }>(`/${encodeURIComponent(programId)}/operating-packages/${encodeURIComponent(packageId)}/agent-planning/merge`, { method: 'POST', ...json(versions) })).item;
  },
  async confirmAgentSchedule(programId: string, packageId: string, versions: WeeklyAgentPlanningMutation): Promise<WeeklyAgentPlanningState> {
    return (await request<{ item: WeeklyAgentPlanningState }>(`/${encodeURIComponent(programId)}/operating-packages/${encodeURIComponent(packageId)}/agent-planning/confirm`, { method: 'POST', ...json(versions) })).item;
  },
  async dispatchAgentSchedule(programId: string, packageId: string, versions: WeeklyAgentPlanningMutation): Promise<WeeklyAgentPlanningState> {
    return (await request<{ item: WeeklyAgentPlanningState }>(`/${encodeURIComponent(programId)}/operating-packages/${encodeURIComponent(packageId)}/agent-planning/dispatch`, { method: 'POST', ...json(versions) })).item;
  },
  async readCancellation(programId: string, packageId: string, version: number): Promise<WeeklyCancellationSummary | null> {
    const result = await request<{ item: WeeklyCancellationSummary | null }>(`/${encodeURIComponent(programId)}/operating-packages/${encodeURIComponent(packageId)}/cancellation?version=${version}`);
    return parseWeeklyCancellationSummary(result.item);
  },
  async listExecutionTasks(programId: string, packageId: string, version: number): Promise<WeeklyExecutionTask[]> {
    return (await request<{ items: WeeklyExecutionTask[] }>(`/${encodeURIComponent(programId)}/operating-packages/${encodeURIComponent(packageId)}/execution-tasks?version=${version}`)).items;
  },
  async listRepairCases(programId:string,packageId:string,version:number):Promise<WeeklyProductionRepairCase[]>{
    return (await request<{items:WeeklyProductionRepairCase[]}>(`/${encodeURIComponent(programId)}/operating-packages/${encodeURIComponent(packageId)}/repair-cases?version=${version}`)).items;
  },
  async previewTechnicalRepairCapacity(programId:string,packageId:string,version:number,caseId:string):Promise<WeeklyTechnicalRepairCapacityPreview>{const payload=await request<{item:unknown}>(`/${encodeURIComponent(programId)}/operating-packages/${encodeURIComponent(packageId)}/repair-cases/${encodeURIComponent(caseId)}/capacity-preview?version=${version}`);return parseTechnicalRepairCapacityPreview(payload.item);},
  async confirmTechnicalRepairCapacity(programId:string,packageId:string,version:number,caseId:string,input:{expectedCaseRecordHash:string;expectedPreviewHash:string;expectedQuoteHash?:string;authorizedMaximumCostCny:number}):Promise<WeeklyProductionRepairCase>{const payload=await request<{item:unknown}>(`/${encodeURIComponent(programId)}/operating-packages/${encodeURIComponent(packageId)}/repair-cases/${encodeURIComponent(caseId)}/confirm-capacity`,{method:'POST',...json({packageVersion:version,expectedCaseRecordHash:input.expectedCaseRecordHash,expectedPreviewHash:input.expectedPreviewHash,...(input.expectedQuoteHash===undefined?{}:{expectedQuoteHash:input.expectedQuoteHash}),authorizedMaximumCostCny:input.authorizedMaximumCostCny})});return parseRepairCaseMutation(payload.item,'ready');},
  async startTechnicalRepair(programId:string,packageId:string,version:number,caseId:string,expectedCaseRecordHash:string):Promise<WeeklyProductionRepairCase>{const payload=await request<{item:unknown}>(`/${encodeURIComponent(programId)}/operating-packages/${encodeURIComponent(packageId)}/repair-cases/${encodeURIComponent(caseId)}/start`,{method:'POST',...json({packageVersion:version,expectedCaseRecordHash})});return parseRepairCaseMutation(payload.item,'running');},
  async configureCreativeRepair(programId:string,packageId:string,version:number,caseId:string,tenantId:string,input:{expectedCaseHash:string;revisionScope:string;estimatedDurationMinutes:number;maximumCostCny:number;deadlineAt:string}):Promise<CreativeRepairConfiguration>{const payload=await request<{item:unknown}>(`/${encodeURIComponent(programId)}/operating-packages/${encodeURIComponent(packageId)}/repair-cases/${encodeURIComponent(caseId)}/configure`,{method:'POST',...json({packageVersion:version,expectedCaseHash:input.expectedCaseHash,revisionScope:input.revisionScope,estimatedDurationMinutes:input.estimatedDurationMinutes,maximumCostCny:input.maximumCostCny,deadlineAt:input.deadlineAt})});return parseCreativeRepairConfiguration(payload.item,tenantId,caseId);},
  async previewCreativeRepairCapacity(programId:string,packageId:string,version:number,caseId:string):Promise<WeeklyCreativeRepairCapacityPreview>{const payload=await request<{item:unknown}>(`/${encodeURIComponent(programId)}/operating-packages/${encodeURIComponent(packageId)}/repair-cases/${encodeURIComponent(caseId)}/creative-execution/capacity-preview?version=${version}`);return parseCreativeRepairCapacityPreview(payload.item,caseId);},
  async confirmCreativeRepairCapacity(programId:string,packageId:string,version:number,caseId:string,input:{expectedCaseRecordHash:string;expectedConfigurationHash:string;expectedPreviewHash:string;expectedAuthorityHash:string;expectedQuoteHash?:string;authorizedMaximumCostCny:number}):Promise<WeeklyProductionRepairCase>{const payload=await request<{item:unknown}>(`/${encodeURIComponent(programId)}/operating-packages/${encodeURIComponent(packageId)}/repair-cases/${encodeURIComponent(caseId)}/creative-execution/confirm-capacity`,{method:'POST',...json({packageVersion:version,expectedCaseRecordHash:input.expectedCaseRecordHash,expectedConfigurationHash:input.expectedConfigurationHash,expectedPreviewHash:input.expectedPreviewHash,expectedAuthorityHash:input.expectedAuthorityHash,...(input.expectedQuoteHash===undefined?{}:{expectedQuoteHash:input.expectedQuoteHash}),authorizedMaximumCostCny:input.authorizedMaximumCostCny})});return parseCreativeRepairCase(payload.item,{programId,packageId,packageVersion:version,caseId},['ready','running']);},
  async startCreativeRepair(programId:string,packageId:string,version:number,caseId:string,expectedCaseRecordHash:string):Promise<WeeklyProductionRepairCase>{const payload=await request<{item:unknown}>(`/${encodeURIComponent(programId)}/operating-packages/${encodeURIComponent(packageId)}/repair-cases/${encodeURIComponent(caseId)}/creative-execution/start`,{method:'POST',...json({packageVersion:version,expectedCaseRecordHash})});return parseCreativeRepairCase(payload.item,{programId,packageId,packageVersion:version,caseId},['running']);},
  async reconcileCreativeRepair(programId:string,packageId:string,version:number,caseId:string):Promise<WeeklyProductionRepairCase>{const payload=await request<{item:unknown}>(`/${encodeURIComponent(programId)}/operating-packages/${encodeURIComponent(packageId)}/repair-cases/${encodeURIComponent(caseId)}/creative-execution/reconcile`,{method:'POST',...json({packageVersion:version})});return parseCreativeRepairCase(payload.item,{programId,packageId,packageVersion:version,caseId},['running','awaiting_audit','resolved']);},
  async auditCreativeRepair(programId:string,packageId:string,version:number,caseId:string):Promise<WeeklyProductionRepairCase>{const payload=await request<{item:unknown}>(`/${encodeURIComponent(programId)}/operating-packages/${encodeURIComponent(packageId)}/repair-cases/${encodeURIComponent(caseId)}/creative-execution/audit`,{method:'POST',...json({packageVersion:version})});return parseCreativeRepairCase(payload.item,{programId,packageId,packageVersion:version,caseId},['awaiting_audit','resolved']);},
  async assessRecovery(programId: string, packageId: string, packageVersion: number, input: Pick<WeeklyRecoveryInput, 'changedTaskIds' | 'constraints' | 'resources' | 'remainingBudgetCny'>): Promise<WeeklyRecoveryAssessment> {
    return (await request<{ item: WeeklyRecoveryAssessment }>(`/${encodeURIComponent(programId)}/operating-packages/${encodeURIComponent(packageId)}/recovery-assessment`, { method: 'POST', ...json({ changedTaskIds: input.changedTaskIds, constraints: input.constraints, resources: input.resources, remainingBudgetCny: input.remainingBudgetCny, packageVersion }) })).item;
  },
  async planBackwardSchedule(programId: string, packageId: string, packageVersion: number, input: Pick<WeeklyBackwardScheduleInput, 'constraints' | 'resources' | 'remainingBudgetCny' | 'operationalDeadlines'>): Promise<WeeklyBackwardSchedule> {
    return (await request<{ item: WeeklyBackwardSchedule }>(`/${encodeURIComponent(programId)}/operating-packages/${encodeURIComponent(packageId)}/backward-schedule`, { method: 'POST', ...json({ packageVersion, constraints: input.constraints, resources: input.resources, remainingBudgetCny: input.remainingBudgetCny, ...(input.operationalDeadlines ? { operationalDeadlines: input.operationalDeadlines } : {}) }) })).item;
  },
  async previewScheduleTargetGraph(programId:string,packageId:string,packageVersion:number,tenantId:string):Promise<WeeklyScheduleTargetGraph>{const result=await request<{item:WeeklyScheduleTargetGraph}>(`/${encodeURIComponent(programId)}/operating-packages/${encodeURIComponent(packageId)}/schedule-revisions/target-graph?version=${packageVersion}`);return parseScheduleTargetGraph(result.item,{tenantId,programId,packageId,packageVersion});},
  async createScheduleRevisionProposal(programId: string, packageId: string, packageVersion: number, input: WeeklyScheduleCapacityInput): Promise<WeeklyScheduleProposal> {
    return (await request<{ item: WeeklyScheduleProposal }>(`/${encodeURIComponent(programId)}/operating-packages/${encodeURIComponent(packageId)}/schedule-revisions`, { method: 'POST', ...json({ packageVersion, constraints: input.constraints, resources: input.resources, remainingBudgetCny: input.remainingBudgetCny, ...(input.operationalDeadlines ? { operationalDeadlines: input.operationalDeadlines } : {}) }) })).item;
  },
  async confirmScheduleRevision(programId: string, packageId: string, proposalId: string, expectedVersion: number, inputEvidenceHash: string, confirmedTemplateCarryoverPlanHashes?: string[]): Promise<WeeklyScheduleConfirmation> {
    return request<WeeklyScheduleConfirmation>(`/${encodeURIComponent(programId)}/operating-packages/${encodeURIComponent(packageId)}/schedule-revisions/${encodeURIComponent(proposalId)}/confirm`, { method: 'POST', ...json({ expectedVersion, inputEvidenceHash, ...(confirmedTemplateCarryoverPlanHashes !== undefined ? { confirmedTemplateCarryoverPlanHashes } : {}) }) });
  },
  async bindCustomerRun(programId: string, packageId: string, packageVersion: number, runId: string): Promise<void> {
    await request(`/${encodeURIComponent(programId)}/operating-packages/${encodeURIComponent(packageId)}/customer-run-binding`, { method: 'POST', ...json({ packageVersion, runId }) });
  },
  async readCustomerCalendar(programId: string, packageId: string, packageVersion: number): Promise<Awaited<ReturnType<typeof readWeeklyCustomerCalendar>>> {
    return (await request<{ item: Awaited<ReturnType<typeof readWeeklyCustomerCalendar>> }>(`/${encodeURIComponent(programId)}/operating-packages/${encodeURIComponent(packageId)}/customer-run-binding?version=${packageVersion}`)).item;
  },
  async readCustomerStep(programId: string, packageId: string, packageVersion: number, runId: string, step: WeeklyCustomerStep): Promise<WeeklyCustomerStepEvidence> {
    return (await request<{ item: WeeklyCustomerStepEvidence }>(`/${encodeURIComponent(programId)}/operating-packages/${encodeURIComponent(packageId)}/customer-run-binding/${encodeURIComponent(runId)}/steps/${encodeURIComponent(step)}?version=${packageVersion}`)).item;
  },
  async approveExecutionTask(programId: string, packageId: string, taskId: string): Promise<WeeklyExecutionTask[]> {
    return (await request<{ items: WeeklyExecutionTask[] }>(`/${encodeURIComponent(programId)}/operating-packages/${encodeURIComponent(packageId)}/execution-tasks/${encodeURIComponent(taskId)}/approve`, { method: 'POST', ...json({}) })).items;
  },
  async recheckRequiredMaterials(programId: string, packageId: string, taskId: string, packageVersion: number): Promise<WeeklyExecutionTask[]> {
    return (await request<{ items: WeeklyExecutionTask[] }>(`/${encodeURIComponent(programId)}/operating-packages/${encodeURIComponent(packageId)}/execution-tasks/${encodeURIComponent(taskId)}/recheck-required-materials`, { method: 'POST', ...json({ expectedPackageVersion: packageVersion }) })).items;
  },
};

export function parseWeeklyCancellationSummary(value:unknown):WeeklyCancellationSummary|null {
 if(value===null)return null;if(!value||typeof value!=='object')throw Error('撤回回执不可核验。');const v=value as WeeklyCancellationSummary;
 if(!Array.isArray(v.effects)||v.effects.some(e=>!e||typeof e.resourceId!=='string'||typeof e.resourceType!=='string'||!['irreversible','unknown_requires_reconciliation'].includes(e.outcome)))throw Error('撤回历史不可核验。');
 if(v.currentSettlements!==undefined){if(!Array.isArray(v.currentSettlements)||v.currentSettlements.length!==v.effects.length||v.currentSettlements.some(s=>!s||typeof s!=='object'||Array.isArray(s))||new Set(v.currentSettlements.map(s=>s.resourceType+'\0'+s.resourceId)).size!==v.currentSettlements.length||v.currentSettlements.some(s=>!s||!v.effects.some(e=>e.resourceId===s.resourceId&&e.resourceType===s.resourceType)||!['published','failed','unknown','unverified'].includes(s.status)||(['published','failed'].includes(s.status)&&(s.resourceType!=='publication_attempt'||typeof s.resolvedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(s.resolvedAt)||!Number.isFinite(Date.parse(s.resolvedAt))||new Date(s.resolvedAt).toISOString().replace('.000Z','Z')!==s.resolvedAt.replace('.000Z','Z')||Date.parse(s.resolvedAt)>Date.now()||s.gap!==null))||(['unknown','unverified'].includes(s.status)&&(s.resolvedAt!==null||typeof s.gap!=='string'||!s.gap))))throw Error('当前回执与原撤回记录不一致。');}return v;
}

export function parseScheduleTargetGraph(graph:WeeklyScheduleTargetGraph,scope:{tenantId:string;programId:string;packageId:string;packageVersion:number}):WeeklyScheduleTargetGraph{if(!graph||graph.tenantId!==scope.tenantId||graph.programId!==scope.programId||graph.packageId!==scope.packageId||graph.sourceVersion!==scope.packageVersion||graph.targetVersion!==scope.packageVersion+1||![2,3].includes(graph.executionGraphVersion)||!/^([a-f0-9]{64})$/.test(graph.targetGraphHash)||!Array.isArray(graph.tasks)||!Array.isArray(graph.bindings)||new Set(graph.tasks.map(t=>t.taskId)).size!==graph.tasks.length||graph.tasks.some(t=>Object.entries(scope).some(([k,v])=>t[k as keyof typeof t]!==v))||graph.bindings.length!==graph.tasks.length||new Set(graph.bindings.map(b=>b.planningTaskId)).size!==graph.tasks.length||new Set(graph.bindings.map(b=>b.targetTaskId)).size!==graph.tasks.length||graph.bindings.some(b=>!graph.tasks.some(t=>t.taskId===b.planningTaskId)||!b.targetTaskId||!b.signature||!['existing_source','new_planned'].includes(b.origin)||(b.origin==='new_planned'?b.sourceTaskId!==null:b.sourceTaskId!==b.planningTaskId)))throw Error('新草稿任务图与当前周包或来源身份不一致，请重新读取。');return graph;}
