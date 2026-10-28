import { platformWeeklyCountsFromCadence } from '../../../shared/contracts/weeklyPublishingTargets';
import { managedPublishingGrantErrors } from '../../../shared/contracts/managedPublishingGrant';
import { recommendedContinuationPolicy } from '../../lib/continuationPolicy';
import { contentCreationWorkflows } from '../../lib/digitalEmployeePresentationPolicy';
import type { DigitalEmployeeConfig, PublishingTarget } from '../../lib/digitalEmployees';

export const EMPTY_CONFIG: DigitalEmployeeConfig = {
  smartOperationsEnabled: true,
  companyName: "",
  industry: "",
  primaryBusiness: "",
  targetMarkets: "",
  customerProfile: "",
  operatingMaturity: "starting",
  socialOperatingProfile: "starter_four_platform",
  defaultParticipation: "agent",
  autonomyMode: "managed",
  approvalOwner: "",
  constraints: [
    "禁止未经确认的价格、交期和效果承诺",
    "所有真实对外发布必须人工审批",
  ],
  team: ["orchestrator", "business", "director", "content", "customer"],
  primaryGoal: "leads",
  focusProducts: "",
  enabledWorkflows: [
    "scheduled_social",
    "viral_clone",
    "content_publish",
    "customer_segmentation",
    "batch_followup",
  ],
  socialCadence: "YouTube、TikTok、Instagram、Facebook；公开行业关键词与已确认对标账号；近 7 天；每天 09:00；每次最多 20 条；按链接与标题去重 30 天；每周生成 5 条发布草稿，发布前人工审批",
  continuationPolicy: recommendedContinuationPolicy,
  followupCadence: "每周五 09:00 生成分层跟进草稿；17:00 前审批；仅在客户当地工作日 09:00–18:00 发送；同一客户 7 天最多 1 次",
  reviewSchedule: "周五 17:30（北京时间）；数据截止 17:00；通知审批负责人；仅生成复盘和下周任务草稿",
  publishingTargets: [],
  allowGeneratedVisuals: false,
  allowRealPublishing: false,
  allowRealCustomerMessages: false,
  approvalPolicy: {
    contentPublish: true,
    batchFollowup: true,
    commercialCommitment: true,
  },
  agentApprovalPolicies: {
    business: { activatePlan: true, changeGoalScope: true },
    industry: { addUnverifiedSource: true, expandCollectionScope: true },
    content: { contentPublish: true, factualClaims: true },
    customer: { batchFollowup: true, commercialCommitment: true },
  },
};

export function safeProductionOnboarding(config: DigitalEmployeeConfig, language: string): NonNullable<DigitalEmployeeConfig['productionOnboarding']> {
  return config.productionOnboarding || {
    schemaVersion: 'fixed-yield.production-onboarding.v1',
    contact: { kind: 'none', value: '', primaryCta: '' }, presenterPolicy: 'local_video_only',
    output: { primaryLanguage: language || config.videoDefaults?.language || 'en', aspectRatio: '9:16', resolution: '1080p' },
    includeOneRevision: true, confirmedAt: new Date().toISOString(),
  };
}

export const publishingPlatforms = ["youtube", "tiktok", "instagram", "facebook", "linkedin"] as const;

export function primaryEnterpriseLanguage(value: unknown): string {
  const first = String(value || "").split(/[,，、;/]/).map((item) => item.trim()).find(Boolean);
  return first || "英语";
}

export function platformCountsFromCadence(cadence: string, fallback: number, targets: PublishingTarget[] = []): Record<(typeof publishingPlatforms)[number], number> {
  const perPlatform = Math.max(0, Math.ceil(fallback / publishingPlatforms.length));
  const legacyCounts = platformWeeklyCountsFromCadence(cadence);
  return Object.fromEntries(publishingPlatforms.map((platform) => {
    const platformTargets = targets.filter(target => target.platform === platform);
    const structured = platformTargets.length && platformTargets.every(target => target.weeklyCount !== undefined)
      ? platformTargets.reduce((sum, target) => sum + Math.max(0, Number(target.weeklyCount) || 0), 0)
      : undefined;
    return [platform, structured ?? legacyCounts[platform] ?? perPlatform];
  })) as Record<(typeof publishingPlatforms)[number], number>;
}


export function completeConfig(initial: DigitalEmployeeConfig): DigitalEmployeeConfig {
  return {
    ...EMPTY_CONFIG,
    ...initial,
    approvalOwner: initial.approvalOwner?.trim() || "企业管理员",
    team: ["orchestrator", "business", "director", "content", "customer"],
    enabledWorkflows: initial.enabledWorkflows?.length
      ? initial.enabledWorkflows
      : EMPTY_CONFIG.enabledWorkflows,
    approvalPolicy: {
      ...EMPTY_CONFIG.approvalPolicy,
      ...(initial.approvalPolicy || {}),
    },
    agentApprovalPolicies: {
      business: { ...EMPTY_CONFIG.agentApprovalPolicies.business, ...(initial.agentApprovalPolicies?.business || {}) },
      industry: { ...EMPTY_CONFIG.agentApprovalPolicies.industry, ...(initial.agentApprovalPolicies?.industry || {}) },
      content: { ...EMPTY_CONFIG.agentApprovalPolicies.content, ...(initial.agentApprovalPolicies?.content || {}) },
      customer: { ...EMPTY_CONFIG.agentApprovalPolicies.customer, ...(initial.agentApprovalPolicies?.customer || {}) },
    },
    publishingTargets: initial.publishingTargets || [],
    continuationPolicy: initial.continuationPolicy || recommendedContinuationPolicy,
  };
}

export function configErrors(form: DigitalEmployeeConfig): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const [key, label] of [
    ["companyName", "企业名称"],
    ["industry", "行业"],
    ["targetMarkets", "目标市场"],
    ["customerProfile", "核心客户"],
    ["approvalOwner", "审批负责人"],
  ] as const) {
    if (!String(form[key] || "").trim()) errors[key] = `请填写${label}`;
  }
  if (!form.enabledWorkflows.length)
    errors.enabledWorkflows = "至少启用一条工作流";
  if (
    form.enabledWorkflows.includes("content_publish") &&
    !form.enabledWorkflows.some((item) =>
      contentCreationWorkflows.includes(item),
    )
  )
    errors.enabledWorkflows = "内容发布前请先启用社媒视频制作";
  if (
    form.enabledWorkflows.some((item) =>
      ["scheduled_social", "content_publish"].includes(item),
    ) &&
    !form.socialCadence.trim()
  )
    errors.socialCadence = "请明确内容采集与发布节奏";
  if (
    form.enabledWorkflows.includes("batch_followup") &&
    !form.followupCadence.trim()
  )
    errors.followupCadence = "请明确客户跟进节奏";
  if (
    form.enabledWorkflows.includes("content_publish") &&
    !form.approvalPolicy.contentPublish
  )
    errors.contentPublish = "真实发布必须保留人工审批";
  if (
    form.enabledWorkflows.includes("batch_followup") &&
    !form.approvalPolicy.batchFollowup
  )
    errors.batchFollowup = "整批客户跟进必须保留人工审批";
  const grantErrors = managedPublishingGrantErrors(form.managedPublishingGrant, form);
  if (grantErrors.length) errors.managedPublishingGrant = grantErrors.join('；');
  return errors;
}
