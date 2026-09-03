type StoredShape = Record<string, unknown>;

const BLOCKED_KEYS = new Set([
  'tenantid',
  'leaseowner',
  'leaseexpiresat',
  'idempotencykey',
  'executionsnapshot',
  'sourcefingerprint',
  'provideroperationid',
  'provideroperationhandles',
  'publishoperationid',
  'handlecipher',
  'credentialcipher',
  'ciphertext',
  'videopath',
  'filepath',
  'localpath',
  'sourcepath',
  'outputpath',
  'renderoutputpath',
  'uploadurl',
  'resumableurl',
  'authorization',
  'cookie',
  'setcookie',
  'password',
  'accesstoken',
  'refreshtoken',
  'clientsecret',
  'apisecret',
  'apikey',
  'privatekey',
]);

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function blockedKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return BLOCKED_KEYS.has(normalized)
    || /(?:apikey|secret|password|credential|cipher|ciphertext|privatekey|accesstoken|refreshtoken)$/.test(normalized);
}

function text(value: unknown): string {
  return publicWorkflowText(value);
}

function number(value: unknown): number {
  const candidate = Number(value || 0);
  return Number.isFinite(candidate) ? candidate : 0;
}

function secretMaterial(value: string): boolean {
  return /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(value)
    || /(?:github_pat_[A-Za-z0-9_]{60,}|gh[pousr]_[A-Za-z0-9]{36,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{32,})/.test(value);
}

/** Scrub secrets and host paths that may be embedded inside provider/fs errors. */
export function publicWorkflowText(value: unknown, options: { allowRelativeUrl?: boolean } = {}): string {
  const candidate = typeof value === 'string'
    ? value
    : value === undefined || value === null ? '' : String(value);
  const scrubbed = candidate
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g, '[redacted-private-key]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer [redacted]')
    .replace(/([?&](?:access_token|refresh_token|token|api[_-]?key|client_secret|password)=)[^&#\s]+/gi, '$1[redacted]')
    .replace(/\b(?:github_pat_[A-Za-z0-9_]{60,}|gh[pousr]_[A-Za-z0-9]{36,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{32,})\b/g, '[redacted-token]')
    .replace(/\/\/[^/\s:@]+:[^@\s/]+@/g, '//[redacted]@')
    .replace(/\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*)=(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1=[redacted]');
  if (options.allowRelativeUrl && /^\/(?:api\/|studio(?:[/?#]|$)|scripts(?:[/?#]|$))/.test(scrubbed)) return scrubbed;
  return scrubbed
    .replace(/[a-z]:[\\/][^\s"'`<>),;]*/gi, '[internal-path]')
    .replace(/(["'`])\/(?!\/)[^"'`\r\n]+\1/g, '$1[internal-path]$1')
    .replace(/(?:file:\/\/)?\/(?:Users|home|app|var|tmp|private|opt|srv|root|Volumes|mnt)(?:\/[^\s"'`<>),;]*)?/gi, '[internal-path]')
    .replace(/(^|[\s(:,=])\/(?!\/)(?:[^\s"'`<>),;]+\/)+[^\s"'`<>),;]*/g, '$1[internal-path]');
}

function internalFilesystemPath(value: string, contextKey: string): boolean {
  const candidate = value.trim();
  const normalizedContext = normalizedKey(contextKey);
  return secretMaterial(candidate)
    || /^file:\/\//i.test(candidate)
    || /^[a-z]:[\\/]/i.test(candidate)
    || /^\\\\[^\\]+\\/.test(candidate)
    || /^\/(?:Users|home|app|var|tmp|private|opt|srv|root|Volumes|mnt)(?:\/|$)/i.test(candidate)
    || ((normalizedContext === 'path' || normalizedContext.endsWith('filepath')) && /^\//.test(candidate));
}

function studioPreviewUrl(value: StoredShape, contextKey: string): string {
  if (!text(value.videoPath)) return '';
  const projectId = text(value.id);
  const looksLikeStudioArtifact = /studio|artifact/i.test(contextKey)
    || text(value.type).toLowerCase() === 'studio_project'
    || /^\/studio(?:[/?]|$)/.test(text(value.deepLink || value.deep_link));
  return projectId && looksLikeStudioArtifact
    ? `/api/overseas/digital-employees/artifacts/${encodeURIComponent(projectId)}/video`
    : '';
}

function sanitize(
  value: unknown,
  contextKey: string,
  depth: number,
  ancestors: Set<object>,
): unknown {
  if (depth > 24) return null;
  if (typeof value === 'string') {
    if (internalFilesystemPath(value, contextKey)) return undefined;
    const normalizedContext = normalizedKey(contextKey);
    return publicWorkflowText(value, {
      allowRelativeUrl: /(?:url|href|link)$/.test(normalizedContext),
    });
  }
  if (value === null || typeof value !== 'object') return value;
  if (ancestors.has(value)) return null;
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value
        .map(item => sanitize(item, contextKey, depth + 1, ancestors))
        .filter(item => item !== undefined);
    }
    const source = value as StoredShape;
    const result: StoredShape = {};
    const previewUrl = studioPreviewUrl(source, contextKey);
    for (const [key, candidate] of Object.entries(source)) {
      const normalized = normalizedKey(key);
      if (key === '__proto__' || key === 'prototype' || key === 'constructor' || blockedKey(normalized)) continue;
      const safe = sanitize(candidate, key, depth + 1, ancestors);
      if (safe !== undefined) result[key] = safe;
    }
    if (previewUrl && !text(result.previewUrl)) result.previewUrl = previewUrl;
    return result;
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Final defence for user-visible workflow payloads. Durable records intentionally
 * retain exact execution evidence; browser DTOs never receive datastore tenancy,
 * leases, credentials, provider handles, or host filesystem paths.
 */
export function publicWorkflowValue(value: unknown): unknown {
  return sanitize(value, '', 0, new Set());
}

function safeObject(value: unknown): StoredShape {
  const sanitized = publicWorkflowValue(value);
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? sanitized as StoredShape
    : {};
}

function safeArray(value: unknown): unknown[] {
  const sanitized = publicWorkflowValue(value);
  return Array.isArray(sanitized) ? sanitized : [];
}

export function publicWorkflowRun(record: StoredShape | null): StoredShape | null {
  if (!record) return null;
  return {
    id: text(record.id),
    goal_id: text(record.goal_id),
    plan_id: text(record.plan_id),
    status: text(record.status),
    current_controller: text(record.current_controller),
    pause_reason: text(record.pause_reason),
    budget_limit: number(record.budget_limit),
    budget_spent: number(record.budget_spent),
    actual_cost: number(record.actual_cost),
    started_at: text(record.started_at),
    completed_at: text(record.completed_at),
    error_code: text(record.error_code),
    error_detail: text(record.error_detail),
  };
}

export function publicWorkflowTask(record: StoredShape): StoredShape {
  return {
    id: text(record.id),
    run_id: text(record.run_id),
    task_key: text(record.task_key),
    title: text(record.title),
    description: text(record.description),
    agent_role: text(record.agent_role),
    kind: text(record.kind),
    status: text(record.status),
    sequence: number(record.sequence),
    priority: text(record.priority),
    requires_approval: record.requires_approval === true,
    depends_on: safeArray(record.depends_on),
    output: safeObject(record.output),
    blocked_reason: text(record.blocked_reason),
    owner_id: text(record.owner_id),
    updated_at: text(record.updated_at),
    started_at: text(record.started_at),
    completed_at: text(record.completed_at),
    attempt: number(record.attempt),
    max_attempts: number(record.max_attempts),
    error_code: text(record.error_code),
    error_detail: text(record.error_detail),
    actual_cost: number(record.actual_cost),
  };
}

export function publicWorkflowEvent(record: StoredShape): StoredShape {
  return {
    id: text(record.id),
    run_id: text(record.run_id),
    task_id: text(record.task_id),
    sequence: number(record.sequence),
    type: text(record.type),
    level: text(record.level),
    summary: text(record.summary),
    payload: safeObject(record.payload),
    occurred_at: text(record.occurred_at),
  };
}

export function publicWorkflowApproval(record: StoredShape): StoredShape {
  const actionParameters = safeObject(record.action_parameters);
  const targetAccount = safeObject(record.target_account);
  const proposedChanges = safeObject(record.proposed_changes);
  const actionSnapshot = safeObject(record.action_snapshot);
  const changes = safeObject(record.changes);
  const diff = publicWorkflowValue(record.diff);
  const hasDiff = Array.isArray(diff)
    ? diff.length > 0
    : Boolean(diff && typeof diff === 'object' && Object.keys(diff as StoredShape).length);
  return {
    id: text(record.id),
    goal_id: text(record.goal_id),
    run_id: text(record.run_id),
    task_id: text(record.task_id),
    status: text(record.status),
    action_summary: text(record.action_summary),
    risk_level: text(record.risk_level),
    evidence: safeArray(record.evidence),
    requested_by_agent: text(record.requested_by_agent),
    owner_id: text(record.owner_id),
    decided_by: text(record.decided_by),
    decision_note: text(record.decision_note),
    action_version: number(record.action_version),
    payload_hash: text(record.payload_hash),
    approved_payload_hash: text(record.approved_payload_hash),
    action_type: text(record.action_type),
    action_payload: safeObject(record.action_payload),
    ...(Object.keys(actionParameters).length ? { action_parameters: actionParameters } : {}),
    ...(text(record.content_version) ? { content_version: text(record.content_version) } : {}),
    ...(record.material_versions !== undefined ? { material_versions: safeArray(record.material_versions) } : {}),
    ...(record.target_accounts !== undefined ? { target_accounts: safeArray(record.target_accounts) } : {}),
    ...(record.target_account_ids !== undefined ? { target_account_ids: safeArray(record.target_account_ids) } : {}),
    ...(Object.keys(targetAccount).length ? { target_account: targetAccount } : {}),
    scheduled_at: text(record.scheduled_at),
    estimated_cost: number(record.estimated_cost),
    ...(typeof record.reversible === 'boolean' ? { reversible: record.reversible } : {}),
    reversibility: text(record.reversibility),
    expires_at: text(record.expires_at),
    next_step: text(record.next_step),
    ...(Object.keys(changes).length ? { changes } : {}),
    ...(Object.keys(proposedChanges).length ? { proposed_changes: proposedChanges } : {}),
    ...(hasDiff ? { diff } : {}),
    ...(Object.keys(actionSnapshot).length ? { action_snapshot: actionSnapshot } : {}),
    created_at: text(record.created_at),
    decided_at: text(record.decided_at),
  };
}

export function publicWorkflowHandoff(record: StoredShape): StoredShape {
  return {
    id: text(record.id),
    run_id: text(record.run_id),
    task_id: text(record.task_id),
    status: text(record.status),
    taken_by: text(record.taken_by),
    snapshot: safeObject(record.snapshot),
    started_at: text(record.started_at),
    returned_at: text(record.returned_at),
  };
}

export function publicWorkflowReview(record: StoredShape | null): StoredShape | null {
  if (!record) return null;
  return {
    id: text(record.id),
    status: text(record.status),
    summary: safeObject(record.summary),
    created_at: text(record.created_at),
  };
}
