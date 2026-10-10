export type StartupHubRecordKind = 'tasks' | 'taxRecords' | 'announcements' | 'products' | 'productDocuments' | 'productReviews' | 'developmentTasks' | 'apiEndpoints' | 'logSources' | 'issues' | 'resources' | 'deployments' | 'members' | 'decisions' | 'sops' | 'sopRuns' | 'capabilities' | 'leads' | 'leadActivities';

export interface StartupHubBaseRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface StartupCompanyProfile {
  name: string;
  taxpayerType: string;
  taxRegion: string;
  taxContact: string;
  creditCode?: string;
  entityType?: string;
  legalRepresentative?: string;
  establishedDate?: string;
  industry?: string;
  accountingStandard?: string;
  bookkeepingMode?: string;
  vatFilingCycle?: string;
  incomeTaxFilingCycle?: string;
  employeeStatus?: string;
  bankName?: string;
  bankBranch?: string;
  bankCustomerNumber?: string;
  bankOperatorNumber?: string;
  bankAccount?: string;
  basicDepositAccountNumber?: string;
  bankAccountOpenedDate?: string;
  onlineBankingSecurityStatus?: string;
  bankAccountTaxReportStatus?: string;
  taxPaymentAgreementStatus?: string;
  updatedAt: string;
  updatedBy: string;
}

export interface StartupTask extends StartupHubBaseRecord {
  title: string;
  area: string;
  owner: string;
  dueDate?: string;
  priority: 'high' | 'medium' | 'low';
  status: 'open' | 'completed';
}

export interface StartupTaxRecord extends StartupHubBaseRecord {
  title: string;
  taxType: string;
  period: string;
  dueDate?: string;
  owner: string;
  status: 'draft' | 'preparing' | 'ready' | 'filed' | 'paid';
  notes?: string;
}

export interface StartupAnnouncement extends StartupHubBaseRecord {
  title: string;
  body: string;
  audience: string;
  priority: 'normal' | 'important' | 'urgent';
  requireConfirm: boolean;
  acknowledgedBy: string[];
}

export interface StartupProduct extends StartupHubBaseRecord {
  name: string;
  owner: string;
  status: 'planning' | 'active' | 'paused' | 'archived';
  version?: string;
  description?: string;
  customerProblem?: string;
  successMetric?: string;
  targetDate?: string;
}

export interface StartupProductDocument extends StartupHubBaseRecord {
  productId: string;
  title: string;
  owner: string;
  reviewers: string[];
  status: 'draft' | 'review' | 'approved' | 'archived';
  version: string;
  content: string;
}

export interface StartupProductReview extends StartupHubBaseRecord {
  productId: string;
  documentId?: string;
  type: 'requirements' | 'technical';
  title: string;
  owner: string;
  reviewers: string[];
  status: 'pending' | 'in_review' | 'approved' | 'changes_requested';
  scheduledAt?: string;
  checklist: string[];
  decision?: string;
  notes?: string;
}

export interface StartupDevelopmentTask extends StartupHubBaseRecord {
  productId: string;
  documentId?: string;
  title: string;
  type: 'frontend' | 'backend' | 'fullstack' | 'design' | 'qa' | 'devops' | 'other';
  assignee: string;
  reviewer?: string;
  status: 'backlog' | 'ready' | 'in_progress' | 'in_review' | 'blocked' | 'done';
  priority: 'critical' | 'high' | 'medium' | 'low';
  dueDate?: string;
  estimatePoints?: number;
  acceptanceCriteria: string;
  branch?: string;
  blockedReason?: string;
}

export interface StartupApiEndpoint extends StartupHubBaseRecord {
  name: string;
  method: string;
  path: string;
  environment: string;
  owner: string;
  productId?: string;
  status: 'designing' | 'developing' | 'testing' | 'production' | 'deprecated';
}

export interface StartupIssue extends StartupHubBaseRecord {
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'open' | 'investigating' | 'fixing' | 'verifying' | 'closed';
  source: string;
  assignee: string;
  productId?: string;
  apiEndpointId?: string;
  resourceId?: string;
  dueDate?: string;
  reportedBy?: string;
  environment?: string;
  reproductionSteps?: string;
  expectedBehavior?: string;
  actualBehavior?: string;
  rootCause?: string;
  resolution?: string;
  linkedTaskId?: string;
}

export interface StartupLogSource extends StartupHubBaseRecord {
  name: string;
  provider: string;
  environment: string;
  owner: string;
  status: 'connected' | 'disconnected' | 'error';
  queryUrl?: string;
}

export interface StartupResource extends StartupHubBaseRecord {
  name: string;
  type: string;
  environment: string;
  owner: string;
  status: 'unknown' | 'healthy' | 'warning' | 'offline';
  provider?: string;
  region?: string;
  billingCycle?: 'monthly' | 'quarterly' | 'annual' | 'pay_as_you_go' | 'free';
  subscriptionAmount?: number;
  currency?: 'CNY' | 'USD' | 'EUR' | 'HKD';
  renewalDate?: string;
  cpuCores?: number;
  memoryTotalGb?: number;
  storageTotalGb?: number;
  storageUsedGb?: number;
  trafficTotalGb?: number;
  trafficUsedGb?: number;
  managementUrl?: string;
  notes?: string;
}

export interface StartupDeployment extends StartupHubBaseRecord {
  name: string;
  resourceId: string;
  environment: string;
  serviceType: 'frontend' | 'api' | 'worker' | 'database' | 'proxy' | 'storage' | 'other';
  owner: string;
  status: 'planned' | 'deploying' | 'running' | 'degraded' | 'stopped';
  version?: string;
  branch?: string;
  url?: string;
  deployedAt?: string;
}

export interface StartupMember extends StartupHubBaseRecord {
  name: string;
  email: string;
  role: 'admin' | 'operator' | 'viewer';
  status: 'invited' | 'active' | 'disabled';
}

export interface StartupDecision extends StartupHubBaseRecord {
  title: string;
  context: string;
  decision: string;
  owner: string;
  impact: 'company' | 'product' | 'customer' | 'finance' | 'team' | 'technology';
  status: 'active' | 'superseded';
  reviewDate?: string;
}

export interface StartupSop extends StartupHubBaseRecord {
  name: string;
  trigger: string;
  owner: string;
  version: string;
  status: 'draft' | 'active' | 'retired';
  steps: string[];
  successCriteria?: string;
}

export interface StartupSopRun extends StartupHubBaseRecord {
  sopId: string;
  sopName: string;
  owner: string;
  status: 'running' | 'blocked' | 'completed';
  completedSteps: number[];
  dueDate?: string;
  note?: string;
}

export interface StartupCapability extends StartupHubBaseRecord {
  name: string;
  type: 'template' | 'tool' | 'integration' | 'knowledge' | 'automation';
  owner: string;
  status: 'draft' | 'active' | 'retired';
  description: string;
  locationUrl?: string;
  reuseCount: number;
}

export interface StartupLead extends StartupHubBaseRecord {
  companyName: string;
  resourceType: 'customer' | 'channel' | 'fde_partner' | 'supplier' | 'association' | 'other';
  industry: string;
  country: string;
  province?: string;
  city?: string;
  contactName: string;
  contactRole?: string;
  contactMethod: 'wechat' | 'phone' | 'email' | 'whatsapp' | 'linkedin' | 'other';
  contactValue?: string;
  source: string;
  owner: string;
  stage: 'new' | 'qualified' | 'needs' | 'proposal' | 'negotiation' | 'won' | 'lost' | 'nurture';
  intention: 'unknown' | 'low' | 'medium' | 'high';
  nextAction?: string;
  nextFollowUpDate?: string;
  estimatedValue?: number;
  currency?: 'CNY' | 'USD' | 'EUR' | 'HKD';
  notes?: string;
  tags: string[];
}

export interface StartupLeadActivity extends StartupHubBaseRecord {
  leadId: string;
  type: 'note' | 'wechat' | 'call' | 'meeting' | 'email' | 'stage_change';
  owner: string;
  summary: string;
  happenedAt: string;
  nextAction?: string;
  nextFollowUpDate?: string;
}

export interface StartupLeadChatImport {
  id: string;
  leadId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  messageCount: number;
  startedAt?: string;
  endedAt?: string;
  uploadedAt: string;
  uploadedBy: string;
}

export type StartupCompanyDocumentCategory = 'license' | 'articles' | 'tax' | 'bank' | 'contract' | 'hr' | 'ip' | 'other';

export interface StartupCompanyDocument {
  id: string;
  name: string;
  category: StartupCompanyDocumentCategory;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  expiryDate?: string;
  uploadedAt: string;
  uploadedBy: string;
}

export interface StartupHubSnapshot {
  company: StartupCompanyProfile | null;
  tasks: StartupTask[];
  taxRecords: StartupTaxRecord[];
  announcements: StartupAnnouncement[];
  products: StartupProduct[];
  productDocuments: StartupProductDocument[];
  productReviews: StartupProductReview[];
  developmentTasks: StartupDevelopmentTask[];
  apiEndpoints: StartupApiEndpoint[];
  logSources: StartupLogSource[];
  issues: StartupIssue[];
  resources: StartupResource[];
  deployments: StartupDeployment[];
  members: StartupMember[];
  documents: StartupCompanyDocument[];
  decisions: StartupDecision[];
  sops: StartupSop[];
  sopRuns: StartupSopRun[];
  capabilities: StartupCapability[];
  leads: StartupLead[];
  leadActivities: StartupLeadActivity[];
  leadChatImports: StartupLeadChatImport[];
  updatedAt: string | null;
}

export type StartupHubRecordMap = {
  tasks: StartupTask;
  taxRecords: StartupTaxRecord;
  announcements: StartupAnnouncement;
  products: StartupProduct;
  productDocuments: StartupProductDocument;
  productReviews: StartupProductReview;
  developmentTasks: StartupDevelopmentTask;
  apiEndpoints: StartupApiEndpoint;
  logSources: StartupLogSource;
  issues: StartupIssue;
  resources: StartupResource;
  deployments: StartupDeployment;
  members: StartupMember;
  decisions: StartupDecision;
  sops: StartupSop;
  sopRuns: StartupSopRun;
  capabilities: StartupCapability;
  leads: StartupLead;
  leadActivities: StartupLeadActivity;
};

export type StartupHubCreateInput<K extends StartupHubRecordKind> = Omit<StartupHubRecordMap[K], keyof StartupHubBaseRecord>;
