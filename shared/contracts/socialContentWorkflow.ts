/** Public contracts for the Starter 198 social-content workflow. */

export const SOCIAL_CONTENT_TASK_STATUSES = [
  'draft',
  'needs_input',
  'plan_review',
  'producing',
  'asset_review',
  'packaging',
  'delivered',
  'awaiting_publish',
  'awaiting_metrics',
  'reviewed',
  'paused',
  'attention',
] as const;
export type SocialContentTaskStatus = typeof SOCIAL_CONTENT_TASK_STATUSES[number];

export const SOCIAL_WORK_PACKAGE_KINDS = [
  'industry_launch',
  'content_rocket',
  'task_express',
] as const;
export type SocialWorkPackageKind = typeof SOCIAL_WORK_PACKAGE_KINDS[number];

export const SOCIAL_WORK_PACKAGE_STATUSES = ['draft', 'internal_trial', 'active', 'retired'] as const;
export type SocialWorkPackageStatus = typeof SOCIAL_WORK_PACKAGE_STATUSES[number];

export const SOCIAL_SOURCE_KINDS = ['material', 'knowledge', 'reference_link', 'text_note'] as const;
export type SocialSourceKind = typeof SOCIAL_SOURCE_KINDS[number];

export const SOCIAL_ARTIFACT_STATUSES = ['draft', 'review_required', 'approved', 'changes_requested', 'superseded'] as const;
export type SocialArtifactStatus = typeof SOCIAL_ARTIFACT_STATUSES[number];

export interface SocialWorkPackageCard {
  kind: SocialWorkPackageKind;
  packageKey: string;
  version: string;
  name: string;
  available: boolean;
  summary: string | null;
  requiredInputs: string[];
  deliverables: string[];
}

export interface SocialWorkPackageFramework {
  applicability: string[];
  requiredInputs: string[];
  workOutline: string[];
  deliverables: string[];
  userDecisions: string[];
  qualityChecks: string[];
  metricRequirements: string[];
  fallbackPolicy: string[];
}

export interface SocialWorkPackageVersionDetail extends SocialWorkPackageCard {
  summary: string | null;
  status: SocialWorkPackageStatus;
  framework: SocialWorkPackageFramework;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  recordVersion: string;
  updatedAt: string;
  builtin: boolean;
}

export interface CreateSocialWorkPackageVersionInput {
  kind: SocialWorkPackageKind;
  packageKey: string;
  version: string;
  name: string;
  summary?: string | null;
  framework?: Partial<SocialWorkPackageFramework>;
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
}

export interface UpdateSocialWorkPackageVersionInput {
  expectedVersion: string;
  changes: Partial<Omit<CreateSocialWorkPackageVersionInput, 'kind' | 'packageKey' | 'version'>>;
}

export interface SocialWorkPackageSelection {
  kind: SocialWorkPackageKind;
  packageKey: string;
  version: string;
  name: string;
}

export interface SocialContentTaskBrief {
  title: string;
  objective: string;
  productRef: string | null;
  audience: string | null;
  markets: string[];
  languages: string[];
  platforms: string[];
  formats: string[];
  aspectRatio: string | null;
  cadence: string | null;
  requestedOutputCount: number | null;
  weeklyBudgetCny?: number | null;
  perItemBudgetCny?: number | null;
  retryReserveCny?: number | null;
  planningMode?: 'fixed' | 'auto_adjust';
  shootingWindowMinutes?: number | null;
  specialRequirements?: string | null;
  dueAt: string | null;
  brandNotes: string | null;
  restrictions: string[];
  callToAction: string | null;
}

export interface SocialContentTaskSummary {
  taskId: string;
  brief: SocialContentTaskBrief;
  status: SocialContentTaskStatus;
  version: string;
  packageSelection: SocialWorkPackageSelection[];
  readiness: { complete: boolean; missing: string[] };
  runId: string | null;
  sourceCount: number;
  knowledgeSourceCount: number;
  materialSourceCount: number;
  artifactCount: number;
  approvedArtifactCount: number;
  deliveryPackageCount: number;
  publicationCount: number;
  metricSubmissionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SocialTaskSource {
  sourceId: string;
  taskId: string;
  kind: SocialSourceKind;
  sourceRef: string;
  sourceVersion: string | null;
  label: string;
  purpose: string | null;
  status: 'active' | 'replaced' | 'removed';
  createdAt: string;
}

export interface SocialContentFile {
  fileId: string;
  taskId: string;
  usage: 'source' | 'metric_evidence' | 'artifact_media';
  fileRef: string;
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
  createdAt: string;
}

export interface SocialContentSourceOption {
  optionId: string;
  kind: 'knowledge' | 'material';
  sourceRef: string;
  sourceVersion: string;
  label: string;
  type: string;
  thumbnailHref: string | null;
}

export interface SocialContentSourceOptionPage {
  items: SocialContentSourceOption[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
  status: 'ready' | 'partial' | 'unavailable';
}

export interface SocialContentArtifact {
  artifactId: string;
  taskId: string;
  kind: string;
  platform: string | null;
  language: string | null;
  version: string;
  status: SocialArtifactStatus;
  origin: 'agent' | 'manual';
  resourceRef: string | null;
  content: Record<string, unknown> | null;
  parentArtifactId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SocialDeliveryPackage {
  packageId: string;
  taskId: string;
  version: string;
  status: 'preparing' | 'ready' | 'confirmed' | 'superseded';
  artifactIds: string[];
  packageHash: string;
  downloadHref: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SocialPublicationRecord {
  publicationId: string;
  taskId: string;
  packageId: string;
  platform: string;
  accountLabel: string | null;
  publicUrl: string | null;
  platformPostId: string | null;
  publishedAt: string;
  notes: string | null;
  status: 'registered';
  createdAt: string;
  updatedAt: string;
}

export interface SocialMetricSubmission {
  submissionId: string;
  taskId: string;
  publicationId: string;
  method: 'link' | 'platform_id' | 'table' | 'screenshot' | 'manual' | 'connected_account';
  capturedAt: string;
  metrics: Record<string, number | null>;
  evidenceRefs: string[];
  notes: string | null;
  status: 'received' | 'needs_confirmation' | 'confirmed';
  version: string;
  createdAt: string;
}

export interface SocialContentTaskDetail extends SocialContentTaskSummary {
  sources: SocialTaskSource[];
  artifacts: SocialContentArtifact[];
  deliveryPackages: SocialDeliveryPackage[];
  publications: SocialPublicationRecord[];
  metricSubmissions: SocialMetricSubmission[];
}

export interface SocialContentTaskPage {
  items: SocialContentTaskSummary[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
}

export type SocialContentTaskListMeta = Omit<SocialContentTaskPage, 'items'>;

export interface SocialContentWorkspace {
  catalog: SocialWorkPackageCard[];
  tasks: SocialContentTaskSummary[];
  taskList: SocialContentTaskListMeta;
  currentTask: SocialContentTaskDetail | null;
}

export interface CreateSocialContentTaskInput {
  title: string;
  objective: string;
  productRef?: string | null;
  audience?: string | null;
  markets?: string[];
  languages?: string[];
  platforms?: string[];
  formats?: string[];
  aspectRatio?: string | null;
  cadence?: string | null;
  requestedOutputCount?: number | null;
  weeklyBudgetCny?: number | null;
  perItemBudgetCny?: number | null;
  retryReserveCny?: number | null;
  planningMode?: 'fixed' | 'auto_adjust';
  shootingWindowMinutes?: number | null;
  specialRequirements?: string | null;
  dueAt?: string | null;
  brandNotes?: string | null;
  restrictions?: string[];
  callToAction?: string | null;
}

export interface UpdateSocialContentTaskInput {
  expectedVersion: string;
  changes: Partial<CreateSocialContentTaskInput>;
}

export interface AddSocialTaskSourceInput {
  kind: SocialSourceKind;
  sourceRef: string;
  sourceVersion?: string | null;
  label: string;
  purpose?: string | null;
}

export interface SelectSocialWorkPackagesInput {
  expectedVersion: string;
  selections: Array<Pick<SocialWorkPackageSelection, 'kind' | 'packageKey' | 'version'>>;
}

export interface CreateSocialArtifactInput {
  kind: string;
  platform?: string | null;
  language?: string | null;
  origin: 'agent' | 'manual';
  resourceRef?: string | null;
  content?: Record<string, unknown> | null;
  parentArtifactId?: string | null;
}

export interface DecideSocialArtifactInput {
  expectedVersion: string;
  decision: 'approved' | 'changes_requested';
  note?: string | null;
}

export interface DecideSocialArtifactBatchInput {
  artifacts: Array<{ artifactId: string; expectedVersion: string }>;
  decision: 'approved' | 'changes_requested';
  note?: string | null;
}

export interface CreateSocialDeliveryPackageInput {
  expectedTaskVersion: string;
  artifactIds: string[];
}

export interface RegisterSocialPublicationInput {
  expectedTaskVersion: string;
  packageId: string;
  platform: string;
  accountLabel?: string | null;
  publicUrl?: string | null;
  platformPostId?: string | null;
  publishedAt: string;
  notes?: string | null;
}

export interface SubmitSocialMetricsInput {
  method: SocialMetricSubmission['method'];
  capturedAt: string;
  metrics: Record<string, number | null>;
  evidenceRefs?: string[];
  notes?: string | null;
}
