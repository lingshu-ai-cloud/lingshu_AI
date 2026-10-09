import { readTenantEnterpriseFacts } from '../routes/enterprise.js';

export type PlatformAdEnterpriseFactVersion = {
  id: string;
  revision: number;
  contentHash: string;
};

type EnterpriseFactsLoader = (tenantId: string) => Promise<{ version: PlatformAdEnterpriseFactVersion }>;

export type PlatformAdProposalFactState =
  | { status: 'not_applicable' }
  | { status: 'current'; proposalVersion: string; currentVersion: PlatformAdEnterpriseFactVersion }
  | { status: 'missing'; currentVersion: PlatformAdEnterpriseFactVersion }
  | { status: 'stale'; proposalVersion: string; currentVersion: PlatformAdEnterpriseFactVersion };

type ProposalCarrier = {
  proposal?: { enterpriseFactVersion?: string } | null;
};

export function samePlatformAdEnterpriseFactVersion(
  left: PlatformAdEnterpriseFactVersion,
  right: PlatformAdEnterpriseFactVersion,
): boolean {
  return left.id === right.id
    && left.revision === right.revision
    && left.contentHash === right.contentHash;
}

export function comparePlatformAdProposalFactVersion(
  task: ProposalCarrier,
  currentVersion: PlatformAdEnterpriseFactVersion,
): PlatformAdProposalFactState {
  if (!task.proposal) return { status: 'not_applicable' };
  const proposalVersion = String(task.proposal.enterpriseFactVersion || '').trim();
  if (!proposalVersion) return { status: 'missing', currentVersion };
  return proposalVersion === currentVersion.id
    ? { status: 'current', proposalVersion, currentVersion }
    : { status: 'stale', proposalVersion, currentVersion };
}

export async function platformAdProposalFactState(
  tenantId: string,
  task: ProposalCarrier,
  loadFacts: EnterpriseFactsLoader = readTenantEnterpriseFacts,
): Promise<PlatformAdProposalFactState> {
  if (!task.proposal) return { status: 'not_applicable' };
  const facts = await loadFacts(tenantId);
  return comparePlatformAdProposalFactVersion(task, facts.version);
}

export function platformAdProposalFactIssue(state: PlatformAdProposalFactState): string {
  if (state.status === 'missing') return 'AI 投放方案缺少企业事实版本，请按最新企业资料重新生成方案';
  if (state.status === 'stale') return '企业资料已更新，请按最新企业事实重新生成投放方案';
  return '';
}
