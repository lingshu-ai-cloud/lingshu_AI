import {
  STARTER_198_PROFILE,
  type Starter198Capability,
  type Starter198CapabilityManifest,
  type Starter198Command,
  type Starter198OrgRole,
  type StarterAgentRole,
  type StarterProductionSiteId,
  type StarterRunStatus,
  type StarterTodayItem,
  type StarterWorkspaceAction,
  type StarterWorkspaceV1,
} from '../../shared/contracts/starter198.js';
import { buildStarter198CapabilityManifest, starter198CapabilityAllowed } from './profile.js';
import {
  STARTER_COLLECTIONS,
  starter198Repository,
  type Starter198Repository,
  type StarterRecord,
  starterRecordVersion,
  starterVersionString,
} from './repository.js';
import { aggregateStarterAgentUsage, starterAgentRole } from './usage.js';
import type {
  StarterProductionReadModel,
  StarterProductionSource,
} from './productionReadModel.js';
import {
  listStarter198PendingApprovals,
  listStarter198TasksForRun,
  starter198RunInScope,
} from './workflowScope.js';
import {
  starterDisplayText as displayText,
  starterSafeTimestamp as safeTimestamp,
  starterTaskOutputSummary as outputSummary,
  starterTaskPresentation as taskPresentation,
} from './workspaceProjection.js';

const ROLE_COMMANDS: Record<Starter198OrgRole, ReadonlySet<Starter198Command>> = {
  owner: new Set(['confirm_initial_setup', 'confirm_quote_rule', 'submit_quote_inquiry', 'submit_orchestrator_input', 'resolve_decision', 'pause_run', 'resume_run', 'cancel_run', 'submit_publication_evidence', 'submit_quote_send_evidence']),
  admin: new Set(['confirm_initial_setup', 'confirm_quote_rule', 'submit_quote_inquiry', 'submit_orchestrator_input', 'resolve_decision', 'pause_run', 'resume_run', 'cancel_run', 'submit_publication_evidence', 'submit_quote_send_evidence']),
  operator: new Set(['submit_orchestrator_input', 'pause_run', 'resume_run', 'submit_publication_evidence']),
  customer_service: new Set(['submit_orchestrator_input', 'submit_quote_inquiry', 'submit_quote_send_evidence']),
};

export const COMMAND_CAPABILITY: Record<Starter198Command, Starter198Capability> = {
  confirm_initial_setup: 'orchestrator.command.submit',
  confirm_quote_rule: 'quotation.calculate',
  submit_quote_inquiry: 'quotation.calculate',
  submit_orchestrator_input: 'orchestrator.command.submit',
  resolve_decision: 'orchestrator.decision.resolve',
  pause_run: 'workflow.run.pause',
  resume_run: 'workflow.run.resume',
  cancel_run: 'workflow.run.cancel',
  generate_publication_package: 'publishing.package.generate',
  submit_publication_evidence: 'publishing.evidence.submit',
  submit_quote_send_evidence: 'quotation.calculate',
};

export function starterCommandAllowed(
  manifest: Starter198CapabilityManifest,
  role: Starter198OrgRole,
  command: Starter198Command,
): boolean {
  return ROLE_COMMANDS[role].has(command) && starter198CapabilityAllowed(manifest, COMMAND_CAPABILITY[command]);
}

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const emptyRecords = (perPage = 500) => Promise.resolve({ items: [] as StarterRecord[], totalItems: 0, totalPages: 0, page: 1, perPage });

function object(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

function unavailableRegisteredHandler(task: StarterRecord): boolean {
  const output = object(task.output);
  return text(task.status) === 'waiting_external'
    && output?.schemaVersion === 'starter-198.registered-handler-wait.v1'
    && output.implementationAvailable === false;
}

function runStatus(value: unknown, currentController?: unknown): StarterRunStatus {
  if (value === 'running' || value === 'paused' || value === 'blocked') return value;
  if (value === 'waiting_approval') return 'waiting_user';
  if (value === 'waiting_external') {
    if (currentController === 'human') return 'waiting_user';
    if (currentController === 'system') return 'blocked';
    return 'running';
  }
  if (value === 'waiting_human') return currentController === 'agent' ? 'running' : 'waiting_user';
  if (value === 'succeeded' || value === 'completed' || value === 'cancelled') return 'completed';
  if (value === 'failed' || value === 'error') return 'error';
  if (value === 'pending' || value === 'initializing' || value === 'queued' || value === 'draft') return 'idle';
  return 'unknown';
}

function taskSite(task: StarterRecord): StarterProductionSiteId {
  const key = text(task.task_key);
  const role = starterAgentRole(task.agent_role ?? task.background_capability, task);
  if (role === 'traffic') return 'traffic';
  if (role === 'sales') return 'sales';
  if (role === 'content' && /(trend|source|viral|inspiration|industry|research)/i.test(key)) return 'inspiration';
  if (role === 'content') return 'content';
  return 'content';
}

function taskItem(task: StarterRecord): StarterTodayItem {
  const role = starterAgentRole(task.agent_role ?? task.background_capability, task) ?? 'orchestrator';
  const presentation = taskPresentation(task);
  const status = unavailableRegisteredHandler(task) ? 'blocked' : text(task.status) || 'unknown';
  return {
    id: task.id,
    what: presentation.title,
    ownerAgent: role,
    why: presentation.why,
    status,
    output: outputSummary(task),
    next: status === 'blocked' || status === 'failed'
      ? '等待交付团队接通或核对该标准节点'
      : status.startsWith('waiting_') ? '等待当前节点所需的确认或证据' : null,
    evidence: null,
    updatedAt: safeTimestamp(task.updated_at) || safeTimestamp(task.updated),
    actions: [],
  };
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()));
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : [];
  } catch { return []; }
}

function missingFactLabel(code: string): string {
  const known: Record<string, string> = {
    digital_employee_configuration: '数字员工基础配置',
    'configuration:not_active': '启用数字员工配置',
    'configuration:not_confirmed': '确认首次开工资料',
    'configuration:version': '配置版本',
    'policy:version': '执行边界版本',
    'facts:version': '企业事实版本',
    'facts:confirmed_snapshot': '已确认的企业事实快照',
    'facts:snapshot_version_mismatch': '一致的企业事实版本',
    'enterprise.company.name_missing': '企业名称',
    'enterprise.company.industry_missing': '所属行业',
    'enterprise.target_markets_missing': '目标市场',
    'enterprise.customer_profile_missing': '核心客户',
    'enterprise.focus_products_missing': '本轮重点产品',
  };
  if (known[code]) return known[code];
  return '必要经营资料';
}

function orchestratorInboxItems(records: StarterRecord[], runId: string | undefined, setupAllowed: boolean): {
  inProgress: StarterTodayItem[];
  nextSteps: StarterTodayItem[];
} {
  const relevant = runId
    ? records.filter(record => text(record.run_id) === runId && ['processing', 'pending', 'failed'].includes(text(record.status)))
    : records.filter(record => ['waiting_user', 'processing', 'failed'].includes(text(record.status))).slice(0, 1);
  const inProgress: StarterTodayItem[] = [];
  const nextSteps: StarterTodayItem[] = [];
  for (const record of relevant.slice(0, 20)) {
    const disposition = text(record.disposition);
    const state = text(record.status);
    const updatedAt = safeTimestamp(record.updated_at) || safeTimestamp(record.created_at);
    if (disposition === 'awaiting_initial_confirmation') {
      const missing = stringArray(record.missing_facts).map(missingFactLabel);
      nextSteps.push({
        id: `orchestrator-inbox:${record.id}`,
        what: '完成首次开工资料确认',
        ownerAgent: 'orchestrator',
        why: '灵小枢已保存目标；事实未确认前不会生成或执行工作流。',
        status: 'waiting_user',
        output: null,
        next: missing.length ? `还需补充：${missing.join('、')}` : '请补齐开工卡中的必要资料',
        evidence: '首次开工资料待确认',
        updatedAt,
        actions: setupAllowed ? [action({
          id: `initial-setup:${record.id}`,
          label: '补齐并确认开工资料',
          command: 'confirm_initial_setup',
          kind: 'primary',
        })] : [],
      });
      continue;
    }
    if (state === 'failed') {
      nextSteps.push({
        id: `orchestrator-inbox:${record.id}`,
        what: '灵小枢输入未能安全入队',
        ownerAgent: 'orchestrator',
        why: '持久化或一致性检查失败，系统没有声称已执行。',
        status: 'failed',
        output: null,
        next: '请由交付团队检查后重试',
        evidence: '输入已保存，执行结果未确认',
        updatedAt,
        actions: [],
      });
      continue;
    }
    const attached = disposition === 'attached_to_run';
    inProgress.push({
      id: `orchestrator-inbox:${record.id}`,
      what: attached ? '灵小枢已收到本轮补充／纠错' : '198 标准工作流等待领取',
      ownerAgent: 'orchestrator',
      why: attached ? '输入已绑定当前 Run 的持久化收件箱。' : '目标和标准工作图已固化，但专用执行器尚未确认领取。',
      status: attached ? 'pending' : (state || 'pending'),
      output: attached ? '尚未处理，不代表下游已重跑' : '尚未执行',
      next: attached ? '等待灵小枢消费者处理并产生新版本' : '等待 starter_198 专用执行器领取',
      evidence: '输入已持久化',
      updatedAt,
      actions: [],
    });
  }
  return { inProgress, nextSteps };
}

function action(input: {
  id: string;
  label: string;
  command: Starter198Command;
  kind?: StarterWorkspaceAction['kind'];
  targetId?: string;
  expectedVersion?: string;
  disabledReason?: string;
}): StarterWorkspaceAction {
  return {
    id: input.id,
    label: input.label,
    command: input.command,
    kind: input.kind ?? 'secondary',
    href: null,
    disabledReason: input.disabledReason ?? null,
    expectedVersion: input.expectedVersion ?? null,
  };
}

function quoteSelfServiceNextStep(input: {
  rules: StarterRecord[];
  manifest: Starter198CapabilityManifest;
  role: Starter198OrgRole;
  available: boolean;
}): StarterTodayItem {
  const latest = input.rules[0] ?? null;
  const command: Starter198Command = latest ? 'submit_quote_inquiry' : 'confirm_quote_rule';
  const capabilityAllowed = starter198CapabilityAllowed(input.manifest, COMMAND_CAPABILITY[command]);
  const roleAllowed = ROLE_COMMANDS[input.role].has(command);
  const allowed = capabilityAllowed && roleAllowed;
  const version = latest ? starterVersionString(latest.version) : '';
  const sku = latest ? displayText(latest.product_id, 120) : '';
  return {
    id: latest ? 'quote-self-service:inquiry' : 'quote-self-service:rule',
    what: latest ? '录入询盘并生成智能报价' : '首次确认智能报价规则',
    ownerAgent: 'sales',
    why: latest
      ? '灵小售只按已确认规则确定性计算；AI 不决定价格，也不会自动发送给客户。'
      : '先锁定一个主推产品的价格、成本、MOQ、贸易条款与交期，之后询盘才能自助报价。',
    status: latest ? 'ready' : 'waiting_user',
    output: latest ? `当前规则：${sku || '主推产品'} · ${version || '已确认版本'}` : null,
    next: !capabilityAllowed
      ? '当前能力清单或本周期额度未开放智能报价'
      : roleAllowed
        ? latest ? '只录入数量、目的国和外部询盘引用' : '由负责人一次性确认商业规则'
        : latest ? '可查看报价；录入询盘需客服、管理员或负责人权限' : '需要管理员或负责人确认规则',
    evidence: latest && text(latest.rule_hash) ? '商业规则摘要已锁定' : null,
    updatedAt: latest ? text(latest.created_at) || null : null,
    actions: allowed ? [action({
      id: latest ? 'quote-inquiry:new' : 'quote-rule:confirm',
      label: latest ? '录入询盘并报价' : '确认报价规则',
      command,
      kind: 'primary',
      ...(!input.available ? { disabledReason: 'starter_198_quote_self_service_unavailable' } : {}),
    })] : [],
  };
}

function downloadAction(packageId: string): StarterWorkspaceAction {
  return {
    id: `download:${packageId}`,
    label: '下载发布包',
    command: null,
    kind: 'download',
    href: `/api/overseas/starter-198/publication-packages/${encodeURIComponent(packageId)}/download`,
    disabledReason: null,
    expectedVersion: null,
  };
}

function quoteDownloadAction(artifactId: string): StarterWorkspaceAction {
  return {
    id: `download:${artifactId}`,
    label: '下载报价文件',
    command: null,
    kind: 'download',
    href: `/api/overseas/starter-198/quote-artifacts/${encodeURIComponent(artifactId)}/download`,
    disabledReason: null,
    expectedVersion: null,
  };
}

function controls(
  manifest: Starter198CapabilityManifest,
  role: Starter198OrgRole,
  run: StarterRecord | null,
  orchestratorAvailable: boolean,
): StarterWorkspaceAction[] {
  const result: StarterWorkspaceAction[] = [];
  if (starterCommandAllowed(manifest, role, 'submit_orchestrator_input')) {
    result.push(action({
      id: 'ask-orchestrator',
      label: '告诉灵小枢你的目标',
      command: 'submit_orchestrator_input',
      kind: 'primary',
      ...(!orchestratorAvailable ? { disabledReason: 'starter_198_orchestrator_worker_unavailable' } : {}),
    }));
  }
  if (!run) return result;
  const status = text(run.status);
  if (['running', 'waiting_external', 'waiting_approval'].includes(status)
    && starterCommandAllowed(manifest, role, 'pause_run')) {
    result.push(action({ id: `pause:${run.id}`, label: '暂停本轮', command: 'pause_run', targetId: run.id, expectedVersion: starterRecordVersion(run) }));
  }
  if (status === 'paused' && starterCommandAllowed(manifest, role, 'resume_run')) {
    result.push(action({ id: `resume:${run.id}`, label: '恢复本轮', command: 'resume_run', targetId: run.id, expectedVersion: starterRecordVersion(run) }));
  }
  if (!['succeeded', 'failed', 'cancelled'].includes(status)
    && starterCommandAllowed(manifest, role, 'cancel_run')) {
    result.push(action({ id: `cancel:${run.id}`, label: '取消本轮', command: 'cancel_run', kind: 'danger', targetId: run.id, expectedVersion: starterRecordVersion(run) }));
  }
  return result;
}

function decisionActions(
  approval: StarterRecord,
  manifest: Starter198CapabilityManifest,
  role: Starter198OrgRole,
  decisionAvailable: boolean,
): StarterWorkspaceAction[] {
  if (!decisionAvailable || !starterCommandAllowed(manifest, role, 'resolve_decision')) return [];
  return [action({
    id: `resolve:${approval.id}`,
    label: '处理决策',
    command: 'resolve_decision',
    kind: 'primary',
    targetId: approval.id,
    expectedVersion: starterVersionString(approval.subject_version) || undefined,
  })];
}

function quoteDecisionActions(
  quote: StarterRecord,
  manifest: Starter198CapabilityManifest,
  role: Starter198OrgRole,
  quoteDecisionAvailable: boolean,
): StarterWorkspaceAction[] {
  if (!quoteDecisionAvailable || text(quote.status) !== 'draft_ready'
    || !starterCommandAllowed(manifest, role, 'resolve_decision')) return [];
  const inputHash = starterVersionString(quote.input_hash);
  if (!inputHash) return [];
  return [action({
    id: `resolve:quote:${quote.id}`,
    label: '审核报价',
    command: 'resolve_decision',
    kind: 'primary',
    targetId: `quote:${quote.id}`,
    expectedVersion: inputHash,
  })];
}

function publicationArtifact(record: StarterRecord, canSubmit: boolean): StarterWorkspaceV1['results']['artifacts'][number] | null {
  const manifest = object(record.manifest);
  const packageId = text(record.package_id);
  if (!manifest || !packageId || text(record.tenant_id) !== text(manifest.tenantId) || packageId !== text(manifest.packageId)) return null;
  const status = text(record.status);
  const platform = ['facebook', 'instagram', 'tiktok', 'youtube'].includes(text(manifest.platform).toLowerCase())
    ? text(manifest.platform).toLowerCase()
    : '平台';
  return {
    id: packageId,
    title: `${platform} 发布包`,
    kind: 'publication_package',
    status,
    agentRole: 'traffic',
    createdAt: safeTimestamp(record.created_at),
    evidence: status === 'published' ? '已通过发布证据验真' : null,
    actions: [
      downloadAction(packageId),
      ...(canSubmit && ['awaiting_user_publish', 'evidence_rejected'].includes(status)
        ? [action({ id: `evidence:${packageId}`, label: '提交发布证据', command: 'submit_publication_evidence', targetId: packageId, kind: 'primary' })]
        : []),
    ],
  };
}

function quoteSummary(record: StarterRecord): string | null {
  const calculation = object(record.calculation);
  const total = object(calculation?.total);
  const currency = text(total?.currency);
  const decimal = text(total?.decimal);
  return currency && decimal ? `${currency} ${decimal}` : null;
}

function quoteArtifact(
  quote: StarterRecord,
  artifact: StarterRecord | null,
  sendEvidence: StarterRecord | null,
  canSubmitEvidence: boolean,
): StarterWorkspaceV1['results']['artifacts'][number] {
  const inputHash = starterVersionString(quote.input_hash);
  const status = text(quote.status) || 'unknown';
  const artifactId = text(artifact?.artifact_id);
  const artifactReady = Boolean(artifactId);
  const evidencePending = text(sendEvidence?.status) === 'submitted_unverified';
  const approved = status === 'approved' && quote.approval_valid === true
    && Boolean(text(quote.approval_evidence_id)) && Boolean(inputHash);
  return {
    id: artifactReady ? artifactId : `quote:${quote.id}`,
    title: `询盘 ${text(quote.inquiry_id) || quote.id} 报价`,
    kind: artifactReady ? 'quote_artifact' : 'quote_draft',
    status: evidencePending ? 'send_evidence_pending_verification'
      : approved && !artifactReady ? 'artifact_pending'
        : status,
    agentRole: 'sales',
    createdAt: text(artifact?.created_at) || text(quote.updated_at) || text(quote.created_at) || null,
    evidence: evidencePending
      ? '人工发送记录已提交，等待验真'
      : approved && artifactReady
        ? '计价、审批与报价文件摘要已锁定'
        : approved
          ? '计价与审批已锁定，报价文件生成中'
          : null,
    actions: [
      ...(artifactReady ? [quoteDownloadAction(artifactId)] : []),
      ...(canSubmitEvidence && approved && artifactReady && !evidencePending
        ? [action({
        id: `quote-evidence:${quote.id}`,
        label: '登记人工发送证据',
        command: 'submit_quote_send_evidence',
        targetId: `quote:${quote.id}`,
        expectedVersion: inputHash,
        kind: 'primary',
        })]
        : []),
    ],
  };
}

function quoteArtifactBinding(quote: StarterRecord, artifacts: StarterRecord[]): StarterRecord | null {
  const matches = artifacts.filter(record => text(record.draft_id) === quote.id
    && text(record.status) === 'ready'
    && text(record.input_hash) === starterVersionString(quote.input_hash)
    && text(record.calculation_hash) === text(quote.calculation_hash)
    && text(record.approval_evidence_id) === text(quote.approval_evidence_id)
    && /^quote_artifact_[a-f0-9]{24}$/.test(text(record.artifact_id))
    && /^[a-f0-9]{64}$/.test(text(record.sha256)));
  if (matches.length > 1) throw new Error('starter_198_workspace_projection_incomplete');
  return matches[0] ?? null;
}

function quoteEvidenceBinding(
  quote: StarterRecord,
  artifact: StarterRecord | null,
  evidence: StarterRecord[],
): StarterRecord | null {
  if (!artifact) return null;
  const matches = evidence.filter(record => text(record.draft_id) === quote.id
    && text(record.artifact_hash) === text(artifact.sha256)
    && text(record.status) === 'submitted_unverified');
  if (matches.length > 1) throw new Error('starter_198_workspace_projection_incomplete');
  return matches[0] ?? null;
}

const UNAVAILABLE_PRODUCTION_MODEL: StarterProductionReadModel = {
  inspiration: { available: false, truncated: false, items: [] },
  content: { available: false, truncated: false, items: [] },
  sales: { available: false, truncated: false, items: [] },
};

function sourceSection(id: string, label: string, source: StarterProductionSource) {
  return {
    id,
    label: source.truncated ? `${label}（最近 100 条）` : label,
    status: !source.available ? 'unavailable' : source.truncated ? 'partial' : source.items.length ? 'available' : 'empty',
    count: source.available ? source.items.length : null,
    items: source.items,
  };
}

function publicationSection(packages: StarterRecord[]) {
  const items = packages.flatMap(record => {
    const manifest = object(record.manifest);
    if (!manifest || text(manifest.tenantId) !== text(record.tenant_id)
      || text(manifest.packageId) !== text(record.package_id)) return [];
    return [{
      id: text(record.package_id),
      title: `${['facebook', 'instagram', 'tiktok', 'youtube'].includes(text(manifest.platform).toLowerCase()) ? text(manifest.platform).toLowerCase() : '平台'} 发布包`,
      summary: '已绑定冻结内容版本与文件摘要',
      status: text(record.status) || 'unknown',
      updatedAt: safeTimestamp(record.updated_at) || safeTimestamp(record.created_at),
      evidence: text(manifest.packageHash) ? '内容版本与发布包摘要已锁定' : null,
    }];
  });
  return {
    id: 'traffic:packages',
    label: '最近发布包（最多 100 条）',
    status: items.length ? 'available' : 'empty',
    count: items.length,
    items,
  };
}

function productionSites(
  tasks: StarterRecord[],
  quotes: StarterRecord[],
  packages: StarterRecord[],
  quoteArtifactRows: StarterRecord[],
  quoteEvidenceRows: StarterRecord[],
  status: StarterRunStatus,
  production: StarterProductionReadModel,
): StarterWorkspaceV1['productionSites'] {
  const definitions: Array<{ id: StarterProductionSiteId; title: string; role: StarterAgentRole; summary: string }> = [
    { id: 'inspiration', title: '灵感大屏', role: 'content', summary: '趋势、对标、选题与依据，只读查看' },
    { id: 'content', title: '内容制作', role: 'content', summary: '脚本、素材、版本、质检与成品，只读查看' },
    { id: 'traffic', title: '投流／发布', role: 'traffic', summary: '发布包、状态、回执与表现，只读查看' },
    { id: 'sales', title: '销售／客户', role: 'sales', summary: '询盘、缺项、计价、报价与跟进，只读查看' },
  ];
  return definitions.map(definition => {
    const items = tasks.filter(task => taskSite(task) === definition.id);
    const source = definition.id === 'inspiration'
      ? production.inspiration
      : definition.id === 'content'
        ? production.content
        : definition.id === 'sales'
          ? production.sales
          : null;
    const extraSections = definition.id === 'traffic'
      ? [publicationSection(packages)]
      : definition.id === 'sales'
        ? [{
          id: 'sales:quotes',
          label: '最近报价草稿（最多 100 条）',
          status: quotes.length ? 'available' : 'empty',
          count: quotes.length,
          items: quotes.map(quote => {
            const artifact = quoteArtifactBinding(quote, quoteArtifactRows);
            const evidence = quoteEvidenceBinding(quote, artifact, quoteEvidenceRows);
            return {
              id: quote.id,
              title: `询盘 ${text(quote.inquiry_id) || quote.id}`,
              summary: quoteSummary(quote),
              status: evidence ? 'send_evidence_pending_verification'
                : text(quote.status) === 'approved' && !artifact ? 'artifact_pending'
                  : text(quote.status) || 'unknown',
              updatedAt: text(evidence?.recorded_at) || text(artifact?.created_at)
                || text(quote.updated_at) || text(quote.created_at) || null,
              evidence: evidence ? '人工发送记录待验真'
                : artifact ? '报价文件摘要已锁定'
                  : text(quote.status) === 'approved' ? '报价文件生成中' : null,
            };
          }),
        }]
        : [];
    const sourceSections = source
      ? [sourceSection(
        `${definition.id}:business-records`,
        definition.id === 'inspiration' ? '真实趋势与选题依据' : definition.id === 'content' ? '真实内容项目' : '真实客户与询盘',
        source,
      )]
      : [];
    const timestamps = [
      ...items.map(item => text(item.updated_at) || text(item.updated)),
      ...(source?.items.map(item => item.updatedAt || '') ?? []),
      ...(definition.id === 'traffic' ? packages.map(item => text(item.updated_at) || text(item.created_at)) : []),
      ...(definition.id === 'sales' ? quotes.map(item => text(item.updated_at) || text(item.created_at)) : []),
    ].filter(Boolean).sort();
    return {
      id: definition.id,
      title: definition.title,
      agentRole: definition.role,
      summary: definition.summary,
      status: items.length ? runStatus(items.find(item => text(item.status) === 'running')?.status ?? status) : 'idle',
      updatedAt: timestamps.at(-1) ?? null,
      sections: [{
        id: `${definition.id}:tasks`,
        label: '本轮任务',
        status: items.length ? 'available' : 'empty',
        count: items.length,
        items: items.map(item => ({
          id: item.id,
          title: taskPresentation(item).title,
          summary: outputSummary(item) || taskPresentation(item).why,
          status: text(item.status) || 'unknown',
          updatedAt: safeTimestamp(item.updated_at) || safeTimestamp(item.updated),
          evidence: null,
        })),
      }, ...sourceSections, ...extraSections],
    };
  });
}

export async function buildStarter198Workspace(input: {
  tenantId: string;
  role: Starter198OrgRole;
  repository?: Starter198Repository;
  now?: Date;
  orchestratorAvailable?: boolean;
  decisionAvailable?: boolean;
  quoteDecisionAvailable?: boolean;
  quoteEvidenceAvailable?: boolean;
  quoteSelfServiceAvailable?: boolean;
  setupAvailable?: boolean;
  productionReadModel?: StarterProductionReadModel;
  loadProductionReadModel?: (tenantId: string) => Promise<StarterProductionReadModel>;
}): Promise<StarterWorkspaceV1> {
  const repository = input.repository ?? starter198Repository;
  const now = input.now ?? new Date();
  const access = await repository.access(input.tenantId);
  const manifest = buildStarter198CapabilityManifest(access, now);
  if (!starter198CapabilityAllowed(manifest, 'workspace.read')) {
    throw new Error('starter_198_workspace_not_entitled');
  }
  const productionReadAllowed = starter198CapabilityAllowed(manifest, 'production_site.read');
  const productionReadModel = productionReadAllowed
    ? input.productionReadModel ?? await input.loadProductionReadModel?.(input.tenantId) ?? UNAVAILABLE_PRODUCTION_MODEL
    : UNAVAILABLE_PRODUCTION_MODEL;
  const runResult = await repository.list(STARTER_COLLECTIONS.runs, input.tenantId, {
    where: { product_profile: STARTER_198_PROFILE }, sort: '-started_at', perPage: 1,
  });
  const run = runResult.items[0] ?? null;
  if (run && !starter198RunInScope(run, input.tenantId)) {
    throw new Error('starter_198_workspace_projection_incomplete');
  }
  const runId = run?.id;
  const tasks = runId ? await listStarter198TasksForRun(repository, input.tenantId, runId) : [];
  const approvals = run ? await listStarter198PendingApprovals({
    repository, tenantId: input.tenantId, run, tasks,
  }) : [];
  const [usageResult, packageResult, quoteResult, quoteArtifactResult, quoteEvidenceResult, quoteRuleResult, inboxResult] = await Promise.all([
    runId ? repository.list(STARTER_COLLECTIONS.usage, input.tenantId, { where: { run_id: runId }, sort: 'occurred_at', perPage: 500 }) : emptyRecords(),
    productionReadAllowed ? repository.list(STARTER_COLLECTIONS.publicationPackages, input.tenantId, { sort: '-created_at', perPage: 100 }) : emptyRecords(100),
    repository.list(STARTER_COLLECTIONS.quoteDrafts, input.tenantId, { sort: '-updated_at', perPage: 100 }),
    productionReadAllowed ? repository.list(STARTER_COLLECTIONS.quoteArtifacts, input.tenantId, { sort: '-created_at', perPage: 500 }) : emptyRecords(),
    productionReadAllowed ? repository.list(STARTER_COLLECTIONS.quoteSendEvidence, input.tenantId, { sort: '-recorded_at', perPage: 500 }) : emptyRecords(),
    repository.list(STARTER_COLLECTIONS.quoteRuleSets, input.tenantId, { sort: '-created_at', perPage: 500 }),
    repository.list(STARTER_COLLECTIONS.orchestratorInbox, input.tenantId, { sort: '-created_at', perPage: 20 }),
  ]);
  if ([usageResult, quoteArtifactResult, quoteEvidenceResult, quoteRuleResult]
    .some(result => result.totalItems > result.items.length)) {
    throw new Error('starter_198_workspace_projection_incomplete');
  }
  const status = run
    ? runStatus(run.status, tasks.some(unavailableRegisteredHandler) ? 'system' : run.current_controller)
    : 'idle';
  const completed = tasks.filter(task => ['succeeded', 'skipped'].includes(text(task.status))).map(taskItem);
  const inProgress = tasks.filter(task => ['running', 'waiting_external', 'waiting_approval', 'handed_off'].includes(text(task.status))).map(taskItem);
  const nextSteps = tasks.filter(task => text(task.status) === 'pending').map(taskItem);
  const inboxItems = orchestratorInboxItems(
    inboxResult.items,
    runId,
    input.setupAvailable === true && starterCommandAllowed(manifest, input.role, 'confirm_initial_setup'),
  );
  const canSubmitEvidence = starterCommandAllowed(manifest, input.role, 'submit_publication_evidence');
  const publicationArtifacts = packageResult.items.map(item => publicationArtifact(item, canSubmitEvidence))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const taskArtifacts = tasks.filter(task => text(task.status) === 'succeeded' && outputSummary(task)).map(task => ({
    id: `task:${task.id}`,
    title: taskPresentation(task).title,
    kind: 'task_output',
    status: 'succeeded',
    agentRole: starterAgentRole(task.agent_role ?? task.background_capability, task) ?? 'orchestrator',
    createdAt: safeTimestamp(task.updated_at) || safeTimestamp(task.updated),
    evidence: null,
    actions: [],
  }));
  const canSubmitQuoteEvidence = input.quoteEvidenceAvailable === true
    && starterCommandAllowed(manifest, input.role, 'submit_quote_send_evidence');
  const quoteArtifacts: StarterWorkspaceV1['results']['artifacts'] = quoteResult.items
    .map(quote => {
      const artifact = quoteArtifactBinding(quote, quoteArtifactResult.items);
      return quoteArtifact(
        quote,
        artifact,
        quoteEvidenceBinding(quote, artifact, quoteEvidenceResult.items),
        canSubmitQuoteEvidence,
      );
    });
  const quoteDecisions: StarterWorkspaceV1['decisions'] = quoteResult.items
    .filter(quote => text(quote.status) === 'draft_ready')
    .map(quote => ({
      id: `quote:${quote.id}`,
      type: 'quotation',
      title: `报价 ${text(quote.inquiry_id) || quote.id} 待处理`,
      summary: quoteSummary(quote) || '报价草稿需要人工复核',
      riskLevel: 'L2' as const,
      dueAt: null,
      recommendedOption: null,
      difference: null,
      effect: '不会自动发送给客户',
      evidence: text(quote.calculation_hash) ? '规则版本、询盘输入与计算结果已锁定' : null,
      subjectVersion: starterVersionString(quote.input_hash) || null,
      actions: quoteDecisionActions(
        quote,
        manifest,
        input.role,
        input.quoteDecisionAvailable === true,
      ),
    }));
  return {
    productProfile: STARTER_198_PROFILE,
    generatedAt: now.toISOString(),
    greeting: null,
    capabilityManifest: manifest,
    run: {
      id: run?.id ?? null,
      status,
      cycleLabel: displayText(run?.cycle_label, 80) || null,
      nextCheckpointAt: safeTimestamp(run?.next_checkpoint_at),
    },
    today: {
      completed,
      resultChanges: [],
      inProgress: [...inboxItems.inProgress, ...inProgress],
      nextSteps: [
        ...inboxItems.nextSteps,
        quoteSelfServiceNextStep({
          rules: quoteRuleResult.items,
          manifest,
          role: input.role,
          available: input.quoteSelfServiceAvailable === true,
        }),
        ...nextSteps,
      ],
    },
    decisions: [...approvals.map(approval => ({
      id: approval.id,
      type: 'content_release_approval',
      title: '确认内容发布版本',
      summary: '请核对冻结内容版本；批准后只生成发布包，不会调用平台发布接口。',
      riskLevel: (['L0', 'L1', 'L2', 'L3'].includes(text(approval.risk_level))
        ? text(approval.risk_level) as 'L0' | 'L1' | 'L2' | 'L3'
        : 'unknown') as 'L0' | 'L1' | 'L2' | 'L3' | 'unknown',
      dueAt: safeTimestamp(approval.due_at),
      recommendedOption: null,
      difference: null,
      effect: '批准后仅生成发布包；对外发布仍由用户完成',
      evidence: null,
      subjectVersion: starterVersionString(approval.subject_version) || null,
      actions: decisionActions(approval, manifest, input.role, input.decisionAvailable === true),
    })), ...quoteDecisions],
    results: {
      stages: [
        { id: 'tasks', label: '任务完成', value: completed.length, availability: 'available', source: 'workflow_tasks', note: null },
        { id: 'decisions', label: '待决策', value: approvals.length + quoteDecisions.length, availability: 'available', source: 'approval_requests + quote_drafts', note: null },
        { id: 'publication-packages', label: '最近发布包', value: productionReadAllowed ? publicationArtifacts.length : 0, availability: productionReadAllowed ? 'available' : 'unavailable', source: 'starter_publication_packages', note: packageResult.totalItems > packageResult.items.length ? '仅展示最近 100 条' : null },
      ],
      artifacts: productionReadAllowed ? [...publicationArtifacts, ...quoteArtifacts, ...taskArtifacts] : [],
    },
    agents: aggregateStarterAgentUsage({
      tenantId: input.tenantId,
      runStatus: status,
      resourceLimits: access.resourceLimits,
      ledgerRecords: usageResult.items,
      tasks,
    }),
    productionSites: productionSites(
      productionReadAllowed ? tasks : [],
      productionReadAllowed ? quoteResult.items : [],
      productionReadAllowed ? packageResult.items : [],
      productionReadAllowed ? quoteArtifactResult.items : [],
      productionReadAllowed ? quoteEvidenceResult.items : [],
      status,
      productionReadModel,
    ),
    controls: controls(manifest, input.role, run, input.orchestratorAvailable === true),
  };
}
