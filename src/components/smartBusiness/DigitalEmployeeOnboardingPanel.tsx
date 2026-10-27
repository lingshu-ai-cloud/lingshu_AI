import { allocateWeeklyPublishingTargets, MAX_WEEKLY_PUBLISHING_ITEMS, weeklyPublishingPlatforms } from '../../../shared/contracts/weeklyPublishingTargets';
import { getScrollBehavior } from '../../lib/usePrefersReducedMotion';
import { Button } from 'antd';
import KnowledgeIntakePanel from '../enterprise/KnowledgeIntakePanel';
import { agentRuleFields } from '../../lib/agentRuleFields';
import { Field, inputClass } from './DigitalEmployeeFormField';
import { completeConfig, configErrors, platformCountsFromCadence, primaryEnterpriseLanguage, publishingPlatforms } from './digitalEmployeeConfigRules';
import { importOnboardingProducts } from './onboardingProductImport';
import { OnboardingConfirmationStep, OnboardingEnterpriseStep, OnboardingMarketStep, OnboardingProductsStep, PresenterSetupDialog } from './DigitalEmployeeOnboardingSteps';
import { contentPlatformLabel } from './WeeklyGoalPanel';
import { socialContentStageProfile, type SocialContentStageId } from '../../lib/socialContentStage';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BarChart3, Check, ExternalLink, Loader2, MessageSquare, Search, Settings2, Sparkles, X } from 'lucide-react';
import { authHeader } from '../../lib/auth';
import { socialDiscoveryApi } from '../../lib/socialDiscoveryApi';
import type { SocialCrawlStrategy } from '../../../shared/contracts/socialContentWorkflow';
import type { ProductionPresenterPolicy } from '../../../shared/contracts/productionOnboarding';
import { digitalEmployeeApi, type BusinessDestination, type BusinessReadinessItem, type DigitalEmployeeConfig, type DigitalEmployeeWorkflow, type PublishingTarget } from '../../lib/digitalEmployees';
import { agentRoleGroups, contentCreationWorkflows, synchronizeThemeContentWorkflows, workflowLabel } from '../../lib/digitalEmployeePresentationPolicy';
import {
  ENTERPRISE_ONBOARDING_SCHEMA_VERSION,
  normalizeEnterpriseOnboardingProduct,
  onboardingBrandTone,
  onboardingCompanyIntro,
  validateEnterpriseOnboardingConfirmation,
  type EnterpriseOnboardingDraft,
  type EnterpriseOnboardingEvidenceRef,
  type EnterpriseOnboardingFieldKey,
  type EnterpriseOnboardingProduct,
  type EnterpriseOnboardingProposalSet,
  type EnterpriseOnboardingSource,
  type EnterpriseOnboardingStep,
} from '../../../shared/contracts/enterpriseOnboarding';
import { EnterpriseOnboardingDraftError, generateEnterpriseOnboardingProposals, readEnterpriseOnboardingDraft, saveEnterpriseOnboardingDraft } from '../../lib/enterpriseOnboardingApi';

function newOnboardingConfirmationId(): string {
  return `onboarding:${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}
export function OnboardingPanel({
  initial,
  readiness,
  busy,
  mode = "first",
  activeRun = false,
  restartFromBeginning = false,
  initialStep = "start",
  dismissible = false,
  onClose,
  onSave,
  onOpenReadiness,
  onNavigate,
}: {
  initial: DigitalEmployeeConfig;
  readiness: BusinessReadinessItem[];
  busy: boolean;
  mode?: "first" | "rules";
  activeRun?: boolean;
  restartFromBeginning?: boolean;
  initialStep?: "start" | "presenter";
  dismissible?: boolean;
  onClose?: () => void;
  onSave: (config: DigitalEmployeeConfig & { minimalOnboarding?: true; brandName?: string; onboardingConfirmation?: NonNullable<ReturnType<typeof validateEnterpriseOnboardingConfirmation>['confirmation']> }) => void | boolean | Promise<void | boolean>;
  onOpenReadiness: (item: BusinessReadinessItem) => void;
  onNavigate?: (page: BusinessDestination) => void;
}) {
  const restoredRules = useMemo(() => agentRuleFields(initial), [initial.socialCadence, initial.followupCadence, initial.reviewSchedule]);
  const [form, setForm] = useState(() => completeConfig(initial));
  const [dependencyNotice, setDependencyNotice] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [settingsEditorOpen, setSettingsEditorOpen] = useState(false);
  const [collectionPlatforms, setCollectionPlatforms] = useState(restoredRules.collectionPlatforms);
  const [collectionSources, setCollectionSources] = useState(restoredRules.collectionSources);
  const [collectionKeywords, setCollectionKeywords] = useState(restoredRules.collectionKeywords);
  const [collectionLanguage, setCollectionLanguage] = useState(restoredRules.collectionLanguage || "英语");
  const [collectionLookback, setCollectionLookback] = useState(restoredRules.collectionLookback);
  const [collectionLimit, setCollectionLimit] = useState(restoredRules.collectionLimit);
  const [collectionTime, setCollectionTime] = useState(restoredRules.collectionTime);
  const [approvedDiscoveryScope, setApprovedDiscoveryScope] = useState<SocialCrawlStrategy | null>(null);
  const [discoveryScopeNotice, setDiscoveryScopeNotice] = useState("");
  const [publishCount, setPublishCount] = useState(restoredRules.publishCount);
  const [selectedPublishPlatforms, setSelectedPublishPlatforms] = useState<Array<PublishingTarget["platform"]>>(() => {
    const savedPlatforms = weeklyPublishingPlatforms(initial.publishingTargets, initial.socialCadence);
    return savedPlatforms.length ? savedPlatforms : publishingPlatforms.slice();
  });
  const [platformPublishCounts, setPlatformPublishCounts] = useState(() => platformCountsFromCadence(initial.socialCadence, restoredRules.publishCount, initial.publishingTargets));
  const [connectedPublishingAccounts, setConnectedPublishingAccounts] = useState<PublishingTarget[]>([]);
  const [publishingAccountsLoading, setPublishingAccountsLoading] = useState(true);
  const [publishingAccountsError, setPublishingAccountsError] = useState("");
  const [followupGenerateAt, setFollowupGenerateAt] = useState(restoredRules.followupGenerateAt);
  const [followupApproveBy, setFollowupApproveBy] = useState(restoredRules.followupApproveBy);
  const [followupWindow, setFollowupWindow] = useState(restoredRules.followupWindow);
  const [followupFrequency, setFollowupFrequency] = useState(restoredRules.followupFrequency);
  const [reviewTimezone, setReviewTimezone] = useState(restoredRules.reviewTimezone);
  const [reviewCutoff, setReviewCutoff] = useState(restoredRules.reviewCutoff);
  const [recommendationApplied, setRecommendationApplied] = useState(false);
  const [profileLoading, setProfileLoading] = useState(mode === "first");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [guideStep, setGuideStep] = useState<EnterpriseOnboardingStep>(1);
  const [brandName, setBrandName] = useState("");
  const [baseFactVersion, setBaseFactVersion] = useState("");
  const [draftRevision, setDraftRevision] = useState(0);
  const [confirmationId, setConfirmationId] = useState(newOnboardingConfirmationId);
  const [companyIntro, setCompanyIntro] = useState("");
  const [brandTone, setBrandTone] = useState("");
  const [focusProductIds, setFocusProductIds] = useState<string[]>([]); const [productsDeferred, setProductsDeferred] = useState(false);
  const [targetBuyer, setTargetBuyer] = useState("");
  const [primaryPlatform, setPrimaryPlatform] = useState("");
  const [primaryCta, setPrimaryCta] = useState("");
  const [draftSources, setDraftSources] = useState<Partial<Record<EnterpriseOnboardingFieldKey, EnterpriseOnboardingSource>>>({});
  const [evidenceRefs, setEvidenceRefs] = useState<EnterpriseOnboardingEvidenceRef[]>([]);
  const [proposalSet, setProposalSet] = useState<EnterpriseOnboardingProposalSet>();
  const [proposalLoading, setProposalLoading] = useState(false);
  const [presenterPolicy, setPresenterPolicy] = useState<ProductionPresenterPolicy>(() => initial.productionOnboarding?.presenterPolicy || "local_video_only");
  const [presenterConfigured, setPresenterConfigured] = useState(false);
  const [knowledgeProducts, setKnowledgeProducts] = useState<EnterpriseOnboardingProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(mode === "first");
  const [activeRuleAgent, setActiveRuleAgent] = useState<"business" | "director" | "content" | "customer">("business");
  const [productError, setProductError] = useState("");
  const [productImporting, setProductImporting] = useState(false);
  const [productImportMessage, setProductImportMessage] = useState("");
  const [contentStage, setContentStage] = useState<SocialContentStageId>();
  const [stageSaving, setStageSaving] = useState(false);
  const [stageError, setStageError] = useState("");
  const themeContentEnabled = form.enabledWorkflows.some((item) => contentCreationWorkflows.includes(item));
  const visibleEnabledWorkflowCount = form.enabledWorkflows.filter(
    (item) => !contentCreationWorkflows.includes(item),
  ).length + (themeContentEnabled ? 1 : 0);
  const displayedReadiness = useMemo(() => {
    const override = (item: BusinessReadinessItem): BusinessReadinessItem => {
      if (item.key === "enterprise" && mode !== "first") {
        return {
          ...item,
          status: "ready",
          note: "企业档案已保存到企业知识库，可用于任务上下文",
        };
      }
      if (item.key === "products" && knowledgeProducts.length > 0) {
        return {
          ...item,
          status: "ready",
          count: knowledgeProducts.length,
          note: `企业知识库已有 ${knowledgeProducts.length} 个真实产品，可用于产品生成与逐客推荐`,
        };
      }
      return item;
    };
    const next = readiness.map(override);
    if (mode !== "first" && !next.some((item) => item.key === "enterprise")) {
      next.unshift({ key: "enterprise", label: "企业资料", status: "ready", count: null, page: "enterprise", note: "企业档案已保存到企业知识库，可用于任务上下文" });
    }
    if (knowledgeProducts.length > 0 && !next.some((item) => item.key === "products")) {
      next.push({ key: "products", label: "产品资料", status: "ready", count: knowledgeProducts.length, page: "enterprise", note: `企业知识库已有 ${knowledgeProducts.length} 个真实产品，可用于产品生成与逐客推荐` });
    }
    return next;
  }, [knowledgeProducts.length, mode, readiness]);
  useEffect(() => setForm(completeConfig(initial)), [initial]);
  useEffect(() => {
    setPresenterPolicy(initial.productionOnboarding?.presenterPolicy || "local_video_only");
  }, [initial.productionOnboarding]);
  useEffect(() => {
    let active = true;
    void socialDiscoveryApi.getScope().then(({ scope }) => {
      if (!active) return;
      setApprovedDiscoveryScope(scope.approval?.status === 'approved' ? scope : null);
      setDiscoveryScopeNotice(scope.approval?.status === 'approved' ? '' : '尚无已批准的编导采集范围');
    }).catch(() => { if (active) setDiscoveryScopeNotice('暂时无法读取当前编导采集范围'); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    setCollectionPlatforms(restoredRules.collectionPlatforms);
    setCollectionSources(restoredRules.collectionSources);
    setCollectionKeywords(restoredRules.collectionKeywords);
    setCollectionLanguage(restoredRules.collectionLanguage || "英语");
    setCollectionLookback(restoredRules.collectionLookback);
    setCollectionLimit(restoredRules.collectionLimit);
    setCollectionTime(restoredRules.collectionTime);
    setPublishCount(restoredRules.publishCount);
    setPlatformPublishCounts(platformCountsFromCadence(initial.socialCadence, restoredRules.publishCount, initial.publishingTargets));
    setFollowupGenerateAt(restoredRules.followupGenerateAt);
    setFollowupApproveBy(restoredRules.followupApproveBy);
    setFollowupWindow(restoredRules.followupWindow);
    setFollowupFrequency(restoredRules.followupFrequency);
    setReviewTimezone(restoredRules.reviewTimezone);
    setReviewCutoff(restoredRules.reviewCutoff);
  }, [initial.socialCadence, restoredRules]);
  const set = <K extends keyof DigitalEmployeeConfig>(
    key: K,
    value: DigitalEmployeeConfig[K],
  ) => setForm((current) => ({ ...current, [key]: value }));
  useEffect(() => {
    let cancelled = false;
    setPublishingAccountsLoading(true);
    digitalEmployeeApi.publishingAccounts()
      .then(result => {
        if (cancelled) return;
        setConnectedPublishingAccounts(result.items);
        if (!initial.publishingTargets.length && result.items.length) {
          setForm((current) => ({ ...current, publishingTargets: result.items }));
        }
        setPublishingAccountsError("");
      })
      .catch(error => {
        if (!cancelled) setPublishingAccountsError(error instanceof Error ? error.message : "发布账号读取失败");
      })
      .finally(() => { if (!cancelled) setPublishingAccountsLoading(false); });
    return () => { cancelled = true; };
  }, [initial.publishingTargets.length]);
  useEffect(() => {
    let cancelled = false;
    if (mode === "first") setProfileLoading(true);
    const profileRequest = fetch("/api/overseas/enterprise/profile", { headers: authHeader(), cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error("企业知识库读取失败");
        return response.json() as Promise<Record<string, any>>;
      });
    const draftRequest = mode === 'first' && initialStep !== 'presenter'
      ? readEnterpriseOnboardingDraft()
        .then(snapshot => ({ ...snapshot, error: '' }))
        .catch(error => ({ draft: null, revision: 0, error: error instanceof Error ? error.message : '新手引导草稿读取失败' }))
      : Promise.resolve({ draft: null, revision: 0, error: '' });
    Promise.all([profileRequest, draftRequest])
      .then(([profile, draftResult]) => {
        if (cancelled) return;
        const factVersion = String(profile.factVersion?.id || profile.factVersion?.contentHash || '');
        const loadedProducts: EnterpriseOnboardingProduct[] = (Array.isArray(profile.products?.items) ? profile.products.items as unknown[] : [])
          .map(normalizeEnterpriseOnboardingProduct)
          .filter((product): product is EnterpriseOnboardingProduct => Boolean(product));
        const savedFocusNames = String(profile.strategy?.focusProducts || '').split(/[、，,]/).map((item: string) => item.trim()).filter(Boolean);
        const savedFocusIds = loadedProducts.filter(product => savedFocusNames.includes(product.name)).map(product => product.id).slice(0, 3);
        const recommendedFocusIds = loadedProducts.map((product, index) => ({
          id: product.id, index,
          score: Number(Boolean(product.category)) + Number(Boolean(product.highlights || product.description)) + Number(Boolean(product.sku)) + Number(Boolean(product.images?.length)) * 2,
        })).sort((left, right) => right.score - left.score || left.index - right.index).slice(0, 3).map(item => item.id);
        const route = (Array.isArray(profile.socialStrategy?.enabledRoutes) ? profile.socialStrategy.enabledRoutes : [])[0];
        const routeStrategy = route ? profile.socialStrategy?.routeStrategies?.[route] : undefined;
        const profileValues = {
          companyName: String(profile.company?.name || ''), brandName: String(profile.brand?.name || ''),
          industry: String(profile.company?.industry || ''), primaryBusiness: String(profile.company?.primaryBusiness || profile.company?.description || ''),
          companyIntro: String(profile.company?.description || ''), brandTone: String(profile.brand?.tone || ''),
          products: loadedProducts, focusProductIds: savedFocusIds.length ? savedFocusIds : recommendedFocusIds,
          targetMarket: String(profile.company?.mainMarkets || profile.strategy?.focusMarkets || ''),
          targetBuyer: String(routeStrategy?.targetBuyerRoles?.join('、') || profile.customers?.targetProfiles || ''),
          primaryPlatform: String(profile.socialStrategy?.primaryPlatforms?.[0] || ''),
          language: primaryEnterpriseLanguage(profile.company?.primaryLanguages || profile.brand?.preferredLanguages),
          contentStage: socialContentStageProfile(profile.socialStrategy?.contentStage)?.id,
          primaryCta: String(routeStrategy?.primaryCta || ''),
        };
        const persistedDraft = draftResult.draft;
        const draft = !restartFromBeginning && persistedDraft?.baseFactVersion === factVersion
          ? persistedDraft
          : null;
        if (persistedDraft && !draft && !restartFromBeginning) {
          setProfileError('企业知识库已在草稿保存后更新。旧草稿不会覆盖新事实；本页已改用当前资料，下次保存时替换旧草稿。');
        } else setProfileError(draftResult.error);
        setForm((current) => ({
          ...current,
          companyName: draft?.companyName || profileValues.companyName || current.companyName,
          industry: draft?.industry || profileValues.industry || current.industry,
          primaryBusiness: draft?.primaryBusiness || profileValues.primaryBusiness || current.primaryBusiness,
          targetMarkets: draft?.targetMarket || profileValues.targetMarket || current.targetMarkets,
          customerProfile: draft?.targetBuyer || profileValues.targetBuyer || current.customerProfile,
        }));
        setBrandName(draft?.brandName || profileValues.brandName);
        setBaseFactVersion(factVersion);
        // Even when the saved draft is stale or the user explicitly restarts,
        // retain its revision solely as the compare-and-swap cursor. Its
        // business fields are never applied to the current fact version.
        setDraftRevision(persistedDraft?.revision || draftResult.revision);
        setConfirmationId(draft?.confirmationId || newOnboardingConfirmationId());
        setGuideStep(draft?.currentStep || 1);
        setCompanyIntro(draft?.companyIntro || profileValues.companyIntro);
        setBrandTone(draft?.brandTone || profileValues.brandTone);
        setKnowledgeProducts(draft?.products || profileValues.products);
        setFocusProductIds(draft?.focusProductIds || profileValues.focusProductIds); setProductsDeferred(draft?.productsDeferred === true);
        setTargetBuyer(draft?.targetBuyer || profileValues.targetBuyer);
        setPrimaryPlatform(draft?.primaryPlatform || profileValues.primaryPlatform);
        setPrimaryCta(draft?.primaryCta || profileValues.primaryCta);
        setContentStage((draft?.contentStage || profileValues.contentStage) as SocialContentStageId | undefined);
        setCollectionLanguage(draft?.language || profileValues.language);
        setDraftSources(draft?.sources || {
          companyName: 'system_detected', brandName: 'system_detected', industry: 'system_detected',
          primaryBusiness: 'system_detected', companyIntro: 'system_detected', brandTone: 'system_detected',
          products: 'system_detected', focusProducts: 'system_detected',
          targetMarket: 'system_detected', targetBuyer: 'system_detected', primaryPlatform: 'system_detected',
          language: 'system_detected', contentStage: 'system_detected', primaryCta: 'system_detected',
        });
        setEvidenceRefs(draft?.evidenceRefs || []);
        setProposalSet(draft?.proposalSet);
        if (mode === "first") setProductsLoading(false);
      })
      .catch((error) => {
        if (!cancelled && mode === "first") setProfileError(error instanceof Error ? error.message : "企业知识库读取失败");
      })
      .finally(() => {
        if (!cancelled) { setProfileLoading(false); setProductsLoading(false); }
      });
    return () => { cancelled = true; };
  }, [initialStep, mode, restartFromBeginning]);
  const selectedPublishingTargets = form.publishingTargets.filter((target) => selectedPublishPlatforms.includes(target.platform));
  const weeklyPublishingTotal = selectedPublishPlatforms.reduce((sum, platform) => sum + Math.max(0, Math.floor(platformPublishCounts[platform] || 0)), 0);
  const invalidWeeklyPublishingQuota = selectedPublishPlatforms.some(platform => !Number.isInteger(platformPublishCounts[platform]) || platformPublishCounts[platform] < 1)
    || weeklyPublishingTotal > MAX_WEEKLY_PUBLISHING_ITEMS;
  const missingSelectedPublishingAccount = selectedPublishPlatforms.some(platform => !selectedPublishingTargets.some(target => target.platform === platform));
  const publishingConfigured = selectedPublishPlatforms.length > 0 && !missingSelectedPublishingAccount && !invalidWeeklyPublishingQuota;
  const validationForm = publishingConfigured ? { ...form, publishingTargets: selectedPublishingTargets } : {
    ...form,
    enabledWorkflows: form.enabledWorkflows.filter((workflow) => workflow !== "content_publish"),
    publishingTargets: [],
    allowRealPublishing: false,
  };
  const errors = {
    ...configErrors(validationForm),
    ...(selectedPublishPlatforms.length && missingSelectedPublishingAccount ? { publishingTargets: "每个已选平台都需要选择一个发布账号" } : {}),
    ...(selectedPublishPlatforms.length && invalidWeeklyPublishingQuota ? { weeklyPublishingQuota: `每个平台至少 1 条，合计不超过 ${MAX_WEEKLY_PUBLISHING_ITEMS} 条` } : {}),
  };
  const errorLabels: Record<string, string> = {
    companyName: "企业名称",
    industry: "所属行业",
    primaryBusiness: "主要业务",
    targetMarkets: "目标市场",
    customerProfile: "核心客户",
    focusProducts: "本期重点产品",
    approvalOwner: "审批负责人",
    enabledWorkflows: "至少一项执行能力",
    socialCadence: "内容采集与发布节奏",
    followupCadence: "客户跟进节奏",
    contentPublish: "内容发布设置",
    batchFollowup: "客户跟进设置",
    publishingTargets: "发布平台与账号",
    weeklyPublishingQuota: "每周平台产量",
  };
  const missingConfigLabels = Object.keys(errors).map((key) => errorLabels[key] || key);
  const goToFirstMissingConfig = () => {
    const firstKey = Object.keys(errors)[0];
    if (!firstKey) return;
    const profileKeys = ["companyName", "industry", "primaryBusiness", "targetMarkets", "customerProfile"];
    if (profileKeys.includes(firstKey)) {
      setSubmitted(false);
      window.setTimeout(() => document.getElementById("onboarding-enterprise-profile")?.scrollIntoView({ behavior: getScrollBehavior(), block: "start" }), 50);
      return;
    }
    if (firstKey === "focusProducts") {
      setSubmitted(false);
      window.setTimeout(() => document.getElementById("onboarding-focus-products")?.scrollIntoView({ behavior: getScrollBehavior(), block: "start" }), 50);
      return;
    }
    const targetAgent = ["contentPublish", "publishingTargets", "managedPublishingGrant", "approvalOwner"].includes(firstKey) ? "business" : ["batchFollowup", "followupCadence"].includes(firstKey) ? "customer" : firstKey === "socialCadence" ? "director" : "business";
    setActiveRuleAgent(targetAgent);
    window.setTimeout(() => {
      const selector = firstKey === "approvalOwner" ? 'input[placeholder="姓名或岗位"]' : `[aria-invalid="true"]`;
      const target = document.querySelector<HTMLElement>(selector);
      target?.scrollIntoView({ behavior: getScrollBehavior(), block: "center" });
      target?.focus();
    }, 50);
  };
  const toggleWorkflow = (workflow: DigitalEmployeeWorkflow) => {
    const current = form.enabledWorkflows;
    if (current.includes(workflow)) {
      const dependents =
        workflow === "customer_segmentation" &&
        current.includes("batch_followup")
          ? (["batch_followup"] as DigitalEmployeeWorkflow[])
          : contentCreationWorkflows.includes(workflow) &&
              current.includes("content_publish") &&
              current.filter(
                (item) =>
                  contentCreationWorkflows.includes(item) && item !== workflow,
              ).length === 0
            ? (["content_publish"] as DigitalEmployeeWorkflow[])
            : [];
      set(
        "enabledWorkflows",
        current.filter(
          (item) => item !== workflow && !dependents.includes(item),
        ),
      );
      setDependencyNotice(
        dependents.length
          ? `已同步关闭：${dependents.map((item) => workflowLabel[item]).join("、")}，因为它依赖当前工作流。`
          : "",
      );
      return;
    }
    const additions: DigitalEmployeeWorkflow[] = [workflow];
    if (
      workflow === "batch_followup" &&
      !current.includes("customer_segmentation")
    )
      additions.unshift("customer_segmentation");
    if (workflow === "content_publish")
      additions.unshift(
        ...contentCreationWorkflows.filter((item) => !current.includes(item)),
      );
    set("enabledWorkflows", [...new Set([...current, ...additions])]);
    setDependencyNotice(
      workflow === "content_publish" && additions.length > 1
        ? "已同时启用前置能力：社媒视频制作。"
        : additions.length > 1
        ? `已同时启用前置工作流：${additions
            .slice(0, -1)
            .map((item) => workflowLabel[item])
            .join("、")}。`
        : "",
    );
  };
  const toggleThemeContentCreation = () => {
    const current = form.enabledWorkflows;
    if (themeContentEnabled) {
      const closesPublishing = current.includes("content_publish");
      set(
        "enabledWorkflows",
        current.filter(
          (item) =>
            !contentCreationWorkflows.includes(item) &&
            item !== "content_publish",
        ),
      );
      setDependencyNotice(
        closesPublishing
          ? "已同步关闭内容发布，因为它依赖社媒视频制作。"
          : "",
      );
      return;
    }
    set(
      "enabledWorkflows",
      synchronizeThemeContentWorkflows([
        ...current,
        ...contentCreationWorkflows,
      ]),
    );
    setDependencyNotice("已启用爆款复刻；缺少全片精确分析时会退回编导 Agent 补齐，不会转入自由创作。");
  };
  const missingRecommendationFields = [
    ["企业名称", form.companyName], ["行业", form.industry], ["主要业务", form.primaryBusiness],
    ["目标市场", form.targetMarkets], ["核心客户", form.customerProfile],
    ...(knowledgeProducts.length ? [["本期重点产品", form.focusProducts]] : []),
  ].filter(([, value]) => !String(value || "").trim()).map(([label]) => label);
  const canGenerateRecommendation = missingRecommendationFields.length === 0;
  const applyAiRecommendation = () => {
    if (!canGenerateRecommendation) return;
    const subject = form.focusProducts || form.primaryBusiness || form.industry || "企业重点产品";
    if (!form.targetMarkets.trim()) set("targetMarkets", "美国（优先），并根据真实询盘来源扩展到北美其他市场");
    if (!form.customerProfile.trim()) set("customerProfile", `当地经销商、采购负责人和渠道负责人；关注 ${subject} 的适配性、交付与售后`);
    setCollectionKeywords(`${subject}、买家痛点、应用场景、选型对比、行业趋势`);
    setRecommendationApplied(true);
  };
  const missingProfileFields = [["企业名称", form.companyName], ["品牌名称", brandName], ["行业/主营分类", form.industry]]
    .filter(([, value]) => !String(value || '').trim()).map(([label]) => label);
  const setDraftSource = (key: EnterpriseOnboardingFieldKey, source: EnterpriseOnboardingSource = 'user_provided') => {
    if (source === 'user_provided') setProposalSet(undefined);
    setDraftSources(current => ({ ...current, [key]: source }));
  };
  const fallbackPrimaryBusiness = form.primaryBusiness.trim() || form.industry.trim(); const effectivePrimaryBusiness = focusProductIds.map(id => knowledgeProducts.find(product => product.id === id)?.name).filter(Boolean).join('、') || fallbackPrimaryBusiness;
  const buildOnboardingDraft = (currentStep: EnterpriseOnboardingStep, productDeferredOverride?: boolean): EnterpriseOnboardingDraft => ({
    schemaVersion: ENTERPRISE_ONBOARDING_SCHEMA_VERSION,
    revision: draftRevision,
    currentStep,
    confirmationId,
    baseFactVersion,
    companyName: form.companyName.trim(), brandName: brandName.trim(),
    industry: form.industry.trim(), primaryBusiness: (productDeferredOverride ?? productsDeferred) ? fallbackPrimaryBusiness : effectivePrimaryBusiness,
    companyIntro: companyIntro.trim() || onboardingCompanyIntro(form.companyName, form.industry, (productDeferredOverride ?? productsDeferred) ? fallbackPrimaryBusiness : effectivePrimaryBusiness),
    brandTone: brandTone.trim() || onboardingBrandTone(),
    products: knowledgeProducts, focusProductIds, ...((productDeferredOverride ?? productsDeferred) ? { productsDeferred: true } : {}),
    targetMarket: form.targetMarkets.trim(), targetBuyer: targetBuyer.trim(),
    primaryPlatform: primaryPlatform.trim(), language: collectionLanguage.trim(),
    ...(contentStage ? { contentStage } : {}), primaryCta: primaryCta.trim(),
    ...(evidenceRefs.length ? { evidenceRefs } : {}), ...(proposalSet ? { proposalSet } : {}),
    sources: {
      ...draftSources,
      ...(!companyIntro.trim() ? { companyIntro: 'system_detected' as const } : {}),
      ...(!brandTone.trim() ? { brandTone: 'system_detected' as const } : {}),
    },
    updatedAt: new Date().toISOString(),
  });
  const persistOnboardingDraft = async (nextStep: EnterpriseOnboardingStep, productDeferredOverride?: boolean): Promise<EnterpriseOnboardingDraft | null> => {
    if (!baseFactVersion || profileSaving) { if (!baseFactVersion) setProfileError('企业资料尚未载入，无法保存当前草稿；请稍后重试。'); return null; }
    setProfileSaving(true); setProfileError(''); setProductError(''); setStageError('');
    try {
      const saved = await saveEnterpriseOnboardingDraft(buildOnboardingDraft(nextStep, productDeferredOverride), draftRevision);
      setDraftRevision(saved.revision); setGuideStep(saved.currentStep);
      setCompanyIntro(saved.companyIntro); setBrandTone(saved.brandTone);
      return saved;
    } catch (error) {
      const message = error instanceof Error ? error.message : '新手引导草稿保存失败';
      if (error instanceof EnterpriseOnboardingDraftError && error.status === 409) {
        setProfileError(`${message} 当前页面没有覆盖另一窗口的新版本。`);
      } else if (guideStep === 2) setProductError(message);
      else if (guideStep >= 3) setStageError(message);
      else setProfileError(message);
      return null;
    } finally { setProfileSaving(false); }
  };
  const saveDraftAndClose = async () => {
    const saved = await persistOnboardingDraft(guideStep);
    if (saved) onClose?.();
  };
  const confirmEnterpriseDraft = async () => {
    if (missingProfileFields.length) return;
    const saved = await persistOnboardingDraft(2);
    if (!saved) return;
    setProposalLoading(true);
    try {
      const proposal = await generateEnterpriseOnboardingProposals(saved);
      setProposalSet(proposal); setCompanyIntro(proposal.companyIntro.value); setBrandTone(proposal.brandTone.value);
      setDraftSources(current => ({ ...current, companyIntro: 'ai_suggested', brandTone: 'ai_suggested' }));
    } catch (error) { setProfileError(error instanceof Error ? error.message : 'AI 建议暂时不可用；当前草稿已保存。'); }
    finally { setProposalLoading(false); }
  };
  const importProductFile = async (file: File | null) => {
    if (!file || productImporting) return;
    setProductImporting(true); setProductImportMessage(''); setProductError('');
    try {
      const result = await importOnboardingProducts(file, knowledgeProducts);
      let products = result.products.map(normalizeEnterpriseOnboardingProduct).filter((product): product is EnterpriseOnboardingProduct => Boolean(product));
      const suggested = products.map((product, index) => ({ id: product.id, index, score: Number(Boolean(product.category)) + Number(Boolean(product.highlights || product.description)) + Number(Boolean(product.sku)) + Number(Boolean(product.images?.length)) * 2 }))
        .sort((left, right) => right.score - left.score || left.index - right.index).slice(0, 3).map(item => item.id);
      const nextEvidence = [...new Map([...evidenceRefs, result.sourceEvidence].map(item => [item.sha256, item])).values()];
      let focusIds = suggested; let proposal: EnterpriseOnboardingProposalSet | undefined;
      try {
        proposal = await generateEnterpriseOnboardingProposals({ ...buildOnboardingDraft(2), products, focusProductIds: suggested, evidenceRefs: nextEvidence });
        const byId = new Map(proposal.focusProducts.map(item => [item.productId, item]));
        products = products.map(product => byId.has(product.id) ? { ...product, category: byId.get(product.id)!.category || product.category,
          highlights: byId.get(product.id)!.highlights || product.highlights, description: byId.get(product.id)!.description || product.description } : product);
        focusIds = proposal.focusProducts.map(item => item.productId);
      } catch { /* keep deterministic, explicitly labelled system suggestion */ }
      setKnowledgeProducts(products); setFocusProductIds(focusIds); setEvidenceRefs(nextEvidence); if (proposal) setProposalSet(proposal);
      setDraftSources(current => ({ ...current, products: 'system_detected', focusProducts: proposal ? 'ai_suggested' : 'system_detected' }));
      setProductImportMessage(`已通过${result.sourceLabel}从“${file.name}”识别 ${result.importedCount} 个产品，原始文件已安全留存并会随草稿保存。${proposal ? 'AI 已给出最多 3 个待确认主推建议。' : 'AI 暂不可用，当前按资料完整度给出系统建议。'}${result.assignedImageCount ? `已绑定 ${result.assignedImageCount} 张产品照片。` : ''}${result.unassignedImageCount ? `${result.unassignedImageCount} 张图片暂未单独绑定产品，但仍保留在原始文件证据中。` : ''}`);
    } catch (error) { setProductError(error instanceof Error ? error.message : '产品文件解析失败'); }
    finally { setProductImporting(false); }
  };
  const generateMarketProposal = async () => {
    if (!form.targetMarkets.trim() || proposalLoading) return;
    setProposalLoading(true); setStageError('');
    try {
      const proposal = await generateEnterpriseOnboardingProposals(buildOnboardingDraft(3));
      setProposalSet(proposal); setTargetBuyer(proposal.market.targetBuyer); setPrimaryPlatform(proposal.market.primaryPlatform);
      setCollectionLanguage(proposal.market.language);
      setDraftSources(current => ({ ...current, targetBuyer: 'ai_suggested', primaryPlatform: 'ai_suggested', language: 'ai_suggested' }));
    } catch (error) { setStageError(error instanceof Error ? error.message : '市场建议暂时无法生成'); }
    finally { setProposalLoading(false); }
  };
  const completeMinimalOnboarding = async () => {
    if (stageSaving || !contentStage) return;
    setStageSaving(true);
    setStageError("");
    try {
      const savedDraft = await saveEnterpriseOnboardingDraft(buildOnboardingDraft(4), draftRevision);
      setDraftRevision(savedDraft.revision);
      const parsed = validateEnterpriseOnboardingConfirmation({ ...savedDraft, draftRevision: savedDraft.revision });
      if (!parsed.confirmation) throw new Error(`还需确认：${parsed.missing.join('、')}`);
      const focusProducts = savedDraft.productsDeferred ? [] : savedDraft.focusProductIds.map(id => savedDraft.products.find(product => product.id === id)).filter(Boolean) as EnterpriseOnboardingProduct[];
      const completed = await onSave({
        ...form,
        companyName: form.companyName.trim(),
        industry: form.industry.trim(), primaryBusiness: savedDraft.primaryBusiness,
        focusProducts: focusProducts.map(product => product.name).join('、'),
        targetMarkets: savedDraft.targetMarket, customerProfile: savedDraft.targetBuyer,
        videoLanguages: [savedDraft.language],
        allowGeneratedVisuals: false,
        operatingMaturity: contentStage === 'b2b_launch' ? 'starting' : 'growing',
        minimalOnboarding: true,
        brandName: brandName.trim(),
        onboardingConfirmation: parsed.confirmation,
      });
      if (completed === false) throw new Error("新手引导暂未完成，请稍后重试");
    } catch (error) {
      setStageError(error instanceof Error ? error.message : "新手引导暂未完成，请稍后重试");
    } finally {
      setStageSaving(false);
    }
  };
  const completePresenterSetup = async () => {
    setStageSaving(true); setStageError('');
    try {
      const productionOnboarding = {
        schemaVersion: 'fixed-yield.production-onboarding.v1' as const,
        contact: initial.productionOnboarding?.contact || { kind: 'none' as const, value: '', primaryCta: '' },
        presenterPolicy,
        output: initial.productionOnboarding?.output || { primaryLanguage: form.videoDefaults?.language || 'en', aspectRatio: '9:16' as const, resolution: '1080p' as const },
        includeOneRevision: true, confirmedAt: new Date().toISOString(),
      };
      const completed = await onSave({ ...form, productionOnboarding });
      if (completed === false) throw new Error('出镜设置暂未保存，请稍后重试');
    } catch (error) { setStageError(error instanceof Error ? error.message : '出镜设置暂未保存，请稍后重试'); }
    finally { setStageSaving(false); }
  };
  const submit = () => {
    setSubmitted(true);
    if (Object.keys(errors).length) return;
    const contentWorkflows = synchronizeThemeContentWorkflows(
      form.enabledWorkflows,
    );
    const enabledWorkflows = publishingConfigured
      ? [...new Set([...contentWorkflows, "content_publish" as DigitalEmployeeWorkflow])]
      : contentWorkflows.filter((workflow) => workflow !== "content_publish");
    const publishingTargets = allocateWeeklyPublishingTargets(selectedPublishingTargets, platformPublishCounts);
    const effectivePublishCount = selectedPublishPlatforms.length ? weeklyPublishingTotal : Math.max(0, Math.floor(publishCount || 0));
    const platformCounts = selectedPublishPlatforms.map((platform) => `${platform}=${platformPublishCounts[platform]}`).join(",");
    const completed = {
      ...form,
      publishingTargets,
      enabledWorkflows,
      allowRealPublishing: publishingConfigured && form.allowRealPublishing,
      team: ["planner", "knowledge", "risk", "review", ...(enabledWorkflows.some((item) => contentCreationWorkflows.includes(item)) ? ["content"] : []), ...(enabledWorkflows.some((item) => ["customer_segmentation", "batch_followup"].includes(item)) ? ["customer"] : [])],
      socialCadence: `${collectionPlatforms}；${collectionSources}；关键词：${collectionKeywords || form.focusProducts || form.primaryBusiness}；关键词语言：${collectionLanguage}；近 ${collectionLookback} 天；${collectionTime}；每次最多 ${collectionLimit} 条；按链接与标题去重 30 天；每周生成 ${effectivePublishCount} 条发布草稿；发布平台：${selectedPublishPlatforms.join("、")}；各平台条数：${platformCounts}；账号范围：${publishingTargets.map(target => `${target.platform}/${target.accountLabel}`).join("、") || "未确认"}；发布节奏按视频矩阵执行`,
      followupCadence: [followupGenerateAt, followupApproveBy, followupWindow, followupFrequency].every((value, index) => value === [restoredRules.followupGenerateAt, restoredRules.followupApproveBy, restoredRules.followupWindow, restoredRules.followupFrequency][index]) ? initial.followupCadence : `${followupGenerateAt}生成分层跟进草稿；${followupApproveBy}审批；${followupWindow}发送；${followupFrequency}`,
      reviewSchedule: reviewTimezone === restoredRules.reviewTimezone && reviewCutoff === restoredRules.reviewCutoff ? initial.reviewSchedule : `周五 17:30（${reviewTimezone}）；数据截止 ${reviewCutoff}；通知审批负责人；仅生成复盘和下周任务草稿`,
    };
    setSettingsEditorOpen(false);
    onSave(completed);
  };
  const confirmRecommendedSettings = () => {
    if (Object.keys(errors).length) {
      setSubmitted(true);
      setSettingsEditorOpen(true);
      return;
    }
    submit();
  };
  if (mode === 'first' && initialStep === 'presenter') return <PresenterSetupDialog
    open busy={stageSaving || busy} presenterPolicy={presenterPolicy} presenterConfigured={presenterConfigured}
    error={stageError} onClose={onClose} onPolicyChange={setPresenterPolicy}
    onPresenterSelected={() => setPresenterConfigured(true)} onConfirm={() => void completePresenterSetup()}
  />;
  if (mode === 'first' && guideStep === 1) return <OnboardingEnterpriseStep
    busy={busy || profileLoading || profileSaving || proposalLoading} profileLoading={profileLoading} dismissible={dismissible}
    onClose={() => void saveDraftAndClose()} onConfirm={() => void confirmEnterpriseDraft()}
    missingFields={missingProfileFields} companyName={form.companyName} brandName={brandName}
    industry={form.industry} error={profileError}
    onChange={(field, value) => {
      if (field === 'brandName') setBrandName(value); else set(field, value);
      setDraftSource(field, 'user_provided');
    }}
  />;
  if (mode === 'first' && guideStep === 2) return <OnboardingProductsStep
    busy={busy || profileSaving || proposalLoading} productsLoading={productsLoading} productImporting={productImporting}
    dismissible={dismissible} onClose={() => void saveDraftAndClose()} onBack={() => setGuideStep(1)}
    onDefer={() => { setProductsDeferred(true); void persistOnboardingDraft(3, true); }} onConfirm={() => { setProductsDeferred(false); void persistOnboardingDraft(3, false); }} onImport={file => void importProductFile(file)}
    onAddProduct={name => {
      const id = `manual-${newOnboardingConfirmationId()}`;
      setKnowledgeProducts(current => [...current, { id, name, category: '', highlights: '' }]);
      setFocusProductIds(current => current.length < 3 ? [...current, id] : current);
      setDraftSource('products'); setDraftSource('focusProducts');
    }}
    products={knowledgeProducts} focusProductIds={focusProductIds}
    onToggleFocus={id => {
      setFocusProductIds(current => current.includes(id) ? current.filter(item => item !== id) : current.length < 3 ? [...current, id] : current);
      setDraftSource('focusProducts', 'user_provided');
    }}
    onProductChange={(id, patch) => {
      setKnowledgeProducts(current => current.map(product => product.id === id ? { ...product, ...patch } : product));
      setDraftSource('products', 'user_provided');
    }}
    importMessage={productImportMessage} error={productError}
  />;
  if (mode === 'first' && guideStep === 3) return <OnboardingMarketStep
    busy={busy || profileSaving || proposalLoading} aiBusy={proposalLoading} dismissible={dismissible} onClose={() => void saveDraftAndClose()}
    onBack={() => setGuideStep(2)} onConfirm={() => void persistOnboardingDraft(4)}
    onGenerateProposal={() => void generateMarketProposal()}
    contentStage={contentStage} targetMarket={form.targetMarkets} targetBuyer={targetBuyer}
    primaryPlatform={primaryPlatform} language={collectionLanguage} primaryCta={primaryCta}
    error={stageError || profileError}
    onChange={(field, value) => {
      if (field === 'targetMarket') set('targetMarkets', value);
      else if (field === 'targetBuyer') { setTargetBuyer(value); set('customerProfile', value); }
      else if (field === 'primaryPlatform') setPrimaryPlatform(value);
      else if (field === 'language') setCollectionLanguage(value);
      else if (field === 'primaryCta') setPrimaryCta(value);
      else {
        const stage = value as SocialContentStageId;
        setContentStage(stage);
        if (!targetBuyer.trim()) { const buyer = stage === 'd2c_brand' ? '终端消费者' : '进口商、经销商与采购负责人'; setTargetBuyer(buyer); set('customerProfile', buyer); setDraftSource('targetBuyer', 'system_detected'); }
        if (!primaryPlatform.trim()) { setPrimaryPlatform(stage === 'd2c_brand' ? 'instagram' : 'linkedin'); setDraftSource('primaryPlatform', 'system_detected'); }
        if (!primaryCta.trim()) { setPrimaryCta(stage === 'd2c_brand' ? '了解产品详情' : '发送采购需求，获取产品资料与适配建议'); setDraftSource('primaryCta', 'system_detected'); }
      }
      setDraftSource(field, 'user_provided');
    }}
  />;
  if (mode === 'first') return <OnboardingConfirmationStep
    busy={busy || stageSaving || profileSaving} dismissible={dismissible}
    onClose={() => void saveDraftAndClose()} onBack={() => setGuideStep(3)}
    onConfirm={() => void completeMinimalOnboarding()} draft={buildOnboardingDraft(4)} error={stageError || profileError}
    onProposalChange={(field, value) => { if (field === 'companyIntro') setCompanyIntro(value); else setBrandTone(value); setDraftSource(field, 'user_provided'); }}
  />;
  return (
    <>
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="rounded-lg bg-emerald-50 p-3 text-emerald-700"><Settings2 size={22} /></div>
            <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Agent 设置</p><h2 className="mt-1 text-xl font-bold text-slate-950">系统已准备一套安全默认方案</h2><p className="mt-1 text-sm text-slate-500">无需逐项填写。确认后即可使用；以后随时可以打开修改。</p></div>
          </div>
          <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-[10px] font-semibold text-emerald-700">推荐设置已就绪</span>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {agentRoleGroups.map(agent => {
            const Icon = agent.id === "business" ? BarChart3 : agent.id === "director" ? Search : agent.id === "content" ? Sparkles : MessageSquare;
            const detail = agent.id === "business" ? "统筹发布、数据与复盘" : agent.id === "director" ? "采集灵感并完成编导方案" : agent.id === "content" ? "按方案制作并检查成片" : "整理客户并生成跟进草稿";
            return <div key={agent.id} className="rounded-lg border border-slate-200 bg-slate-50/70 p-4"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-emerald-700"><Icon size={17} /></span><p className="mt-3 text-sm font-semibold text-slate-900">{agent.label}</p><p className="mt-1 text-[11px] leading-5 text-slate-500">{detail}</p></div>;
          })}
        </div>
        {activeRun && <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-800">当前运行继续沿用已批准计划；本次保存从下一轮生效。</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button htmlType="button" onClick={() => setSettingsEditorOpen(true)} className="!h-auto min-h-9 !whitespace-normal rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50">查看并修改设置</Button>
          <Button type="primary" htmlType="button" disabled={busy} onClick={confirmRecommendedSettings} className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-bold">{busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}确认并保存设置</Button>
        </div>
      </section>
      {settingsEditorOpen && <section aria-label="Agent 设置" className="rounded-lg border border-border bg-white p-5">
      <Button htmlType="button" aria-label="关闭 Agent 设置" disabled={busy} onClick={() => setSettingsEditorOpen(false)} className="!h-auto min-h-9 !whitespace-normal sticky top-0 z-10 float-right rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50"><X size={18} /></Button>
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-emerald-50 p-3 text-emerald-700">
          <Settings2 size={22} />
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
            运行规则
          </p>
          <h2 className="mt-1 text-xl font-bold text-slate-950">设置数字员工的运行方式</h2>
          <p className="mt-1 text-sm text-slate-500">
            {activeRun
              ? "当前运行继续沿用已批准计划；这里保存的配置从下一轮计划生效。"
              : "这里只保留四个 Agent 各自需要由用户决定的设置。"}
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-1.5 sm:grid-cols-4">
        {([
          { id: "business" as const, label: "经营 Agent", icon: BarChart3 },
          { id: "director" as const, label: "编导 Agent", icon: Search },
          { id: "content" as const, label: "内容 Agent", icon: Sparkles },
          { id: "customer" as const, label: "客服 Agent", icon: MessageSquare },
        ]).map((agent)=>{const active=activeRuleAgent===agent.id;const Icon=agent.icon;return <Button key={agent.id} htmlType="button" aria-pressed={active} onClick={()=>setActiveRuleAgent(agent.id)} className={`!h-auto min-h-9 !whitespace-normal flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-center transition ${active?"bg-slate-950 text-white":"bg-white text-slate-600 hover:bg-slate-100"}`}><Icon size={15}/><span className="text-xs font-semibold">{agent.label}</span></Button>})}
      </div>
      <div className="mt-4 grid gap-4">
        {activeRuleAgent === "director" && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <div><p className="text-sm font-bold text-emerald-950">AI 推荐经营需求</p><p className="mt-1 text-xs text-emerald-700">根据行业、业务、重点产品和目标市场生成给编导的采集建议；实际搜索范围以已批准的灵感范围为准。</p></div>
          <div className="text-right"><Button htmlType="button" disabled={!canGenerateRecommendation} onClick={applyAiRecommendation} className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold"><Sparkles size={14} />{recommendationApplied ? "已生成，可继续调整" : "填入基础关键词"}</Button>{!canGenerateRecommendation&&<p role="status" className="mt-1 text-[10px] text-amber-700">请先补齐：{missingRecommendationFields.join("、")}</p>}</div>
        </div>}
        {activeRuleAgent === "director" && <section className="rounded-lg border border-slate-200 p-4">
          <p className="text-sm font-bold text-slate-900">编导采集需求与导演规则</p>
          <p className="mt-1 text-xs text-slate-500">这里记录经营 Agent 对编导的目标和建议。保存后不会直接覆盖正在执行的采集范围；编导采集以灵感大屏已批准的范围为准。</p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-xs font-semibold text-emerald-900">{approvedDiscoveryScope ? `当前生效：编导采集范围 v${approvedDiscoveryScope.approval?.scopeVersion ?? approvedDiscoveryScope.version} · ${approvedDiscoveryScope.discoveryBrief.lookbackDays} 天 · 滚动 7 天目标 ${approvedDiscoveryScope.discoveryBrief.resultLimit} 条` : discoveryScopeNotice || '正在读取当前编导采集范围…'}</p>
            <Button htmlType="button" onClick={() => onNavigate?.('socialInspiration')} disabled={!onNavigate} className="!h-auto min-h-9 !whitespace-normal rounded-lg px-3 py-2 text-xs font-bold">到灵感大屏确认或调整</Button>
          </div>
          <div className="mt-4 space-y-4">
            <div><p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">1 · 建议采集范围</p><div className="space-y-3"><Field label="建议平台"><input className={inputClass} value={collectionPlatforms} onChange={e=>setCollectionPlatforms(e.target.value)} /></Field><Field label="建议来源"><input className={inputClass} value={collectionSources} onChange={e=>setCollectionSources(e.target.value)} /></Field><Field label="建议关键词"><input className={inputClass} value={collectionKeywords} onChange={e=>setCollectionKeywords(e.target.value)} placeholder="仅作为经营需求，实际词在灵感大屏确认" /></Field></div></div>
            <div><p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">2 · 建议执行节奏</p><div className="grid gap-3 md:grid-cols-3"><Field label="建议采集时间"><input className={inputClass} value={collectionTime} onChange={e=>setCollectionTime(e.target.value)} /></Field><Field label="建议回看天数"><input className={inputClass} type="number" min={1} value={collectionLookback} onChange={e=>setCollectionLookback(Number(e.target.value))} /></Field><Field label="建议单次上限"><input className={inputClass} type="number" min={1} value={collectionLimit} onChange={e=>setCollectionLimit(Number(e.target.value))} /></Field></div></div>
          </div>
          <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">经营建议：近 {collectionLookback} 天 · 单次最多 {collectionLimit} 条。编导确认后才会成为采集参数。</p>
        </section>}
        {activeRuleAgent === "content" && <section className="rounded-lg border border-slate-200 p-4">
          <p className="text-sm font-bold text-slate-900">输出内容语言</p>
          <p className="mt-1 text-xs text-slate-500">内容 Agent 只按这里确认的语言交付内容。</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="主语言"><select className={inputClass} value={form.videoDefaults?.language || 'en'} onChange={event => { const language=event.target.value; set('videoDefaults', { ...form.videoDefaults, language }); set('videoLanguages', [language, ...(form.videoLanguages || []).filter(item=>item!==language)]); }}><option value="en">英语</option><option value="zh">中文</option><option value="es">西班牙语</option><option value="fr">法语</option><option value="de">德语</option></select></Field>
            <div><p className="text-xs font-semibold text-slate-600">需要输出的语言</p><div className="mt-2 flex flex-wrap gap-2">{[{code:'en',label:'英语'},{code:'zh',label:'中文'},{code:'es',label:'西班牙语'},{code:'fr',label:'法语'},{code:'de',label:'德语'}].map(item=>{const selected=(form.videoLanguages || [form.videoDefaults?.language || 'en']).includes(item.code);const primary=(form.videoDefaults?.language || 'en')===item.code;return <label key={item.code} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${selected?'border-blue-300 bg-blue-50':'border-slate-200 bg-white'}`}><input type="checkbox" checked={selected} disabled={primary} onChange={()=>set('videoLanguages',selected?(form.videoLanguages || []).filter(code=>code!==item.code):[...(form.videoLanguages || [form.videoDefaults?.language || 'en']),item.code])}/>{item.label}{primary?' · 主语言':''}</label>})}</div></div>
          </div>
        </section>}
        {activeRuleAgent === "business" && <section className="rounded-lg border border-slate-200 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-bold text-slate-900">周草稿、发布平台与具体账号</p><p className="mt-1 text-xs text-slate-500">默认向所有已连接账号和平台发布，具体节奏沿用视频矩阵。</p></div><div className="flex flex-wrap items-center gap-3"><Button htmlType="button" onClick={()=>{setSelectedPublishPlatforms([]);set("publishingTargets",[]);set("allowRealPublishing",false);}} className="!h-auto min-h-9 !whitespace-normal text-xs font-bold text-slate-600 hover:text-slate-950">本周暂不发布，仅生成内容</Button><Button htmlType="button" onClick={()=>onOpenReadiness({key:"social_accounts",label:"社媒账号",status:"empty",count:connectedPublishingAccounts.length,page:"accountManagement",note:"管理发布账号"})} className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-1 text-xs font-bold text-blue-700">管理账号 <ExternalLink size={12}/></Button></div></div>
          {!selectedPublishPlatforms.length && <div className="mt-4"><Field label="仅生成内容时的每周草稿数"><input className={inputClass} type="number" min={0} max={MAX_WEEKLY_PUBLISHING_ITEMS} value={publishCount} onChange={event=>setPublishCount(Math.min(MAX_WEEKLY_PUBLISHING_ITEMS, Math.max(0, Math.floor(Number(event.target.value) || 0))))} /><p className="mt-1 text-xs text-slate-500">未选择发布平台时，只按这里生成内容草稿。</p></Field></div>}
          <div className="mt-4 space-y-3">{publishingPlatforms.map(platform => { const selected=selectedPublishPlatforms.includes(platform); const accounts=connectedPublishingAccounts.filter(account=>account.platform===platform); return <div key={platform} className={`rounded-lg border p-3 ${selected?'border-violet-200 bg-violet-50/35':'border-slate-200 bg-slate-50'}`}><div className="flex flex-wrap items-center gap-3"><label className="flex min-w-36 items-center gap-2 text-xs font-semibold text-slate-900"><input type="checkbox" checked={selected} onChange={event=>setSelectedPublishPlatforms(current=>event.target.checked?[...new Set([...current,platform])]:current.filter(item=>item!==platform))}/>{contentPlatformLabel[platform]}</label><label className="ml-auto flex items-center gap-2 text-xs font-semibold text-slate-600">每周发布<input type="number" min={1} max={MAX_WEEKLY_PUBLISHING_ITEMS} disabled={!selected} value={platformPublishCounts[platform]} onChange={event=>setPlatformPublishCounts(current=>({...current,[platform]:Math.min(MAX_WEEKLY_PUBLISHING_ITEMS,Math.max(0,Math.floor(Number(event.target.value)||0)))}))} className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-right text-sm" />条</label></div><div className="mt-2 flex flex-wrap gap-2">{publishingAccountsLoading?<span className="text-xs text-slate-500">正在读取账号…</span>:accounts.length?accounts.map(account=>{const checked=form.publishingTargets.some(target=>target.accountId===account.accountId);return <label key={account.accountId} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${checked&&selected?'border-violet-200 bg-white text-violet-800':'border-slate-200 bg-white text-slate-500'}`}><input type="checkbox" disabled={!selected} checked={checked&&selected} onChange={()=>set('publishingTargets',checked?form.publishingTargets.filter(target=>target.accountId!==account.accountId):[...form.publishingTargets,account])}/>{account.accountLabel}</label>}):<span className="text-xs text-amber-700">尚未连接该平台账号</span>}</div></div>; })}</div>
          {publishingAccountsError&&<p className="mt-3 text-[10px] text-red-600">{publishingAccountsError}</p>}
          <label className="mt-4 flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3"><input type="checkbox" className="mt-0.5" checked={form.allowRealPublishing} onChange={event=>set("allowRealPublishing",event.target.checked)}/><span><span className="block text-xs font-semibold text-slate-900">审批通过后允许真实发布</span><span className="mt-0.5 block text-[10px] leading-5 text-slate-500">关闭时只生成发布草稿和排期，不会发送到社媒平台。</span></span></label>
          <p className={`mt-4 rounded-lg p-3 text-xs leading-5 ${invalidWeeklyPublishingQuota?'bg-red-50 text-red-700':'bg-slate-50 text-slate-600'}`}>{selectedPublishPlatforms.length ? `本周总计 ${weeklyPublishingTotal} 条；按各平台条数和所选账号进入同一份视频矩阵排期。` : '本周不安排发布，只生成内容草稿。'}{invalidWeeklyPublishingQuota ? ` 每个平台至少 1 条，合计不超过 ${MAX_WEEKLY_PUBLISHING_ITEMS} 条。` : ''}</p>
        </section>}
        {activeRuleAgent === "customer" && <details className="rounded-lg border border-emerald-100 bg-emerald-50/45 p-4">
          <summary className="cursor-pointer text-sm font-bold text-emerald-950">客服知识与接待信息（按需展开）</summary>
          <p className="mt-2 text-xs text-emerald-800">企业和产品资料全系统共用；这里只补充客服专用的接待规则和通知方式。</p>
          <div className="mt-4"><KnowledgeIntakePanel /></div>
        </details>}
        {activeRuleAgent === "customer" && <div className="md:col-span-2 rounded-lg border border-slate-200 p-4"><p className="text-sm font-bold text-slate-900">客户跟进规则</p><div className="mt-3 grid gap-3 md:grid-cols-2"><Field label="草稿生成时间"><input className={inputClass} value={followupGenerateAt} onChange={e=>setFollowupGenerateAt(e.target.value)} /></Field><Field label="审批截止"><input className={inputClass} value={followupApproveBy} onChange={e=>setFollowupApproveBy(e.target.value)} /></Field><Field label="允许发送时段"><input className={inputClass} value={followupWindow} onChange={e=>setFollowupWindow(e.target.value)} /></Field><Field label="客户触达频控"><input className={inputClass} value={followupFrequency} onChange={e=>setFollowupFrequency(e.target.value)} /></Field></div><label className="mt-3 flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3"><input type="checkbox" className="mt-0.5" checked={form.allowRealCustomerMessages} onChange={e=>set("allowRealCustomerMessages",e.target.checked)}/><span><span className="block text-xs font-semibold text-slate-900">审批通过后允许真实发送客服消息</span><span className="mt-0.5 block text-[10px] text-slate-500">未开启时只生成和审批草稿，不调用真实消息渠道；商业承诺仍需逐条人工审批。</span></span></label><p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">先生成逐客草稿并等待审批，仅在客户当地工作时间发送。</p></div>}
      </div>
      <div className="mt-4 flex flex-col items-end gap-2">
        {submitted && Object.keys(errors).length > 0 && (
          <div role="alert" className="flex flex-wrap items-center justify-end gap-2 text-xs font-semibold text-red-600"><span>还需填写：{missingConfigLabels.join("、")}。</span><Button htmlType="button" onClick={goToFirstMissingConfig} className="!h-auto min-h-9 !whitespace-normal rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] font-bold text-red-700">去补齐</Button></div>
        )}
        <Button type="primary"
          htmlType="button"
          disabled={busy || (submitted && Object.keys(errors).length > 0)}
          onClick={submit}
          className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-bold transition"
        >
          {busy ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <ArrowRight size={16} />
          )}{" "}
          {activeRun ? "保存为后续运行规则" : "保存运行规则"}
        </Button>
      </div>
    </section>}
    </>
  );
}
