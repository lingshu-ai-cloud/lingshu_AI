import fs from 'node:fs';
import path from 'node:path';

export const RELEASE_PLATFORMS = ['tiktok', 'facebook', 'instagram', 'youtube'] as const;
export type ReleasePlatform = typeof RELEASE_PLATFORMS[number];
export type CheckStatus = 'passed' | 'blocked' | 'failed';

type Lineage = {
  tenantId: string;
  artifactId: string;
  artifactVersion: number;
  contentHash: string;
  approvalId: string;
};

export type FourPlatformReleaseEvidence = {
  schemaVersion: 1;
  environment: 'local' | 'pre_release';
  capturedAt: string;
  evidenceSource: {
    collector: 'live_pre_release_requests' | 'local_contract_fixture';
    pocketBaseRequestId: string;
    rawEvidenceSha256: string;
    chromeSessionRecordIds: Partial<Record<ReleasePlatform, string>>;
  };
  credentials: {
    pocketBaseAuthenticated: boolean;
    applicationSessionAuthenticated: boolean;
    platformSessions: Partial<Record<ReleasePlatform, boolean>>;
    platformApiAuthorized: Partial<Record<ReleasePlatform, boolean>>;
    publishTargetIds: Partial<Record<ReleasePlatform, string>>;
  };
  sourceArtifact: Lineage & { kind: 'digital_human' | 'image' | 'video' | 'text' };
  approval: Lineage & { status: 'approved' | 'revoked' | 'expired'; approvedAt: string };
  receipts: Array<Lineage & {
    platform: ReleasePlatform;
    accountId: string;
    state: 'published' | 'processing' | 'unknown' | 'failed';
    providerReceiptId?: string;
    providerPostId?: string;
    queriedAt?: string;
    resendSuppressed?: boolean;
  }>;
  isolationProbe: {
    foreignTenantId: string;
    readDenied: boolean;
    mutationDenied: boolean;
    leakedRecordIds: string[];
  };
  revocationProbe: {
    approvalRevoked: boolean;
    publishRejected: boolean;
    providerNetworkCalls: number;
  };
};

export type AcceptanceCheck = { key: string; status: CheckStatus; summary: string };
export type FourPlatformReleaseReport = {
  schemaVersion: 1;
  environment: FourPlatformReleaseEvidence['environment'];
  overall: CheckStatus;
  preReleaseEvidenceReady: boolean;
  releaseReady: boolean;
  launchDecision: 'requires_authorized_review';
  generatedAt: string;
  checks: AcceptanceCheck[];
  blockers: string[];
  failures: string[];
  truthfulness: string;
};

function sameLineage(left: Lineage, right: Lineage): boolean {
  return left.tenantId === right.tenantId
    && left.artifactId === right.artifactId
    && left.artifactVersion === right.artifactVersion
    && left.contentHash === right.contentHash
    && left.approvalId === right.approvalId;
}

export function evaluateFourPlatformRelease(evidence: FourPlatformReleaseEvidence): FourPlatformReleaseReport {
  const checks: AcceptanceCheck[] = [];
  const add = (key: string, status: CheckStatus, summary: string) => checks.push({ key, status, summary });
  const platformSessionsReady = RELEASE_PLATFORMS.every(platform => evidence.credentials.platformSessions[platform] === true);
  const liveSourceReady = evidence.environment === 'pre_release'
    && evidence.evidenceSource.collector === 'live_pre_release_requests'
    && Boolean(evidence.evidenceSource.pocketBaseRequestId)
    && /^sha256:[a-f0-9]{64}$/i.test(evidence.evidenceSource.rawEvidenceSha256)
    && RELEASE_PLATFORMS.every(platform => Boolean(evidence.evidenceSource.chromeSessionRecordIds[platform]));
  add('live_evidence_source', liveSourceReady ? 'passed' : 'blocked', liveSourceReady
    ? '证据来自预发布实际请求、PocketBase 请求记录和四个平台 Chrome 现场记录'
    : '缺少实际请求/数据库回执/Chrome 现场记录；手工 JSON 或本地 fixture 只能做一致性检查');
  const credentialReady = evidence.credentials.pocketBaseAuthenticated
    && evidence.credentials.applicationSessionAuthenticated
    && platformSessionsReady
    && RELEASE_PLATFORMS.every(platform => evidence.credentials.platformApiAuthorized[platform] === true)
    && RELEASE_PLATFORMS.every(platform => Boolean(evidence.credentials.publishTargetIds[platform]));
  add('authenticated_evidence', credentialReady ? 'passed' : 'blocked', credentialReady
    ? 'PocketBase、应用会话、四平台 OAuth/API 授权和目标账号绑定均已现场验证'
    : '缺少 PocketBase、应用会话、平台 OAuth/API 授权或目标账号绑定；Chrome 登录态不能替代 API 准入');

  const approvalMatches = evidence.approval.status === 'approved'
    && sameLineage(evidence.sourceArtifact, evidence.approval);
  add('shared_approval_lineage', approvalMatches ? 'passed' : 'failed', approvalMatches
    ? `${evidence.sourceArtifact.kind} 成片沿用统一素材审批链，来源、版本和内容哈希精确匹配`
    : '来源素材与审批记录不匹配，或审批已失效');

  for (const platform of RELEASE_PLATFORMS) {
    const receipts = evidence.receipts.filter(item => item.platform === platform);
    if (receipts.length !== 1) {
      add(`receipt_${platform}`, receipts.length > 1 ? 'failed' : 'blocked', `${platform} 必须且只能有一条当前发布尝试证据`);
      continue;
    }
    const receipt = receipts[0];
    if (!sameLineage(receipt, evidence.approval)) {
      add(`receipt_${platform}`, 'failed', `${platform} 回执未绑定同一租户、素材版本、内容哈希和审批`);
    } else if (receipt.state === 'published' && receipt.providerReceiptId && receipt.providerPostId) {
      add(`receipt_${platform}`, 'passed', `${platform} 已核验 provider receipt id 与 post id`);
    } else if ((receipt.state === 'unknown' || receipt.state === 'processing') && receipt.queriedAt && receipt.resendSuppressed === true) {
      add(`receipt_${platform}`, 'blocked', `${platform} 结果仍未知；已查询恢复且禁止盲目重发，待最终回执`);
    } else if (receipt.state === 'failed') {
      add(`receipt_${platform}`, 'failed', `${platform} 发布尝试失败`);
    } else {
      add(`receipt_${platform}`, 'failed', `${platform} 回执不完整或未知状态没有安全恢复证据`);
    }
  }

  const isolationPassed = evidence.isolationProbe.foreignTenantId !== evidence.sourceArtifact.tenantId
    && evidence.isolationProbe.readDenied
    && evidence.isolationProbe.mutationDenied
    && evidence.isolationProbe.leakedRecordIds.length === 0;
  add('tenant_isolation', isolationPassed ? 'passed' : 'failed', isolationPassed
    ? '跨租户读写均被拒绝且没有记录泄漏'
    : '跨租户读写拒绝证据不完整或出现记录泄漏');

  const revocationPassed = evidence.revocationProbe.approvalRevoked
    && evidence.revocationProbe.publishRejected
    && evidence.revocationProbe.providerNetworkCalls === 0;
  add('permission_revocation', revocationPassed ? 'passed' : 'failed', revocationPassed
    ? '审批/权限吊销后发布被拒绝，且 provider 外呼为 0'
    : '吊销后未失败关闭，或仍发生 provider 外呼');

  if (evidence.environment === 'local') {
    add('real_environment_gate', 'blocked', '本地证据只证明合同，不得作为四平台真实预发布通过结论');
  }

  const failures = checks.filter(item => item.status === 'failed').map(item => `${item.key}: ${item.summary}`);
  const blockers = checks.filter(item => item.status === 'blocked').map(item => `${item.key}: ${item.summary}`);
  const overall: CheckStatus = failures.length ? 'failed' : blockers.length ? 'blocked' : 'passed';
  return {
    schemaVersion: 1,
    environment: evidence.environment,
    overall,
    preReleaseEvidenceReady: evidence.environment === 'pre_release' && overall === 'passed',
    releaseReady: false,
    launchDecision: 'requires_authorized_review',
    generatedAt: new Date().toISOString(),
    checks,
    blockers,
    failures,
    truthfulness: overall === 'passed'
      ? '四平台现场证据一致性检查通过；仍需授权负责人复核原始请求/数据库/Chrome 记录。本报告不授权生产部署或真实发帖。'
      : '证据不完整或检查失败；不得对外宣称四平台发布验收通过。',
  };
}

function main(): void {
  if (process.env.NODE_ENV === 'production') throw new Error('production_environment_not_allowed');
  const evidenceArg = process.argv.find((value, index) => process.argv[index - 1] === '--evidence' && value !== '--evidence');
  if (!evidenceArg) throw new Error('usage: tsx scripts/four-platform-release-acceptance.ts --evidence <json-file>');
  const evidencePath = path.resolve(evidenceArg);
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8')) as FourPlatformReleaseEvidence;
  if (evidence.schemaVersion !== 1) throw new Error('unsupported_evidence_schema');
  const report = evaluateFourPlatformRelease(evidence);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.preReleaseEvidenceReady) process.exitCode = report.overall === 'failed' ? 2 : 3;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main();
