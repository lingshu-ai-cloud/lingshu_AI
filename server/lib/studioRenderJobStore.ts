import fs from 'node:fs';
import path from 'node:path';

export type StudioRenderJobStatus = 'authorized' | 'rendering' | 'completed' | 'rejected' | 'failed';

export interface StudioRenderJobRecord {
  jobId: string;
  tenantId: string;
  manifestSha256: string;
  manifest: Record<string, unknown>;
  sourceProjectId?: string;
  language?: string;
  authorizationBatchKey?: string;
  authorizationBatchFingerprint?: string;
  authorizationExpiresAt?: number;
  digitalHumanTimelineAudit?: Array<Record<string, unknown>>;
  containsDigitalHuman: boolean;
  status: StudioRenderJobStatus;
  renderStartedAt?: string;
  renderLeaseId?: string;
  renderLeaseUntil?: string;
  renderAttemptCount?: number;
  outputFilename?: string;
  outputSha256?: string;
  outputSizeBytes?: number;
  qualityReport?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

function storeFile(): string {
  if (String(process.env.STUDIO_RENDER_JOBS_FILE || '').trim()) return path.resolve(String(process.env.STUDIO_RENDER_JOBS_FILE));
  return path.resolve(process.cwd(), 'data', 'studio-render-jobs.json');
}

function loadRecords(): StudioRenderJobRecord[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(storeFile(), 'utf8')) as unknown;
    if (!Array.isArray(parsed)) throw new Error('studio render job store must contain an array');
    return parsed as StudioRenderJobRecord[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function persistRecords(records: StudioRenderJobRecord[]): void {
  const file = storeFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(records, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

export interface CreateStudioRenderJobInput {
  jobId: string;
  tenantId: string;
  manifestSha256: string;
  manifest: Record<string, unknown>;
  sourceProjectId?: string;
  language?: string;
  authorizationBatchKey?: string;
  authorizationBatchFingerprint?: string;
  authorizationExpiresAt?: number;
  digitalHumanTimelineAudit?: Array<Record<string, unknown>>;
  containsDigitalHuman: boolean;
  outputFilename?: string;
}

export function createStudioRenderJob(input: CreateStudioRenderJobInput): StudioRenderJobRecord {
  return createStudioRenderJobBatch([input])[0]!;
}

export function createStudioRenderJobBatch(inputs: readonly CreateStudioRenderJobInput[]): StudioRenderJobRecord[] {
  if (!inputs.length) throw new Error('studio render job batch is empty');
  const records = loadRecords();
  const ids = new Set<string>();
  for (const input of inputs) {
    if (!input.jobId || ids.has(input.jobId) || records.some(record => record.jobId === input.jobId)) {
      throw new Error('studio render job already exists');
    }
    if (input.authorizationBatchKey && records.some(record => record.tenantId === input.tenantId
      && record.authorizationBatchKey === input.authorizationBatchKey)) {
      throw new Error('studio render authorization batch already exists');
    }
    ids.add(input.jobId);
  }
  const now = new Date().toISOString();
  const created = inputs.map((input): StudioRenderJobRecord => ({
    ...input,
    status: 'authorized',
    createdAt: now,
    updatedAt: now,
  }));
  persistRecords([...records, ...created]);
  return created;
}

export function updateStudioRenderJob(
  jobId: string,
  tenantId: string,
  patch: Partial<Omit<StudioRenderJobRecord, 'jobId' | 'tenantId' | 'manifestSha256' | 'manifest' | 'containsDigitalHuman' | 'createdAt'>>,
): StudioRenderJobRecord | null {
  const records = loadRecords();
  const index = records.findIndex(record => record.jobId === jobId && record.tenantId === tenantId);
  if (index < 0) return null;
  const record = { ...records[index]!, ...patch, updatedAt: new Date().toISOString() };
  records[index] = record;
  persistRecords(records);
  return record;
}

export function refreshStudioRenderJobAuthorization(input: {
  jobId: string;
  tenantId: string;
  authorizationBatchKey: string;
  authorizationBatchFingerprint: string;
  manifestSha256: string;
  manifest: Record<string, unknown>;
  authorizationExpiresAt: number;
  digitalHumanTimelineAudit?: Array<Record<string, unknown>>;
}): StudioRenderJobRecord {
  return refreshStudioRenderJobAuthorizations([input])[0]!;
}

export function refreshStudioRenderJobAuthorizations(inputs: ReadonlyArray<{
  jobId: string;
  tenantId: string;
  authorizationBatchKey: string;
  authorizationBatchFingerprint: string;
  manifestSha256: string;
  manifest: Record<string, unknown>;
  authorizationExpiresAt: number;
  digitalHumanTimelineAudit?: Array<Record<string, unknown>>;
}>): StudioRenderJobRecord[] {
  if (!inputs.length) throw new Error('studio render authorization refresh batch is empty');
  const records = loadRecords();
  const seen = new Set<string>();
  const now = new Date().toISOString();
  const updated = inputs.map(input => {
    if (seen.has(input.jobId)) throw new Error('studio render authorization refresh contains a duplicate job id');
    seen.add(input.jobId);
    const index = records.findIndex(record => record.jobId === input.jobId && record.tenantId === input.tenantId);
    const current = index >= 0 ? records[index] : undefined;
    if (!current
      || current.authorizationBatchKey !== input.authorizationBatchKey
      || current.authorizationBatchFingerprint !== input.authorizationBatchFingerprint) {
      throw new Error('studio render authorization batch identity mismatch');
    }
    const next: StudioRenderJobRecord = {
      ...current,
      manifestSha256: input.manifestSha256,
      manifest: input.manifest,
      authorizationExpiresAt: input.authorizationExpiresAt,
      digitalHumanTimelineAudit: input.digitalHumanTimelineAudit,
      updatedAt: now,
    };
    records[index] = next;
    return next;
  });
  persistRecords(records);
  return updated;
}

export type StudioRenderLeaseClaim =
  | { ok: true; record: StudioRenderJobRecord }
  | { ok: false; code: 'missing' | 'already_running' };

export function claimStudioRenderJobLease(input: {
  jobId: string;
  tenantId: string;
  leaseId: string;
  nowMs?: number;
  leaseDurationMs: number;
}): StudioRenderLeaseClaim {
  const records = loadRecords();
  const index = records.findIndex(record => record.jobId === input.jobId && record.tenantId === input.tenantId);
  if (index < 0) return { ok: false, code: 'missing' };
  const current = records[index]!;
  const nowMs = input.nowMs ?? Date.now();
  if (studioRenderLeaseIsActive(current, nowMs)) return { ok: false, code: 'already_running' };
  const now = new Date(nowMs).toISOString();
  const next: StudioRenderJobRecord = {
    ...current,
    status: 'rendering',
    renderStartedAt: now,
    renderLeaseId: input.leaseId,
    renderLeaseUntil: new Date(nowMs + input.leaseDurationMs).toISOString(),
    renderAttemptCount: Math.max(0, Number(current.renderAttemptCount) || 0) + 1,
    qualityReport: undefined,
    errorCode: undefined,
    errorMessage: undefined,
    updatedAt: now,
  };
  records[index] = next;
  persistRecords(records);
  return { ok: true, record: next };
}

export function updateStudioRenderJobForLease(
  jobId: string,
  tenantId: string,
  leaseId: string,
  patch: Partial<Omit<StudioRenderJobRecord, 'jobId' | 'tenantId' | 'manifestSha256' | 'manifest' | 'containsDigitalHuman' | 'createdAt'>>,
): StudioRenderJobRecord | null {
  const records = loadRecords();
  const index = records.findIndex(record => record.jobId === jobId && record.tenantId === tenantId
    && record.status === 'rendering' && record.renderLeaseId === leaseId);
  if (index < 0) return null;
  const record = { ...records[index]!, ...patch, updatedAt: new Date().toISOString() };
  records[index] = record;
  persistRecords(records);
  return record;
}

export function findStudioRenderJobsByBatch(batchKey: string, tenantId: string): StudioRenderJobRecord[] {
  return loadRecords().filter(record => record.tenantId === tenantId && record.authorizationBatchKey === batchKey);
}

export function removeStudioRenderJobs(jobIds: readonly string[], tenantId: string): void {
  const ids = new Set(jobIds);
  if (!ids.size) return;
  const records = loadRecords();
  const next = records.filter(record => record.tenantId !== tenantId || !ids.has(record.jobId));
  if (next.length !== records.length) persistRecords(next);
}

export function studioRenderLeaseIsActive(record: StudioRenderJobRecord, nowMs = Date.now()): boolean {
  return record.status === 'rendering'
    && Number.isFinite(Date.parse(String(record.renderLeaseUntil || '')))
    && Date.parse(String(record.renderLeaseUntil)) > nowMs;
}

export function findStudioRenderJob(jobId: string, tenantId: string): StudioRenderJobRecord | null {
  return loadRecords().find(record => record.jobId === jobId && record.tenantId === tenantId) || null;
}

export function findStudioRenderJobByOutput(filename: string, tenantId: string): StudioRenderJobRecord | null {
  const safeFilename = path.basename(String(filename || ''));
  return loadRecords().find(record => record.tenantId === tenantId && record.outputFilename === safeFilename) || null;
}

export function studioRenderOutputIsDownloadable(record: StudioRenderJobRecord | null): boolean {
  if (!record) return false;
  if (record.status !== 'completed') return false;
  if (!record.containsDigitalHuman) return true;
  return record.qualityReport?.passed === true;
}
