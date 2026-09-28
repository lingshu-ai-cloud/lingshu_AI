import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  StartupApiEndpoint,
  StartupAnnouncement,
  StartupCompanyDocument,
  StartupCompanyDocumentCategory,
  StartupCompanyProfile,
  StartupCapability,
  StartupDecision,
  StartupDeployment,
  StartupHubCreateInput,
  StartupHubRecordKind,
  StartupHubRecordMap,
  StartupHubSnapshot,
  StartupIssue,
  StartupLogSource,
  StartupLead,
  StartupLeadActivity,
  StartupLeadChatImport,
  StartupMember,
  StartupProduct,
  StartupResource,
  StartupSop,
  StartupSopRun,
  StartupTask,
  StartupTaxRecord,
} from '../../shared/startupHub.js';

interface StoredDocument extends StartupHubSnapshot {
  schemaVersion: 1;
}

const COLLECTIONS = new Set<StartupHubRecordKind>(['tasks', 'taxRecords', 'announcements', 'products', 'apiEndpoints', 'logSources', 'issues', 'resources', 'deployments', 'members', 'decisions', 'sops', 'sopRuns', 'capabilities', 'leads', 'leadActivities']);
const SENSITIVE_KEY = /(password|passwd|passphrase|cookie|token|secret|credential|api[_-]?key|authorization|private[_-]?key|session[_-]?key)/i;
const queues = new Map<string, Promise<void>>();

const root = () => path.resolve(process.env.STARTUP_HUB_DATA_DIR || 'data/startup-hub');
const fileRoot = () => path.resolve(process.env.STARTUP_HUB_FILE_DIR || 'data/startup-hub-files');
const chatFileRoot = () => path.resolve(process.env.STARTUP_HUB_LEAD_CHAT_DIR || 'data/startup-hub-lead-chats');
const tenantKey = (tenantId: string) => createHash('sha256').update(tenantId).digest('hex');
const tenantFile = (tenantId: string) => path.join(root(), `${tenantKey(tenantId)}.json`);
const tenantFileDirectory = (tenantId: string) => path.join(fileRoot(), tenantKey(tenantId));
const tenantChatDirectory = (tenantId: string) => path.join(chatFileRoot(), tenantKey(tenantId));

function emptyDocument(): StoredDocument {
  return {
    schemaVersion: 1,
    company: null,
    tasks: [],
    taxRecords: [],
    announcements: [],
    products: [],
    apiEndpoints: [],
    logSources: [],
    issues: [],
    resources: [],
    deployments: [],
    members: [],
    documents: [],
    decisions: [],
    sops: [],
    sopRuns: [],
    capabilities: [],
    leads: [],
    leadActivities: [],
    leadChatImports: [],
    updatedAt: null,
  };
}

function assertNoSecrets(value: unknown): void {
  const visit = (input: unknown): void => {
    if (!input || typeof input !== 'object') return;
    for (const [key, child] of Object.entries(input)) {
      if (SENSITIVE_KEY.test(key)) throw new Error(`Sensitive field is not allowed: ${key}`);
      visit(child);
    }
  };
  visit(value);
}

function text(value: unknown, field: string, max = 240): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error(`Invalid ${field}`);
  return value.trim();
}

function optionalText(value: unknown, field: string, max = 500): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return text(value, field, max);
}

function optionalDate(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const result = text(value, field, 40);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`Invalid ${field}`);
  return result;
}

function enumValue<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (!allowed.includes(value as T)) throw new Error(`Invalid ${field}`);
  return value as T;
}

function optionalEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return enumValue(value, field, allowed);
}

function optionalNumber(value: unknown, field: string, max = Number.MAX_SAFE_INTEGER): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || result > max) throw new Error(`Invalid ${field}`);
  return result;
}

function dateValue(value: unknown, field: string): string {
  const result = text(value, field, 40);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`Invalid ${field}`);
  return result;
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Invalid ${field}`);
  return value;
}

function stringArray(value: unknown, field: string, maxItems = 40, maxLength = 500): string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`Invalid ${field}`);
  return value.map((item, index) => text(item, `${field}[${index}]`, maxLength));
}

function integerArray(value: unknown, field: string, maxItems = 100): number[] {
  if (!Array.isArray(value) || value.length > maxItems || value.some(item => !Number.isSafeInteger(item) || Number(item) < 0)) throw new Error(`Invalid ${field}`);
  return [...new Set(value.map(Number))];
}

function nonNegativeInteger(value: unknown, field: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error(`Invalid ${field}`);
  return result;
}

function sanitizeInput<K extends StartupHubRecordKind>(kind: K, value: unknown): StartupHubCreateInput<K> {
  assertNoSecrets(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid record');
  const input = value as Record<string, unknown>;
  let result: unknown;
  switch (kind) {
    case 'tasks':
      result = { title: text(input.title, 'title'), area: text(input.area, 'area', 60), owner: text(input.owner, 'owner', 120), dueDate: optionalDate(input.dueDate, 'dueDate'), priority: enumValue(input.priority, 'priority', ['high', 'medium', 'low']), status: enumValue(input.status, 'status', ['open', 'completed']) } satisfies Omit<StartupTask, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>;
      break;
    case 'taxRecords':
      result = { title: text(input.title, 'title'), taxType: text(input.taxType, 'taxType', 80), period: text(input.period, 'period', 40), dueDate: optionalDate(input.dueDate, 'dueDate'), owner: text(input.owner, 'owner', 120), status: enumValue(input.status, 'status', ['draft', 'preparing', 'ready', 'filed', 'paid']), notes: optionalText(input.notes, 'notes', 1000) } satisfies Omit<StartupTaxRecord, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>;
      break;
    case 'announcements':
      result = { title: text(input.title, 'title'), body: text(input.body, 'body', 3000), audience: text(input.audience, 'audience', 120), priority: enumValue(input.priority, 'priority', ['normal', 'important', 'urgent']), requireConfirm: booleanValue(input.requireConfirm, 'requireConfirm'), acknowledgedBy: [] } satisfies Omit<StartupAnnouncement, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>;
      break;
    case 'products':
      result = { name: text(input.name, 'name'), owner: text(input.owner, 'owner', 120), status: enumValue(input.status, 'status', ['planning', 'active', 'paused', 'archived']), version: optionalText(input.version, 'version', 80), description: optionalText(input.description, 'description', 1000), customerProblem: optionalText(input.customerProblem, 'customerProblem', 1000), successMetric: optionalText(input.successMetric, 'successMetric', 500), targetDate: optionalDate(input.targetDate, 'targetDate') } satisfies Omit<StartupProduct, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>;
      break;
    case 'apiEndpoints':
      result = { name: text(input.name, 'name'), method: text(input.method, 'method', 12).toUpperCase(), path: text(input.path, 'path', 500), environment: text(input.environment, 'environment', 80), owner: text(input.owner, 'owner', 120), productId: optionalText(input.productId, 'productId', 100), status: enumValue(input.status, 'status', ['designing', 'developing', 'testing', 'production', 'deprecated']) } satisfies Omit<StartupApiEndpoint, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>;
      break;
    case 'issues':
      result = { title: text(input.title, 'title'), severity: enumValue(input.severity, 'severity', ['critical', 'high', 'medium', 'low']), status: enumValue(input.status, 'status', ['open', 'investigating', 'fixing', 'verifying', 'closed']), source: text(input.source, 'source', 120), assignee: text(input.assignee, 'assignee', 120), productId: optionalText(input.productId, 'productId', 100), apiEndpointId: optionalText(input.apiEndpointId, 'apiEndpointId', 100), resourceId: optionalText(input.resourceId, 'resourceId', 100), dueDate: optionalDate(input.dueDate, 'dueDate') } satisfies Omit<StartupIssue, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>;
      break;
    case 'logSources':
      result = { name: text(input.name, 'name'), provider: text(input.provider, 'provider', 120), environment: text(input.environment, 'environment', 80), owner: text(input.owner, 'owner', 120), status: enumValue(input.status, 'status', ['connected', 'disconnected', 'error']), queryUrl: optionalText(input.queryUrl, 'queryUrl', 500) } satisfies Omit<StartupLogSource, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>;
      break;
    case 'resources':
      result = { name: text(input.name, 'name'), type: text(input.type, 'type', 80), environment: text(input.environment, 'environment', 80), owner: text(input.owner, 'owner', 120), status: enumValue(input.status, 'status', ['unknown', 'healthy', 'warning', 'offline']), provider: optionalText(input.provider, 'provider', 120), region: optionalText(input.region, 'region', 120), billingCycle: optionalEnum(input.billingCycle, 'billingCycle', ['monthly', 'quarterly', 'annual', 'pay_as_you_go', 'free']), subscriptionAmount: optionalNumber(input.subscriptionAmount, 'subscriptionAmount'), currency: optionalEnum(input.currency, 'currency', ['CNY', 'USD', 'EUR', 'HKD']), renewalDate: optionalDate(input.renewalDate, 'renewalDate'), cpuCores: optionalNumber(input.cpuCores, 'cpuCores', 100000), memoryTotalGb: optionalNumber(input.memoryTotalGb, 'memoryTotalGb'), storageTotalGb: optionalNumber(input.storageTotalGb, 'storageTotalGb'), storageUsedGb: optionalNumber(input.storageUsedGb, 'storageUsedGb'), trafficTotalGb: optionalNumber(input.trafficTotalGb, 'trafficTotalGb'), trafficUsedGb: optionalNumber(input.trafficUsedGb, 'trafficUsedGb'), managementUrl: optionalText(input.managementUrl, 'managementUrl', 500), notes: optionalText(input.notes, 'notes', 2000) } satisfies Omit<StartupResource, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>;
      break;
    case 'deployments':
      result = { name: text(input.name, 'name'), resourceId: text(input.resourceId, 'resourceId', 100), environment: text(input.environment, 'environment', 80), serviceType: enumValue(input.serviceType, 'serviceType', ['frontend', 'api', 'worker', 'database', 'proxy', 'storage', 'other']), owner: text(input.owner, 'owner', 120), status: enumValue(input.status, 'status', ['planned', 'deploying', 'running', 'degraded', 'stopped']), version: optionalText(input.version, 'version', 120), branch: optionalText(input.branch, 'branch', 200), url: optionalText(input.url, 'url', 500), deployedAt: optionalDate(input.deployedAt, 'deployedAt') } satisfies Omit<StartupDeployment, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>;
      break;
    case 'members':
      result = { name: text(input.name, 'name', 120), email: text(input.email, 'email', 254), role: enumValue(input.role, 'role', ['admin', 'operator', 'viewer']), status: enumValue(input.status, 'status', ['invited', 'active', 'disabled']) } satisfies Omit<StartupMember, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>;
      break;
    case 'decisions':
      result = { title: text(input.title, 'title'), context: text(input.context, 'context', 2000), decision: text(input.decision, 'decision', 3000), owner: text(input.owner, 'owner', 120), impact: enumValue(input.impact, 'impact', ['company', 'product', 'customer', 'finance', 'team', 'technology']), status: enumValue(input.status, 'status', ['active', 'superseded']), reviewDate: optionalDate(input.reviewDate, 'reviewDate') } satisfies Omit<StartupDecision, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>;
      break;
    case 'sops':
      result = { name: text(input.name, 'name'), trigger: text(input.trigger, 'trigger', 1000), owner: text(input.owner, 'owner', 120), version: text(input.version, 'version', 40), status: enumValue(input.status, 'status', ['draft', 'active', 'retired']), steps: stringArray(input.steps, 'steps', 30, 500), successCriteria: optionalText(input.successCriteria, 'successCriteria', 1000) } satisfies Omit<StartupSop, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>;
      break;
    case 'sopRuns':
      result = { sopId: text(input.sopId, 'sopId', 100), sopName: text(input.sopName, 'sopName'), owner: text(input.owner, 'owner', 120), status: enumValue(input.status, 'status', ['running', 'blocked', 'completed']), completedSteps: integerArray(input.completedSteps, 'completedSteps'), dueDate: optionalDate(input.dueDate, 'dueDate'), note: optionalText(input.note, 'note', 1000) } satisfies Omit<StartupSopRun, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>;
      break;
    case 'capabilities':
      result = { name: text(input.name, 'name'), type: enumValue(input.type, 'type', ['template', 'tool', 'integration', 'knowledge', 'automation']), owner: text(input.owner, 'owner', 120), status: enumValue(input.status, 'status', ['draft', 'active', 'retired']), description: text(input.description, 'description', 2000), locationUrl: optionalText(input.locationUrl, 'locationUrl', 500), reuseCount: nonNegativeInteger(input.reuseCount, 'reuseCount') } satisfies Omit<StartupCapability, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>;
      break;
    case 'leads':
      result = { companyName: text(input.companyName, 'companyName', 200), resourceType: enumValue(input.resourceType, 'resourceType', ['customer', 'channel', 'fde_partner', 'supplier', 'association', 'other']), industry: text(input.industry, 'industry', 120), country: text(input.country, 'country', 120), province: optionalText(input.province, 'province', 120), city: optionalText(input.city, 'city', 120), contactName: text(input.contactName, 'contactName', 120), contactRole: optionalText(input.contactRole, 'contactRole', 120), contactMethod: enumValue(input.contactMethod, 'contactMethod', ['wechat', 'phone', 'email', 'whatsapp', 'linkedin', 'other']), contactValue: optionalText(input.contactValue, 'contactValue', 240), source: text(input.source, 'source', 120), owner: text(input.owner, 'owner', 120), stage: enumValue(input.stage, 'stage', ['new', 'qualified', 'needs', 'proposal', 'negotiation', 'won', 'lost', 'nurture']), intention: enumValue(input.intention, 'intention', ['unknown', 'low', 'medium', 'high']), nextAction: optionalText(input.nextAction, 'nextAction', 500), nextFollowUpDate: optionalDate(input.nextFollowUpDate, 'nextFollowUpDate'), estimatedValue: optionalNumber(input.estimatedValue, 'estimatedValue'), currency: optionalEnum(input.currency, 'currency', ['CNY', 'USD', 'EUR', 'HKD']), notes: optionalText(input.notes, 'notes', 3000), tags: stringArray(input.tags, 'tags', 30, 80) } satisfies Omit<StartupLead, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>;
      break;
    case 'leadActivities':
      result = { leadId: text(input.leadId, 'leadId', 100), type: enumValue(input.type, 'type', ['note', 'wechat', 'call', 'meeting', 'email', 'stage_change']), owner: text(input.owner, 'owner', 120), summary: text(input.summary, 'summary', 4000), happenedAt: dateValue(input.happenedAt, 'happenedAt'), nextAction: optionalText(input.nextAction, 'nextAction', 500), nextFollowUpDate: optionalDate(input.nextFollowUpDate, 'nextFollowUpDate') } satisfies Omit<StartupLeadActivity, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>;
      break;
  }
  return result as StartupHubCreateInput<K>;
}

function validateRelations(document: StoredDocument, kind: StartupHubRecordKind, candidate: unknown): void {
  if (kind === 'resources') {
    const resource = candidate as Pick<StartupResource, 'storageUsedGb' | 'storageTotalGb' | 'trafficUsedGb' | 'trafficTotalGb'>;
    if (resource.storageUsedGb !== undefined && resource.storageTotalGb !== undefined && resource.storageUsedGb > resource.storageTotalGb) throw new Error('Storage used cannot exceed total capacity');
    if (resource.trafficUsedGb !== undefined && resource.trafficTotalGb !== undefined && resource.trafficUsedGb > resource.trafficTotalGb) throw new Error('Traffic used cannot exceed total capacity');
  }
  if (kind === 'deployments') {
    const deployment = candidate as Pick<StartupDeployment, 'resourceId'>;
    if (!document.resources.some(item => item.id === deployment.resourceId)) throw new Error('Resource not found');
  }
  if (kind === 'leadActivities') {
    const activity = candidate as Pick<StartupLeadActivity, 'leadId'>;
    if (!document.leads.some(item => item.id === activity.leadId)) throw new Error('Lead not found');
  }
  if (kind === 'sopRuns') {
    const run = candidate as Pick<StartupSopRun, 'sopId'>;
    if (!document.sops.some(item => item.id === run.sopId)) throw new Error('SOP not found');
  }
}

async function ensureRoot(): Promise<void> {
  await fs.mkdir(root(), { recursive: true, mode: 0o700 });
}

async function readDocument(tenantId: string): Promise<StoredDocument> {
  await ensureRoot();
  try {
    const parsed = JSON.parse(await fs.readFile(tenantFile(tenantId), 'utf8')) as Partial<StoredDocument>;
    if (parsed.schemaVersion !== 1) throw new Error('Unsupported startup hub schema');
    return {
      ...emptyDocument(),
      ...parsed,
      company: parsed.company || null,
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      taxRecords: Array.isArray(parsed.taxRecords) ? parsed.taxRecords : [],
      announcements: Array.isArray(parsed.announcements) ? parsed.announcements : [],
      products: Array.isArray(parsed.products) ? parsed.products : [],
      apiEndpoints: Array.isArray(parsed.apiEndpoints) ? parsed.apiEndpoints : [],
      logSources: Array.isArray(parsed.logSources) ? parsed.logSources : [],
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      resources: Array.isArray(parsed.resources) ? parsed.resources : [],
      deployments: Array.isArray(parsed.deployments) ? parsed.deployments : [],
      members: Array.isArray(parsed.members) ? parsed.members : [],
      documents: Array.isArray(parsed.documents) ? parsed.documents : [],
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
      sops: Array.isArray(parsed.sops) ? parsed.sops : [],
      sopRuns: Array.isArray(parsed.sopRuns) ? parsed.sopRuns : [],
      capabilities: Array.isArray(parsed.capabilities) ? parsed.capabilities : [],
      leads: Array.isArray(parsed.leads) ? parsed.leads : [],
      leadActivities: Array.isArray(parsed.leadActivities) ? parsed.leadActivities : [],
      leadChatImports: Array.isArray(parsed.leadChatImports) ? parsed.leadChatImports : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyDocument();
    throw error;
  }
}

async function writeDocument(tenantId: string, document: StoredDocument): Promise<void> {
  await ensureRoot();
  const target = tenantFile(tenantId);
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await fs.rename(temporary, target);
  await fs.chmod(target, 0o600);
}

function mutate<T>(tenantId: string, action: (document: StoredDocument) => T | Promise<T>): Promise<T> {
  const prior = queues.get(tenantId) || Promise.resolve();
  const run = prior.then(async () => {
    const document = await readDocument(tenantId);
    const result = await action(document);
    document.updatedAt = new Date().toISOString();
    await writeDocument(tenantId, document);
    return result;
  });
  queues.set(tenantId, run.then(() => undefined, () => undefined));
  return run;
}

export async function readStartupHubSnapshot(tenantId: string): Promise<StartupHubSnapshot> {
  const { schemaVersion: _schemaVersion, ...snapshot } = await readDocument(tenantId);
  return structuredClone(snapshot);
}

export function updateStartupCompany(tenantId: string, userId: string, input: unknown): Promise<StartupCompanyProfile> {
  assertNoSecrets(input);
  if (!input || typeof input !== 'object' || Array.isArray(input)) return Promise.reject(new Error('Invalid company profile'));
  const value = input as Record<string, unknown>;
  return mutate(tenantId, document => {
    const company: StartupCompanyProfile = {
      name: text(value.name, 'name'),
      taxpayerType: optionalText(value.taxpayerType, 'taxpayerType', 120) || '未确认',
      taxRegion: optionalText(value.taxRegion, 'taxRegion', 120) || '',
      taxContact: optionalText(value.taxContact, 'taxContact', 120) || '',
      creditCode: optionalText(value.creditCode, 'creditCode', 40),
      entityType: optionalText(value.entityType, 'entityType', 80),
      legalRepresentative: optionalText(value.legalRepresentative, 'legalRepresentative', 120),
      establishedDate: optionalDate(value.establishedDate, 'establishedDate'),
      industry: optionalText(value.industry, 'industry', 120),
      accountingStandard: optionalText(value.accountingStandard, 'accountingStandard', 120),
      bookkeepingMode: optionalText(value.bookkeepingMode, 'bookkeepingMode', 80),
      vatFilingCycle: optionalText(value.vatFilingCycle, 'vatFilingCycle', 40),
      incomeTaxFilingCycle: optionalText(value.incomeTaxFilingCycle, 'incomeTaxFilingCycle', 40),
      employeeStatus: optionalText(value.employeeStatus, 'employeeStatus', 40),
      bankName: optionalText(value.bankName, 'bankName', 120),
      bankBranch: optionalText(value.bankBranch, 'bankBranch', 180),
      bankCustomerNumber: optionalText(value.bankCustomerNumber, 'bankCustomerNumber', 60),
      bankOperatorNumber: optionalText(value.bankOperatorNumber, 'bankOperatorNumber', 60),
      bankAccount: optionalText(value.bankAccount, 'bankAccount', 40),
      basicDepositAccountNumber: optionalText(value.basicDepositAccountNumber, 'basicDepositAccountNumber', 60),
      bankAccountOpenedDate: optionalDate(value.bankAccountOpenedDate, 'bankAccountOpenedDate'),
      onlineBankingSecurityStatus: optionalText(value.onlineBankingSecurityStatus, 'onlineBankingSecurityStatus', 40),
      bankAccountTaxReportStatus: optionalText(value.bankAccountTaxReportStatus, 'bankAccountTaxReportStatus', 40),
      taxPaymentAgreementStatus: optionalText(value.taxPaymentAgreementStatus, 'taxPaymentAgreementStatus', 40),
      updatedAt: new Date().toISOString(),
      updatedBy: userId,
    };
    document.company = company;
    return structuredClone(company);
  });
}

export function createStartupHubRecord<K extends StartupHubRecordKind>(tenantId: string, userId: string, kind: K, input: unknown): Promise<StartupHubRecordMap[K]> {
  if (!COLLECTIONS.has(kind)) return Promise.reject(new Error('Unsupported collection'));
  const clean = sanitizeInput(kind, input);
  return mutate(tenantId, document => {
    validateRelations(document, kind, clean);
    const timestamp = new Date().toISOString();
    const record = { id: randomUUID(), ...clean, createdAt: timestamp, updatedAt: timestamp, createdBy: userId } as StartupHubRecordMap[K];
    (document[kind] as StartupHubRecordMap[K][]).unshift(record);
    return structuredClone(record);
  });
}

export function updateStartupHubRecord<K extends StartupHubRecordKind>(tenantId: string, _userId: string, kind: K, id: string, patch: unknown): Promise<StartupHubRecordMap[K]> {
  if (!COLLECTIONS.has(kind)) return Promise.reject(new Error('Unsupported collection'));
  assertNoSecrets(patch);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return Promise.reject(new Error('Invalid patch'));
  return mutate(tenantId, document => {
    const records = document[kind] as StartupHubRecordMap[K][];
    const index = records.findIndex(record => record.id === id);
    if (index < 0) throw new Error('Record not found');
    const current = records[index];
    const candidate = sanitizeInput(kind, { ...current, ...(patch as object) });
    validateRelations(document, kind, candidate);
    const updated = { ...current, ...candidate, id: current.id, createdAt: current.createdAt, createdBy: current.createdBy, updatedAt: new Date().toISOString() } as StartupHubRecordMap[K];
    records[index] = updated;
    return structuredClone(updated);
  });
}

export function acknowledgeStartupAnnouncement(tenantId: string, userId: string, id: string): Promise<StartupAnnouncement> {
  return mutate(tenantId, document => {
    const record = document.announcements.find(item => item.id === id);
    if (!record) throw new Error('Record not found');
    if (!record.acknowledgedBy.includes(userId)) record.acknowledgedBy.push(userId);
    record.updatedAt = new Date().toISOString();
    return structuredClone(record);
  });
}

const DOCUMENT_CATEGORIES = new Set<StartupCompanyDocumentCategory>(['license', 'articles', 'tax', 'bank', 'contract', 'hr', 'ip', 'other']);

export async function saveStartupCompanyDocument(tenantId: string, userId: string, input: {
  sourcePath: string;
  name: string;
  category: StartupCompanyDocumentCategory;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  expiryDate?: string;
}): Promise<StartupCompanyDocument> {
  if (!DOCUMENT_CATEGORIES.has(input.category)) throw new Error('Invalid document category');
  const name = text(input.name, 'name', 180);
  const mimeType = text(input.mimeType, 'mimeType', 160);
  const sizeBytes = Number(input.sizeBytes);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) throw new Error('Invalid document size');
  if (!/^[a-f0-9]{64}$/.test(input.sha256)) throw new Error('Invalid document checksum');
  const expiryDate = optionalDate(input.expiryDate, 'expiryDate');
  const record: StartupCompanyDocument = {
    id: randomUUID(),
    name,
    category: input.category,
    mimeType,
    sizeBytes,
    sha256: input.sha256,
    expiryDate,
    uploadedAt: new Date().toISOString(),
    uploadedBy: userId,
  };
  const directory = tenantFileDirectory(tenantId);
  const target = path.join(directory, record.id);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.copyFile(input.sourcePath, target, fs.constants.COPYFILE_EXCL);
  await fs.chmod(target, 0o600);
  try {
    return await mutate(tenantId, document => {
      document.documents.unshift(record);
      return structuredClone(record);
    });
  } catch (error) {
    await fs.unlink(target).catch(() => undefined);
    throw error;
  }
}

export async function resolveStartupCompanyDocument(tenantId: string, id: string): Promise<{ document: StartupCompanyDocument; filePath: string }> {
  const snapshot = await readDocument(tenantId);
  const document = snapshot.documents.find(item => item.id === id);
  if (!document) throw new Error('Record not found');
  const filePath = path.join(tenantFileDirectory(tenantId), document.id);
  await fs.access(filePath);
  return { document: structuredClone(document), filePath };
}

export async function deleteStartupCompanyDocument(tenantId: string, id: string): Promise<void> {
  const filePath = await mutate(tenantId, document => {
    const index = document.documents.findIndex(item => item.id === id);
    if (index < 0) throw new Error('Record not found');
    document.documents.splice(index, 1);
    return path.join(tenantFileDirectory(tenantId), id);
  });
  await fs.unlink(filePath).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  });
}

export async function saveStartupLeadChatImport(tenantId: string, userId: string, input: {
  sourcePath: string;
  leadId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  messageCount: number;
  startedAt?: string;
  endedAt?: string;
}): Promise<StartupLeadChatImport> {
  const name = text(input.name, 'name', 180);
  const leadId = text(input.leadId, 'leadId', 100);
  const mimeType = text(input.mimeType, 'mimeType', 120);
  const sizeBytes = Number(input.sizeBytes);
  const messageCount = nonNegativeInteger(input.messageCount, 'messageCount');
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) throw new Error('Invalid chat import size');
  if (!/^[a-f0-9]{64}$/.test(input.sha256)) throw new Error('Invalid chat import checksum');
  const record: StartupLeadChatImport = {
    id: randomUUID(),
    leadId,
    name,
    mimeType,
    sizeBytes,
    sha256: input.sha256,
    messageCount,
    startedAt: optionalDate(input.startedAt, 'startedAt'),
    endedAt: optionalDate(input.endedAt, 'endedAt'),
    uploadedAt: new Date().toISOString(),
    uploadedBy: userId,
  };
  const directory = tenantChatDirectory(tenantId);
  const target = path.join(directory, record.id);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.copyFile(input.sourcePath, target, fs.constants.COPYFILE_EXCL);
  await fs.chmod(target, 0o600);
  try {
    return await mutate(tenantId, document => {
      if (!document.leads.some(item => item.id === leadId)) throw new Error('Lead not found');
      document.leadChatImports.unshift(record);
      return structuredClone(record);
    });
  } catch (error) {
    await fs.unlink(target).catch(() => undefined);
    throw error;
  }
}

export async function resolveStartupLeadChatImport(tenantId: string, id: string): Promise<{ chatImport: StartupLeadChatImport; filePath: string }> {
  const snapshot = await readDocument(tenantId);
  const chatImport = snapshot.leadChatImports.find(item => item.id === id);
  if (!chatImport) throw new Error('Record not found');
  const filePath = path.join(tenantChatDirectory(tenantId), chatImport.id);
  await fs.access(filePath);
  return { chatImport: structuredClone(chatImport), filePath };
}

export async function deleteStartupLeadChatImport(tenantId: string, id: string): Promise<void> {
  const filePath = await mutate(tenantId, document => {
    const index = document.leadChatImports.findIndex(item => item.id === id);
    if (index < 0) throw new Error('Record not found');
    document.leadChatImports.splice(index, 1);
    return path.join(tenantChatDirectory(tenantId), id);
  });
  await fs.unlink(filePath).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  });
}
