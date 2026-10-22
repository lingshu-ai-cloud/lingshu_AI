import { getScrollBehavior } from "../lib/usePrefersReducedMotion";
import { useState, useEffect, useRef } from 'react';
import { Alert, Button, Input, Tabs } from 'antd';
import { LsGradientProgress } from './ui/LsExperiencePrimitives';
import EnterprisePresenters from './enterprise/EnterprisePresenters';
import EnterpriseNotificationSettings from './enterprise/EnterpriseNotificationSettings';
import EnterpriseFaqPanel from './enterprise/EnterpriseFaqPanel';
import EnterpriseProductPanel from './enterprise/EnterpriseProductPanel';
import EnterpriseProductImportReviewModal from './enterprise/EnterpriseProductImportReviewModal';
import EnterpriseAdditionalSettings from './enterprise/EnterpriseAdditionalSettings';
import EnterpriseBizRulesPanel from './enterprise/EnterpriseBizRulesPanel';
import EnterpriseSalesStylePanel from './enterprise/EnterpriseSalesStylePanel';
import { useEnterpriseSalesStyle } from './enterprise/useEnterpriseSalesStyle';
import { useEnterpriseFaq } from './enterprise/useEnterpriseFaq';
import { AUTO_REPLY_SCOPE, EnterpriseAiAutonomySection, EnterpriseHandoffSafetySection } from './enterprise/EnterpriseCustomerServiceSettings';
import { Field, Toggle, KnowledgeCard, OptionSelector } from './enterprise/EnterpriseFormControls';
import { Building2, Package, Megaphone, BookOpen, Save, CheckCircle2, Loader2, Compass, Zap, MessageSquare, Plus, X, Image, Bell, ChevronLeft, Globe2, ShieldCheck, ArrowRight, Users, type LucideIcon } from 'lucide-react';
import { authHeader } from '../lib/auth';
import { completeDemoStep } from '../lib/demoProgress';
import { prepareEnterpriseProductImport, removePendingImportedProduct, type PendingProductImport } from './enterprise/enterpriseProductImportPreparation';
import { confirmEnterpriseProductImportAssets } from './enterprise/enterpriseProductImportConfirmation';
import { useEnterpriseProductDocuments } from './enterprise/useEnterpriseProductDocuments';
import {importProductEvidenceUrl,uploadProductEvidence} from '../lib/enterpriseProductAssetUpload';
import SupportAccessControl from './SupportAccessControl';
import EnterpriseProductImportCard, { type ProductApiStatus } from './EnterpriseProductImportCard';
import type { AppliedProfile } from './enterprise/KnowledgeIntakePanel';
import {readWeeklyEnterpriseFactTarget} from '../lib/weeklyEnterpriseFactNavigation';
import type { ProductItem, AutonomyLevel, BizRules, FaqItem, FaqPack, NotificationSettings, CooperationRoute, SocialStrategy, Profile } from './enterprise/enterpriseProfileTypes';
import { CATEGORY_OPTIONS, COMPANY_TYPE_OPTIONS, LANGUAGE_OPTIONS, MARKET_OPTIONS, emptyProduct, normalizeEnterpriseProfile, normalizeProductItems } from './enterprise/enterpriseProfileNormalization';
import { enterpriseProfileCompleteness, productAssetStats, productCreativeMaterialCount, sectionCompletion, type EnterpriseCompletenessTodo } from './enterprise/enterpriseProfileCompleteness';
export { normalizeEnterpriseProfile } from './enterprise/enterpriseProfileNormalization';
export { enterpriseProfileCompleteness, sectionCompletion } from './enterprise/enterpriseProfileCompleteness';


export interface EnterpriseProductsDeepLink {
  productName: string;
  materialIds: string[];
  contentItemId: string;
}

export type EnterpriseProductsDeepLinkResolution = {
  productIndex: number | null;
  reason: 'exact_unique' | 'not_found' | 'ambiguous';
};

export function resolveEnterpriseProductsDeepLink(
  products: Array<Pick<ProductItem, 'name'>>,
  deepLink: EnterpriseProductsDeepLink,
): EnterpriseProductsDeepLinkResolution {
  const requestedName = deepLink.productName.trim().toLocaleLowerCase();
  if (!requestedName) return { productIndex: null, reason: 'not_found' };
  const matches = products.flatMap((product, index) => (
    product.name.trim().toLocaleLowerCase() === requestedName ? [index] : []
  ));
  if (matches.length === 1) return { productIndex: matches[0]!, reason: 'exact_unique' };
  return { productIndex: null, reason: matches.length > 1 ? 'ambiguous' : 'not_found' };
}


const DEFAULT: Profile = {
  company: { name: '', industry: '', companyType: '', mainMarkets: '', primaryLanguages: '', socialPlatformExperience: '', founded: '', description: '' },
  socialStrategy: { enabledRoutes: [], routeStrategies: {}, manuallyEditedFields: [] },
  products: {
    categories: '',
    priceRange: '',
    moq: '',
    certifications: '',
    highlights: '',
    items: [],
  },
  brand: { name: '', tone: '', style: '', taboos: '', usp: '', preferredLanguages: '' },
  strategy: { currentGoal: '', focusProducts: '', focusMarkets: '', excludedMarkets: '', pricingStrategy: '', minMargin: '', agentAutonomy: '', aiAutonomy: 'draft' },
  customers: { targetProfiles: '', highValueSignals: '', lowQualitySignals: '', commonQuestions: '', followupStyle: '' },
  operations: { leadTime: '', customization: '', logistics: '', paymentTerms: '', riskNotes: '' },
  agentLearning: { provenAngles: '', weakAngles: '', pendingAssumptions: '', userCorrections: '' },
  bizRules: { quoteMode: 'human_only', priceRange: '', bargainPolicy: 'no', bargainFloor: '', moq: '', samplePolicy: '', paymentTerms: '', leadTime: '' },
  faq: [],
  notifications: { receivers: [], workHours: { start: '09:00', end: '22:00' }, quietOutsideHours: true, nightMode: { enabled: false, autoCategories: 'approved' }, lastTestAt: '' },
  handoffRules: { keywords: ['人工', '老板', 'manager', 'complaint', 'refund'], missStreakToDraft: 2, negativeSentiment: true },
  customerService: { enabled: false, enabledAt: '', disabledAt: '', partialAutoReplyEnabled: false, partialAutoReplyDecision: 'pending', partialAutoReplyDecisionAt: '' },
  salesStyleProfile: { learnedFromCount: 0, sample_pairs: [] },
  knowledge: '',
};

const AGENTS = [
  { icon: Compass, label: '首页', color: '#4f46e5' },
  { icon: Zap, label: '我的社媒', color: '#d97706' },
  { icon: MessageSquare, label: '我的客户', color: '#0891b2' },
];

const PAGE_SIZE = 5;
const SERVICE_INTAKE_AUTO_OPEN_KEY = 'lingshu:enterprise:service-intake-auto-opened';

type KnowledgeView = 'products' | 'bizRules' | 'faq' | 'company' | 'materials' | 'salesStyle' | 'advanced' | 'presenters' | 'presenterRouting';
type EnterpriseArea = 'facts' | 'appearance' | 'service';

function advisorInitialEnterpriseView(): KnowledgeView {
  try {
    if (new URLSearchParams(window.location.search).get('arkVerification') === 'complete') return 'presenters';
    const value = localStorage.getItem('lingshu:enterprise:initial-view');
    if (value === 'materials') return 'products';
    if (value === 'presenterRouting') return 'presenters';
    if (value === 'socialStrategy') return 'company';
    if (value && ['products', 'bizRules', 'faq', 'company', 'materials', 'salesStyle', 'advanced', 'presenters', 'presenterRouting'].includes(value)) return value as KnowledgeView;
  } catch { /* ignore */ }
  return 'company';
}

const FACT_VIEWS: Array<{ id: KnowledgeView; label: string; hint: string }> = [
  { id: 'company', label: '公司与市场', hint: '你是谁' },
  { id: 'products', label: '产品资料', hint: '你卖什么' },
];

const SERVICE_VIEWS: Array<{ id: KnowledgeView; label: string; hint: string }> = [
  { id: 'bizRules', label: '报价与业务规则', hint: '询价转人工' },
  { id: 'faq', label: '常见问答', hint: '允许怎么答' },
  { id: 'salesStyle', label: '销售风格', hint: '持续学习' },
  { id: 'advanced', label: '接待与转人工', hint: '权限和提醒' },
];
function enterpriseAreaForView(view: KnowledgeView): EnterpriseArea {
  if (['presenters', 'presenterRouting'].includes(view)) return 'appearance';
  if (['bizRules', 'faq', 'salesStyle', 'advanced'].includes(view)) return 'service';
  return 'facts';
}

const KNOWLEDGE_VIEW_ICONS: Record<KnowledgeView, LucideIcon> = {
  company: Globe2,
  products: Package,
  materials: Image,
  bizRules: ShieldCheck,
  faq: BookOpen,
  salesStyle: Megaphone,
  advanced: Bell,
  presenters: Users,
  presenterRouting: Users,
};
export function profileSnapshot(profile: Profile): string {
  const stable = JSON.parse(JSON.stringify(profile)) as Profile;
  const enabledRoutes = Array.from(new Set(stable.socialStrategy?.enabledRoutes ?? [])).sort() as CooperationRoute[];
  const routeStrategies = Object.fromEntries(
    enabledRoutes
      .filter(route => Boolean(stable.socialStrategy?.routeStrategies?.[route]))
      .map(route => [route, stable.socialStrategy!.routeStrategies[route]]),
  ) as SocialStrategy['routeStrategies'];
  stable.socialStrategy = { ...(stable.socialStrategy ?? DEFAULT.socialStrategy!), enabledRoutes, routeStrategies };
  return JSON.stringify(stable);
}


const inputCls = 'w-full';

const MAX_PRODUCT_DOCUMENTS = 3;

export function productMaterialLibraryParams(product: Pick<ProductItem, 'id' | 'productId' | 'sku' | 'name'>): { productId: string; productRef: string } {
  return {
    productId: String(product.id || product.productId || product.sku || '').trim(),
    productRef: String(product.name || '').trim(),
  };
}


export default function EnterprisePage({ productsDeepLink = null }: { productsDeepLink?: EnterpriseProductsDeepLink | null }) {
  const weeklyFactTarget=readWeeklyEnterpriseFactTarget();
  const [profile, setProfile] = useState<Profile>(DEFAULT);
  const [saving, setSaving] = useState(false);
  const [, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [loading, setLoading] = useState(true);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [apiStatus, setApiStatus] = useState<ProductApiStatus>({ count: 0 });
  const [orderImporting, setOrderImporting] = useState(false);
  const [orderImportMessage, setOrderImportMessage] = useState('');
  const [autonomyHighlight, setAutonomyHighlight] = useState(false);
  const [productImporting, setProductImporting] = useState(false);
  const [productImportMessage, setProductImportMessage] = useState('');
  const [pendingProductImport, setPendingProductImport] = useState<PendingProductImport | null>(null);
  const [productImportConfirming, setProductImportConfirming] = useState(false);
  const [knowledgeView, setKnowledgeView] = useState<KnowledgeView>(advisorInitialEnterpriseView);
  const [enterpriseArea, setEnterpriseArea] = useState<EnterpriseArea>(() => enterpriseAreaForView(advisorInitialEnterpriseView()));
  const [languageSettingsHighlight, setLanguageSettingsHighlight] = useState(false);
  const [productPage, setProductPage] = useState(1);
  const [expandedProductIndexes, setExpandedProductIndexes] = useState<Set<number>>(() => new Set([0]));
  const [productsDeepLinkResolution, setProductsDeepLinkResolution] = useState<EnterpriseProductsDeepLinkResolution | null>(null);
  const [notificationsHighlight, setNotificationsHighlight] = useState(false);
  const [bizRulesHighlight, setBizRulesHighlight] = useState(false);
  const [handoffKeywordInput, setHandoffKeywordInput] = useState('');
  const salesStyle = useEnterpriseSalesStyle({ setProfile, defaultStyle: DEFAULT.salesStyleProfile! });
  const {
    faqPreview, setFaqPreview, faqStructuring, faqPacks, recommendedPackIndustry,
    faqPacksOpen, setFaqPacksOpen, openPackId, setOpenPackId, packImporting,
    faqPage, setFaqPage, faqItems, visibleFaqs, acceptLoadedPacks,
    addFaq, updateFaq, removeFaq, structureLegacyFaq, importFaqPreview,
    selectedQuestionsForPack, togglePackQuestion, importFaqPack,
  } = useEnterpriseFaq({ profile, setProfile, setSaveError, pageSize: PAGE_SIZE });
  const persistedProfileRef = useRef('');
  const productStatusAbortRef = useRef<AbortController | null>(null);
  const hasUnsavedChanges = profileLoaded && !loading && persistedProfileRef.current !== profileSnapshot(profile);

  useEffect(() => {
    if (window.sessionStorage.getItem('lingshu:enterprise-focus') !== 'language-settings') return;
    window.sessionStorage.removeItem('lingshu:enterprise-focus');
    setEnterpriseArea('facts');
    setKnowledgeView('company');
    setLanguageSettingsHighlight(true);
    const scrollTimer = window.setTimeout(() => {
      document.getElementById('enterprise-language-settings')?.scrollIntoView({ behavior: getScrollBehavior(), block: 'center' });
    }, 120);
    const highlightTimer = window.setTimeout(() => setLanguageSettingsHighlight(false), 3000);
    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(highlightTimer);
    };
  }, []);

  useEffect(()=>{if(!weeklyFactTarget)return;setEnterpriseArea('facts');setKnowledgeView('company');window.setTimeout(()=>document.getElementById('weekly-enterprise-fact-target')?.scrollIntoView({behavior:'smooth',block:'start'}),100);},[weeklyFactTarget?.exceptionId,weeklyFactTarget?.consumerInputHash]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    const requestInit = { headers: authHeader(), signal: controller.signal };
    Promise.all([
      fetch('/api/overseas/enterprise/profile', requestInit).then(r => r.ok ? r.json() : Promise.reject(new Error(`企业资料加载失败（${r.status}）`))),
      fetch('/api/overseas/enterprise/product-api/status', requestInit).then(r => r.json()).catch(() => ({ count: 0 })),
      fetch('/api/overseas/enterprise/faq/packs', requestInit).then(r => r.json()).catch(() => ({ packs: [], recommendedIndustry: 'general' })),
    ])
      .then(([data, productApiStatus, packData]: [Partial<Profile>, ProductApiStatus, { packs?: FaqPack[]; recommendedIndustry?: string }]) => {
        if (!active) return;
        const rawNext: Profile = {
          ...DEFAULT,
          ...data,
          company: { ...DEFAULT.company, ...data.company },
          socialStrategy: {
            ...DEFAULT.socialStrategy!,
            ...data.socialStrategy,
            routeStrategies: { ...DEFAULT.socialStrategy!.routeStrategies, ...data.socialStrategy?.routeStrategies },
          },
          products: { ...DEFAULT.products, ...data.products, items: normalizeProductItems({ ...DEFAULT.products, ...data.products }) },
          brand: { ...DEFAULT.brand, ...data.brand },
          strategy: { ...DEFAULT.strategy, ...data.strategy },
          customers: { ...DEFAULT.customers, ...data.customers },
          operations: { ...DEFAULT.operations, ...data.operations },
          agentLearning: { ...DEFAULT.agentLearning, ...data.agentLearning },
          bizRules: {
            ...DEFAULT.bizRules,
            ...data.bizRules,
            quoteMode: data.bizRules?.quoteMode ?? DEFAULT.bizRules!.quoteMode,
            bargainPolicy: data.bizRules?.bargainPolicy ?? DEFAULT.bizRules!.bargainPolicy,
            priceRange: data.bizRules?.priceRange || data.products?.priceRange || '',
            moq: data.bizRules?.moq || data.products?.moq || '',
            samplePolicy: data.bizRules?.samplePolicy ?? '',
            paymentTerms: data.bizRules?.paymentTerms || data.operations?.paymentTerms || '',
            leadTime: data.bizRules?.leadTime || data.operations?.leadTime || '',
          },
          faq: Array.isArray(data.faq) ? data.faq : [],
          notifications: {
            ...DEFAULT.notifications!,
            ...data.notifications,
            workHours: { ...DEFAULT.notifications!.workHours, ...data.notifications?.workHours },
            nightMode: {
              enabled: Boolean(data.notifications?.nightMode?.enabled),
              autoCategories: 'approved',
            },
            receivers: Array.isArray(data.notifications?.receivers) ? data.notifications!.receivers : [],
          },
          handoffRules: {
            ...DEFAULT.handoffRules!,
            ...data.handoffRules,
            keywords: Array.isArray(data.handoffRules?.keywords) && data.handoffRules.keywords.length
              ? data.handoffRules.keywords
              : DEFAULT.handoffRules!.keywords,
            missStreakToDraft: [1, 2, 3].includes(Number(data.handoffRules?.missStreakToDraft))
              ? data.handoffRules!.missStreakToDraft
              : DEFAULT.handoffRules!.missStreakToDraft,
            negativeSentiment: data.handoffRules?.negativeSentiment !== false,
          },
          customerService: {
            ...DEFAULT.customerService!,
            ...data.customerService,
            enabled: data.customerService?.enabled === true,
            partialAutoReplyEnabled: data.customerService?.partialAutoReplyEnabled === true,
            partialAutoReplyDecision: data.customerService?.partialAutoReplyDecision === 'enabled' || data.customerService?.partialAutoReplyDecision === 'declined'
              ? data.customerService.partialAutoReplyDecision
              : 'pending',
          },
          salesStyleProfile: {
            ...DEFAULT.salesStyleProfile!,
            ...data.salesStyleProfile,
            sample_pairs: Array.isArray(data.salesStyleProfile?.sample_pairs) ? data.salesStyleProfile.sample_pairs : [],
          },
          knowledge: data.knowledge ?? '',
        };
        const next = normalizeEnterpriseProfile(rawNext);
        persistedProfileRef.current = profileSnapshot(next);
        setProfile(next);
        setProfileLoaded(true);
        setSaveError('');
        setApiStatus(productApiStatus);
        acceptLoadedPacks(packData);
      })
      .catch(error => {
        if (!active) return;
        setProfileLoaded(false);
        setSaveError(error instanceof Error && error.name === 'AbortError'
          ? '企业资料加载超时，请刷新后重试'
          : error instanceof Error ? error.message : '企业资料加载失败，请刷新后重试');
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!profileLoaded) return;
    let disposed = false;
    let inFlight = false;
    const poll = async () => {
      if (disposed || inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      const controller = new AbortController();
      productStatusAbortRef.current = controller;
      const timeout = window.setTimeout(() => controller.abort(), 12_000);
      try {
        const response = await fetch('/api/overseas/enterprise/product-api/status', {
          headers: authHeader(),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`产品接口状态查询失败（${response.status}）`);
        const status = await response.json() as ProductApiStatus;
        if (!disposed) setApiStatus(status);
      } catch {
        // Keep the last successful status; the next bounded poll can recover.
      } finally {
        window.clearTimeout(timeout);
        if (productStatusAbortRef.current === controller) productStatusAbortRef.current = null;
        inFlight = false;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void poll();
      else productStatusAbortRef.current?.abort();
    };
    const timer = window.setInterval(() => void poll(), 5000);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      productStatusAbortRef.current?.abort();
      productStatusAbortRef.current = null;
    };
  }, [profileLoaded]);

  useEffect(() => {
    if (loading) return;
    const raw = localStorage.getItem('lingshu:enterprise:prefill-faq');
    if (!raw) return;
    localStorage.removeItem('lingshu:enterprise:prefill-faq');
    try {
      const parsed = JSON.parse(raw) as Partial<FaqItem>;
      const question = String(parsed.question || '').trim();
      if (!question) return;
      setProfile(prev => ({
        ...prev,
        faq: [
          ...(prev.faq ?? []),
          {
            id: crypto.randomUUID(),
            question,
            answer: String(parsed.answer || ''),
            approvedForAuto: false,
            source: 'learned',
          },
        ],
      }));
      setEnterpriseArea('service');
      setKnowledgeView('faq');
      window.setTimeout(() => {
        document.querySelector('[data-enterprise-faq]')?.scrollIntoView({ behavior: getScrollBehavior(), block: 'start' });
      }, 100);
    } catch {
      // Ignore malformed prefill payload.
    }
  }, [loading]);


  const set = <K extends keyof Profile>(section: K) =>
    (field: string, value: string) =>
      setProfile(prev => ({ ...prev, [section]: { ...(prev[section] as object), [field]: value } }));

  const products = normalizeProductItems(profile.products);
  const productDocumentUpload = useEnterpriseProductDocuments({
    products, setProfile, productImportConfirming, maxDocuments: MAX_PRODUCT_DOCUMENTS,
  });
  const visibleProducts = products.slice((productPage - 1) * PAGE_SIZE, productPage * PAGE_SIZE);
  const assetStats = productAssetStats(products);
  const completions = sectionCompletion(profile);
  const profileCompleteness = enterpriseProfileCompleteness(profile);
  const approvedFaqCount = (profile.faq ?? []).filter(item => item.approvedForAuto && item.question.trim() && item.answer.trim()).length;
  const customerServiceEnabled = profile.customerService?.enabled === true;
  const customerServiceEnabledAt = Date.parse(profile.customerService?.enabledAt || '');
  const customerServiceObservationFinished = customerServiceEnabled
    && Number.isFinite(customerServiceEnabledAt)
    && Date.now() - customerServiceEnabledAt >= 3 * 24 * 60 * 60 * 1000;
  const partialAutoReplyAuthorized = customerServiceObservationFinished && profile.customerService?.partialAutoReplyEnabled === true;
  const canAutoReply = partialAutoReplyAuthorized && approvedFaqCount >= 5;
  const autoReplyBlockReason = !customerServiceEnabled
    ? '先在“我的客户”开启智能客服总开关'
    : !customerServiceObservationFinished
      ? '建议模式运行满 3 天后，才可开放部分直接回复'
      : !partialAutoReplyAuthorized
        ? '请先在“我的客户”确认是否开放部分直接回复'
        : approvedFaqCount < 5
          ? '需要先录入并审批至少 5 条常见问答'
          : '';
  const configuredAutonomy = profile.strategy?.aiAutonomy ?? 'draft';
  const effectiveAutonomy: AutonomyLevel = configuredAutonomy === 'auto' && !canAutoReply ? 'draft' : configuredAutonomy;

  useEffect(() => {
    if (!productsDeepLink) {
      setProductsDeepLinkResolution(null);
      return;
    }
    if (!profileLoaded || loading) return;
    setEnterpriseArea('facts');
    setKnowledgeView('products');
    const resolution = resolveEnterpriseProductsDeepLink(products, productsDeepLink);
    setProductsDeepLinkResolution(resolution);
    if (resolution.productIndex === null) {
      setProductPage(1);
      return;
    }
    const productIndex = resolution.productIndex;
    setProductPage(Math.floor(productIndex / PAGE_SIZE) + 1);
    setExpandedProductIndexes(previous => new Set(previous).add(productIndex));
    const timer = window.setTimeout(() => {
      document.getElementById(`enterprise-product-${productIndex}`)?.scrollIntoView({ behavior: getScrollBehavior(), block: 'center' });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [loading, productsDeepLink, profileLoaded]);

  useEffect(() => { setProductPage(page => Math.min(page, Math.max(1, Math.ceil(products.length / PAGE_SIZE)))); }, [products.length]);

  const deepLinkedProduct = productsDeepLinkResolution?.productIndex !== null
    && productsDeepLinkResolution?.productIndex !== undefined
    ? products[productsDeepLinkResolution.productIndex] || null
    : null;
  const deepLinkMaterialCount = new Set(
    (productsDeepLink?.materialIds || []).map(id => String(id || '').trim()).filter(Boolean),
  ).size;

  const applyKnowledgeProfile = (updated: AppliedProfile) => {
    setProfile(previous => {
      const next = {
        ...previous,
        company: { ...previous.company, ...(updated.company ?? {}) } as Profile['company'],
        bizRules: { ...(previous.bizRules ?? DEFAULT.bizRules!), ...(updated.bizRules ?? {}) } as BizRules,
        faq: Array.isArray(updated.faq) ? updated.faq as unknown as FaqItem[] : previous.faq,
        notifications: updated.notifications
          ? { ...(previous.notifications ?? DEFAULT.notifications!), ...updated.notifications } as NotificationSettings
          : previous.notifications,
        knowledgeIntake: updated.knowledgeIntake as Profile['knowledgeIntake'] ?? previous.knowledgeIntake,
      };
      return next;
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const openKnowledgeIntake = () => {
    window.dispatchEvent(new CustomEvent('lingshu-assistant-open', {
      detail: {
        tool: 'knowledge-intake',
        context: {
          agent: 'strategy',
          label: '智能客服规范',
          summary: '当前在企业中心的智能客服规范页，正在通过快速采集完善企业知识与接待边界。',
          suggestions: ['根据产品生成接待初稿', '从历史聊天整理真实话术', '回答 4 个接待问题'],
        },
      },
    }));
  };

  const openKnowledgeIntakeOnce = () => {
    try {
      if (localStorage.getItem(SERVICE_INTAKE_AUTO_OPEN_KEY) === 'true') return;
      localStorage.setItem(SERVICE_INTAKE_AUTO_OPEN_KEY, 'true');
    } catch { /* 浏览器禁用存储时，本次仍正常打开。 */ }
    openKnowledgeIntake();
  };

  useEffect(() => {
    try { localStorage.removeItem('lingshu:enterprise:initial-view'); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const view = (event as CustomEvent<{ view?: string }>).detail?.view;
      if (view === 'socialStrategy') { setEnterpriseArea('facts'); setKnowledgeView('company'); return; }
      if (!view || !['products', 'bizRules', 'faq', 'company', 'salesStyle', 'advanced', 'presenters', 'presenterRouting'].includes(view)) return;
      const normalized = (view === 'presenterRouting' ? 'presenters' : view) as KnowledgeView;
      setKnowledgeView(normalized);
      setEnterpriseArea(enterpriseAreaForView(normalized));
    };
    window.addEventListener('lingshu:enterprise-view', handler);
    return () => window.removeEventListener('lingshu:enterprise-view', handler);
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ profile?: AppliedProfile }>).detail;
      if (detail?.profile) applyKnowledgeProfile(detail.profile);
    };
    window.addEventListener('lingshu:knowledge-intake-applied', handler);
    return () => window.removeEventListener('lingshu:knowledge-intake-applied', handler);
  }, []);

  const setBizRule = (field: keyof BizRules, value: string) => {
    setProfile(prev => ({ ...prev, bizRules: { ...(prev.bizRules ?? DEFAULT.bizRules!), [field]: value } }));
  };


  useEffect(() => {
    if (localStorage.getItem('lingshu:enterprise:highlight-autonomy') !== 'auto') return;
    localStorage.removeItem('lingshu:enterprise:highlight-autonomy');
    setEnterpriseArea('service');
    setKnowledgeView('advanced');
    setAutonomyHighlight(true);
    window.setTimeout(() => document.getElementById('ai-autonomy')?.scrollIntoView({ behavior: getScrollBehavior(), block: 'center' }), 80);
    window.setTimeout(() => setAutonomyHighlight(false), 3200);
  }, [loading]);

  useEffect(() => {
    if (localStorage.getItem('lingshu:enterprise:highlight-notifications') !== 'true') return;
    localStorage.removeItem('lingshu:enterprise:highlight-notifications');
    setEnterpriseArea('service');
    setKnowledgeView('advanced');
    setNotificationsHighlight(true);
    window.setTimeout(() => document.getElementById('notifications')?.scrollIntoView({ behavior: getScrollBehavior(), block: 'center' }), 120);
    window.setTimeout(() => setNotificationsHighlight(false), 3200);
  }, [loading]);

  useEffect(() => {
    if (localStorage.getItem('lingshu:enterprise:highlight-biz-rules') !== 'true') return;
    localStorage.removeItem('lingshu:enterprise:highlight-biz-rules');
    setEnterpriseArea('service');
    setKnowledgeView('bizRules');
    setBizRulesHighlight(true);
    window.setTimeout(() => document.getElementById('biz-rules')?.scrollIntoView({ behavior: getScrollBehavior(), block: 'center' }), 80);
    window.setTimeout(() => setBizRulesHighlight(false), 3200);
  }, [loading]);

  const setAutonomy = (value: AutonomyLevel) => {
    if (value === 'auto' && !canAutoReply) {
      window.alert(autoReplyBlockReason || '当前暂不能开放直接回复');
      return;
    }
    if (value === 'auto' && profile.strategy?.aiAutonomy !== 'auto') {
      const ok = window.confirm(`开启后，只有同时满足以下条件的标准问答才会自动发送：\n\n${AUTO_REPLY_SCOPE.map(item => `• ${item}`).join('\n')}\n\n物流、目录、售后、报价、付款和交期等仍需你确认。`);
      if (!ok) return;
    }
    setProfile(prev => ({ ...prev, strategy: { ...prev.strategy, aiAutonomy: value } }));
  };

  const addHandoffKeyword = () => {
    const keyword = handoffKeywordInput.trim();
    if (!keyword) return;
    setProfile(prev => {
      const current = prev.handoffRules ?? DEFAULT.handoffRules!;
      const keywords = Array.from(new Set([...current.keywords, keyword])).slice(0, 20);
      return { ...prev, handoffRules: { ...current, keywords } };
    });
    setHandoffKeywordInput('');
  };

  const removeHandoffKeyword = (keyword: string) => {
    setProfile(prev => {
      const current = prev.handoffRules ?? DEFAULT.handoffRules!;
      const keywords = current.keywords.filter(item => item !== keyword);
      return { ...prev, handoffRules: { ...current, keywords: keywords.length ? keywords : [...DEFAULT.handoffRules!.keywords] } };
    });
  };

  const setMissStreakToDraft = (value: 1 | 2 | 3) => {
    setProfile(prev => ({
      ...prev,
      handoffRules: { ...(prev.handoffRules ?? DEFAULT.handoffRules!), missStreakToDraft: value },
    }));
  };

  const setNegativeSentiment = (value: boolean) => {
    setProfile(prev => ({
      ...prev,
      handoffRules: { ...(prev.handoffRules ?? DEFAULT.handoffRules!), negativeSentiment: value },
    }));
  };

  const handleSave = async () => {
    if (!profileLoaded) {
      setSaveError('企业资料尚未成功加载，请刷新后重试');
      return;
    }
    setSaving(true);
    setSaved(false);
    setSaveError('');
    try {
      const profileToSave = normalizeEnterpriseProfile(profile);
      const response = await fetch('/api/overseas/enterprise/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-enterprise-save-source': 'enterprise_center',
          ...(profile.factVersion?.contentHash ? { 'If-Match': `"${profile.factVersion.contentHash}"` } : {}),
          ...authHeader(),
        },
        body: JSON.stringify(profileToSave),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || result.error || `保存失败（${response.status}）`);

      const verifyResponse = await fetch('/api/overseas/enterprise/profile', { headers: authHeader() });
      const verified = await verifyResponse.json().catch(() => ({})) as Partial<Profile> & { message?: string; error?: string };
      if (!verifyResponse.ok) throw new Error(verified.message || verified.error || '保存后校验失败');
      const expectedProducts = normalizeProductItems(profileToSave.products);
      const verifiedProducts = normalizeProductItems({ ...DEFAULT.products, ...verified.products });
      const verifiedProductNames = new Set(verifiedProducts.map(item => item.name.trim()));
      if (expectedProducts.length !== verifiedProducts.length || expectedProducts.some(item => !verifiedProductNames.has(item.name.trim()))) {
        throw new Error('产品资料保存后校验失败，请重试');
      }
      const confirmedProfile = normalizeEnterpriseProfile(verified as Profile);
      persistedProfileRef.current = profileSnapshot(confirmedProfile);
      setProfile(confirmedProfile);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (loading || saving || !hasUnsavedChanges || saveError) return;
    const timer = window.setTimeout(() => { void handleSave(); }, 900);
    return () => window.clearTimeout(timer);
  }, [profile, loading, saving, hasUnsavedChanges, saveError]);

  const importOrderCsv = async (file: File | null) => {
    if (!file) return;
    setOrderImporting(true);
    setOrderImportMessage('');
    try {
      const csv = await file.text();
      const result = await fetch('/api/overseas/enterprise/orders/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ csv }),
      }).then(r => r.json());
      if (result.error) throw new Error(result.error);
      setOrderImportMessage(`已导入 ${result.imported} 条真实订单${result.skipped ? `，跳过 ${result.skipped} 条无效行` : ''}`);
    } catch (e) {
      setOrderImportMessage(e instanceof Error ? e.message : '订单导入失败，请检查 CSV 字段');
    } finally {
      setOrderImporting(false);
    }
  };

  const importProductSheet = async (file: File | null) => {
    if (!file || productDocumentUpload.isUploading()) return;
    setProductImporting(true);
    setProductImportMessage('');
    try {
      const { pending, message } = await prepareEnterpriseProductImport(file, profile.products.categories);
      setPendingProductImport(pending);
      setProductImportMessage(message);
    } catch (error) {
      setProductImportMessage(error instanceof Error ? error.message : '产品导入失败，请检查 CSV/XLSX 字段');
    } finally {
      setProductImporting(false);
    }
  };

  const confirmProductImport = async () => {
    if (!pendingProductImport || productImportConfirming) return;
    if (productDocumentUpload.isUploading()) {
      setProductImportMessage('请等待资质凭证上传结果确认后再导入产品');
      return;
    }
    setProductImportConfirming(true);
    try {
      const result = await confirmEnterpriseProductImportAssets(
        pendingProductImport,
        { upload: uploadProductEvidence, importUrl: importProductEvidenceUrl },
        setPendingProductImport,
      );
      if (result.status === 'blocked') {
        setPendingProductImport(result.pending);
        setProductImportMessage(result.message);
        return;
      }
      const incoming = result.pending.products;
      setProfile(prev => {
        const existing = normalizeProductItems(prev.products);
        const next = [...existing];
        for (const item of incoming) {
          const sku = item.sku?.trim();
          const index = sku ? next.findIndex(product => product.sku?.trim() === sku) : -1;
          if (index >= 0) next[index] = { ...next[index], ...item };
          else next.push(item);
        }
        setProductPage(Math.max(1, Math.ceil(next.length / PAGE_SIZE)));
        return { ...prev, products: { ...prev.products, items: next } };
      });
      setProductImportMessage(`已导入 ${incoming.length} 个产品${result.pending.skippedRows > 0 ? `，跳过 ${result.pending.skippedRows} 行` : ''}，点击右上角保存后生效`);
      result.pending.unassignedImages.forEach(image => URL.revokeObjectURL(image.url));
      result.pending.assignedImages.forEach(image => URL.revokeObjectURL(image.url));
      setPendingProductImport(null);
    } catch (error) {
      setProductImportMessage(error instanceof Error ? error.message : '产品导入确认失败，请核对已上传资产');
    } finally {
      setProductImportConfirming(false);
    }
  };

  const closeProductImport = () => {
    if (productImportConfirming) return;
    pendingProductImport?.unassignedImages.forEach(image => URL.revokeObjectURL(image.url));
    pendingProductImport?.assignedImages.forEach(image => URL.revokeObjectURL(image.url));
    setPendingProductImport(null);
  };

  const updateProduct = (index: number, patch: Partial<ProductItem>) => {
    setProfile(prev => {
      const items = normalizeProductItems(prev.products).map((item, i) => i === index ? { ...item, ...patch } : item);
      return { ...prev, products: { ...prev.products, items } };
    });
  };

  const addProduct = () => {
    if (productDocumentUpload.isUploading()) return;
    const nextIndex = products.length;
    setProductPage(Math.max(1, Math.ceil((nextIndex + 1) / PAGE_SIZE)));
    setExpandedProductIndexes(previous => new Set(previous).add(nextIndex));
    setProfile(prev => {
      const items = normalizeProductItems(prev.products);
      return { ...prev, products: { ...prev.products, items: [...items, emptyProduct(items.length)] } };
    });
  };

  const removeProduct = (index: number) => {
    if (productDocumentUpload.isUploading()) return;
    setExpandedProductIndexes(previous => new Set(
      Array.from(previous)
        .filter(itemIndex => itemIndex !== index)
        .map(itemIndex => itemIndex > index ? itemIndex - 1 : itemIndex),
    ));
    setProfile(prev => {
      const items = normalizeProductItems(prev.products)
        .filter((_, i) => i !== index)
        .map((item, i) => ({ ...item, name: item.name || `产品${i + 1}` }));
      return { ...prev, products: { ...prev.products, items } };
    });
  };

  const removeProductDocument = (index: number, assetIndex: number) => {
    setProfile(prev => {
      const items = normalizeProductItems(prev.products);
      items[index] = { ...items[index], documents: (items[index]?.documents ?? []).filter((_, i) => i !== assetIndex) };
      return { ...prev, products: { ...prev.products, items } };
    });
  };

  const openProductMaterials = (product: ProductItem) => {
    const params = productMaterialLibraryParams(product);
    const detail = { page: 'socialInspiration', view: 'library', ...params };
    window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail }));
    const url = new URL(window.location.href);
    url.searchParams.set('view', 'library');
    url.searchParams.set('productId', params.productId);
    url.searchParams.set('productRef', params.productRef);
    window.history.replaceState({ ...window.history.state, productionDetail: detail }, '', url);
  };

  const openMaterialLibrary = () => {
    window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'socialInspiration', view: 'library' } }));
  };

  const openCompletenessTodo = (todo: EnterpriseCompletenessTodo) => {
    setEnterpriseArea('facts');
    if (todo.kind === 'product_image' && todo.productIndex !== undefined && products[todo.productIndex]) {
      openProductMaterials(products[todo.productIndex]!);
      return;
    }
    setKnowledgeView(todo.view);
    if (todo.productIndex !== undefined) {
      setProductPage(Math.floor(todo.productIndex / PAGE_SIZE) + 1);
      setExpandedProductIndexes(previous => new Set(previous).add(todo.productIndex!));
    }
    window.setTimeout(() => {
      const target = todo.kind === 'market'
        ? document.getElementById('enterprise-language-settings')
        : document.getElementById(`enterprise-product-${todo.productIndex ?? 0}-${todo.kind}`)
          || document.getElementById(`enterprise-product-${todo.productIndex ?? 0}`);
      target?.scrollIntoView({ behavior: getScrollBehavior(), block: 'center' });
      target?.querySelector<HTMLElement>('input,button,textarea,select')?.focus({ preventScroll: true });
    }, 100);
  };

  const marketSection = (
    <KnowledgeCard id="enterprise-language-settings" highlight={languageSettingsHighlight} icon={Globe2} title="目标市场与语言" purpose="决定 AI 说什么语言、按哪个时区建议联系时间" completed={completions.market}>
      <div className="space-y-4">
        <Field label="主要市场">
          <OptionSelector value={profile.company.mainMarkets} options={MARKET_OPTIONS} onChange={value => set('company')('mainMarkets', value)} placeholder="选择目标市场" />
        </Field>
        <Field label="主要语言">
          <OptionSelector value={profile.company.primaryLanguages ?? ''} options={LANGUAGE_OPTIONS} onChange={value => set('company')('primaryLanguages', value)} placeholder="选择主要语言" />
        </Field>
      </div>
    </KnowledgeCard>
  );

  const companySection = (
    <KnowledgeCard icon={Building2} title="企业基本资料" purpose="供内容、客服和数字员工识别企业身份" completed={completions.company} stat={completions.company ? '基础资料已填写' : '请填写名称、行业和企业类型'}>
      <div className="grid grid-cols-2 gap-4">
        <Field label="公司名称">
          <Input className={inputCls} value={profile.company.name} onChange={e => set('company')('name', e.target.value)} placeholder="示例贸易有限公司" />
        </Field>
        <Field label="行业类目">
          <OptionSelector value={profile.company.industry} options={CATEGORY_OPTIONS} onChange={value => set('company')('industry', value)} placeholder="选择行业类目" />
        </Field>
        <Field label="企业类型">
          <OptionSelector value={profile.company.companyType ?? ''} options={COMPANY_TYPE_OPTIONS} multiple={false} onChange={value => set('company')('companyType', value)} placeholder="选择企业类型" />
        </Field>
      </div>
    </KnowledgeCard>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="text-text-muted animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-white" data-lingshu-guide="enterprise-center">
      {weeklyFactTarget&&<section id="weekly-enterprise-fact-target" tabIndex={-1} data-exception={weeklyFactTarget.exceptionId} data-consumer={weeklyFactTarget.consumerTaskId} data-package={weeklyFactTarget.packageId} data-version={weeklyFactTarget.packageVersion} className="mx-4 mt-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-xs text-emerald-950 sm:mx-6"><p className="font-black">本周任务需要补齐企业事实</p><p className="mt-1">补齐请求 {weeklyFactTarget.exceptionId} · 原任务 {weeklyFactTarget.consumerTaskId} · 发布项 {weeklyFactTarget.publicationTaskId} · 周包 {weeklyFactTarget.packageId} v{weeklyFactTarget.packageVersion}</p><p className="mt-1">冻结企业版本 {weeklyFactTarget.enterpriseProfileRef?`${weeklyFactTarget.enterpriseProfileRef.id} v${weeklyFactTarget.enterpriseProfileRef.version}`:'原周包未冻结企业资料版本'} · 事实版本 {weeklyFactTarget.factRefs.map(ref=>`${ref.id} v${ref.version}`).join('、')||'缺少冻结事实引用'}</p><p className="mt-1">需核对字段：公司名称、产品类目、具体产品名称。保存后仍由原周任务复核事实版本，不会在本页直接解锁生产。</p><button type="button" className="mt-2 rounded border border-emerald-400 bg-white px-3 py-1.5 font-bold" onClick={()=>{setEnterpriseArea('facts');setKnowledgeView('products');}}>查看并补齐产品字段</button></section>}
      <div className="shrink-0 border-b border-border bg-surface px-4 pt-5 sm:px-6">
        <h1 className="sr-only">企业知识库</h1>
        <Tabs activeKey={enterpriseArea} onChange={key => {
          const area = key as EnterpriseArea;
          setEnterpriseArea(area);
          setKnowledgeView(area === 'facts' ? 'company' : area === 'appearance' ? 'presenters' : 'bizRules');
          if (area === 'service') openKnowledgeIntakeOnce();
        }} tabBarExtraContent={enterpriseArea === 'appearance' ? undefined : { right: <Button type="primary" onClick={handleSave} loading={saving} disabled={!hasUnsavedChanges}
          icon={saveError ? <X size={14} /> : !hasUnsavedChanges ? <CheckCircle2 size={14} /> : <Save size={14} />}>
          {saveError ? '重试保存' : !hasUnsavedChanges ? '已保存' : '保存资料'}
        </Button> }} items={[
          { key: 'facts', label: '企业真实资料', icon: <Building2 size={16} /> },
          { key: 'appearance', label: '人物与出镜', icon: <Users size={16} /> },
          { key: 'service', label: '智能客服规范', icon: <MessageSquare size={16} /> },
        ]} />
        {saveError && <Alert className="mb-3" type="error" showIcon title={saveError} />}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1440px] space-y-5 px-4 py-5 sm:px-6">
          {enterpriseArea === 'facts' && <section className="rounded-lg border border-emerald-200 bg-surface-2 p-4" aria-label="企业资料完整度">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="text-2xl font-semibold tabular-nums text-accent">{profileCompleteness.percentage}%</span>
                <div>
                  <h2 className="text-sm font-semibold text-text-primary">企业资料完整度</h2>
                  <p className="mt-1 text-xs text-text-muted">产品图、价格、证书和市场信息统一供内容、客服、报价、投放与数字员工使用。</p>
                </div>
              </div>
              <span className="text-xs font-bold text-emerald-800">已完成 {profileCompleteness.completed}/{profileCompleteness.total}</span>
            </div>
            <LsGradientProgress percent={profileCompleteness.percentage} showInfo={false} className="mt-3" />
            {profileCompleteness.todos.length > 0 ? <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {profileCompleteness.todos.map(todo => <button key={todo.id} type="button" onClick={() => openCompletenessTodo(todo)} className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white px-3 py-2.5 text-left hover:border-amber-300 hover:bg-amber-50">
                <span className="min-w-0"><span className="block text-xs font-semibold text-amber-900">{todo.label}</span><span className="mt-0.5 block truncate text-[11px] text-text-muted">{todo.description}</span></span><ArrowRight size={14} className="shrink-0 text-amber-700" />
              </button>)}
            </div> : <p className="mt-3 rounded-lg bg-emerald-100/70 px-3 py-2 text-xs font-bold text-emerald-800">关键资料已补齐，所有 Agent 将读取同一已确认版本。</p>}
          </section>}
          {enterpriseArea !== 'appearance' && <Tabs activeKey={knowledgeView} onChange={key => setKnowledgeView(key as KnowledgeView)}
            items={(enterpriseArea === 'facts' ? FACT_VIEWS : SERVICE_VIEWS).map(item => {
              const Icon = KNOWLEDGE_VIEW_ICONS[item.id];
              return { key: item.id, label: item.label, icon: <Icon size={16} /> };
            })} />}


          {enterpriseArea === 'facts' && <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-4">
            <div className="flex items-start gap-3">
              <Building2 size={15} className="mt-0.5 shrink-0 text-emerald-700" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-text-primary">已保存资料可供 AI 使用</p>
              </div>
            </div>
          </div>}

          {knowledgeView === 'company' && <>{marketSection}{companySection}</>}
          {knowledgeView === 'presenters' && <EnterprisePresenters />}

          {knowledgeView === 'products' && <EnterpriseProductPanel
            profileProducts={profile.products}
            products={products}
            visibleProducts={visibleProducts}
            completed={completions.products}
            assetStats={assetStats}
            productsDeepLink={productsDeepLink}
            productsDeepLinkResolved={Boolean(productsDeepLinkResolution)}
            deepLinkedProduct={deepLinkedProduct}
            deepLinkMaterialCount={deepLinkMaterialCount}
            openProductMaterials={openProductMaterials}
            openMaterialLibrary={openMaterialLibrary}
            onProductFieldChange={set('products')}
            productImporting={productImporting}
            productImportMessage={productImportMessage}
            productDocumentMessage={productDocumentUpload.message}
            productDocumentUploading={productDocumentUpload.uploading}
            importProductSheet={importProductSheet}
            addProduct={addProduct}
            productPage={productPage}
            pageSize={PAGE_SIZE}
            expandedProductIndexes={expandedProductIndexes}
            setExpandedProductIndexes={setExpandedProductIndexes}
            removeProduct={removeProduct}
            updateProduct={updateProduct}
            addProductDocuments={productDocumentUpload.addDocuments}
            removeProductDocument={removeProductDocument}
            maxProductDocuments={MAX_PRODUCT_DOCUMENTS}
            setProductPage={setProductPage}
          />}

          {knowledgeView === 'bizRules' && (
            <EnterpriseBizRulesPanel
              bizRules={profile.bizRules}
              products={products}
              completed={completions.bizRules}
              highlighted={bizRulesHighlight}
              onChange={setBizRule}
            />
          )}

          {knowledgeView === 'faq' && <EnterpriseFaqPanel
            profile={profile}
            completed={completions.faq}
            approvedFaqCount={approvedFaqCount}
            faqPacks={faqPacks}
            recommendedPackIndustry={recommendedPackIndustry}
            faqPacksOpen={faqPacksOpen}
            setFaqPacksOpen={setFaqPacksOpen}
            openPackId={openPackId}
            setOpenPackId={setOpenPackId}
            selectedQuestionsForPack={selectedQuestionsForPack}
            togglePackQuestion={togglePackQuestion}
            importFaqPack={importFaqPack}
            packImporting={packImporting}
            structureLegacyFaq={structureLegacyFaq}
            faqStructuring={faqStructuring}
            faqPreview={faqPreview}
            importFaqPreview={importFaqPreview}
            setFaqPreview={setFaqPreview}
            addFaq={addFaq}
            visibleFaqs={visibleFaqs}
            updateFaq={updateFaq}
            removeFaq={removeFaq}
            faqPage={faqPage}
            faqItems={faqItems}
            pageSize={PAGE_SIZE}
            setFaqPage={setFaqPage}
          />}

          {knowledgeView === 'salesStyle' && (
            <EnterpriseSalesStylePanel styleProfile={profile.salesStyleProfile} controller={salesStyle} />
          )}

          {knowledgeView === 'advanced' && (
          <section className="bg-white">
            <div className="divide-y divide-border">
              <EnterpriseAiAutonomySection
                autonomyHighlight={autonomyHighlight}
                effectiveAutonomy={effectiveAutonomy}
                configuredAutonomy={configuredAutonomy}
                customerServiceEnabled={customerServiceEnabled}
                customerServiceObservationFinished={customerServiceObservationFinished}
                partialAutoReplyAuthorized={partialAutoReplyAuthorized}
                canAutoReply={canAutoReply}
                autoReplyBlockReason={autoReplyBlockReason}
                approvedFaqCount={approvedFaqCount}
                setAutonomy={setAutonomy}
              />
              <EnterpriseHandoffSafetySection
                handoffRules={profile.handoffRules ?? DEFAULT.handoffRules!}
                handoffKeywordInput={handoffKeywordInput}
                setHandoffKeywordInput={setHandoffKeywordInput}
                addHandoffKeyword={addHandoffKeyword}
                removeHandoffKeyword={removeHandoffKeyword}
                setMissStreakToDraft={setMissStreakToDraft}
                setNegativeSentiment={setNegativeSentiment}
              />
              <EnterpriseNotificationSettings
                notifications={profile.notifications ?? DEFAULT.notifications!}
                highlighted={notificationsHighlight}
                onChange={update => setProfile(prev => ({
                  ...prev,
                  notifications: update(prev.notifications ?? DEFAULT.notifications!),
                }))}
              />
              <SupportAccessControl />
            </div>

            <EnterpriseAdditionalSettings
              profile={profile}
              orderImporting={orderImporting}
              orderImportMessage={orderImportMessage}
              onFieldChange={(section, field, value) => set(section)(field, value)}
              onKnowledgeChange={value => setProfile(prev => ({ ...prev, knowledge: value }))}
              onImportOrderCsv={importOrderCsv}
            />
          </section>
          )}

          {pendingProductImport && (
            <EnterpriseProductImportReviewModal
              pending={pendingProductImport}
              confirming={productImportConfirming}
              onClose={closeProductImport}
              onConfirm={confirmProductImport}
              onRemoveProduct={index => {
                if (productImportConfirming) return;
                setPendingProductImport(current => current ? removePendingImportedProduct(current, index) : null);
              }}
            />
          )}

          <div className="h-4" />
        </div>
      </div>
    </div>
  );
}
