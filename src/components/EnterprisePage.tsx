import { getScrollBehavior } from "../lib/usePrefersReducedMotion";
import { useState, useEffect } from 'react';
import { Alert, Button, Tabs } from 'antd';
import EnterpriseKnowledgeFields from './enterprise/EnterpriseKnowledgeFields';
import { KNOWLEDGE_AREAS, KNOWLEDGE_VIEWS, enterpriseAreaForView, normalizeKnowledgeView, type KnowledgeView, type EnterpriseArea } from './enterprise/enterpriseKnowledgeNavigation';
import EnterprisePresenters from './enterprise/EnterprisePresenters';
import EnterpriseNotificationSettings from './enterprise/EnterpriseNotificationSettings';
import EnterpriseFaqPanel from './enterprise/EnterpriseFaqPanel';
import EnterpriseProductPanel from './enterprise/EnterpriseProductPanel';
import EnterpriseProductImportReviewModal from './enterprise/EnterpriseProductImportReviewModal';
import EnterpriseBizRulesPanel from './enterprise/EnterpriseBizRulesPanel';
import EnterpriseCompanyFactsPanel from './enterprise/EnterpriseCompanyFactsPanel';
import EnterpriseSalesStylePanel from './enterprise/EnterpriseSalesStylePanel';
import { useEnterpriseSalesStyle } from './enterprise/useEnterpriseSalesStyle';
import { useEnterpriseFaq } from './enterprise/useEnterpriseFaq';
import { useEnterpriseProfileLifecycle } from './enterprise/useEnterpriseProfileLifecycle';
import { DEFAULT } from './enterprise/enterpriseProfileState';
import { AUTO_REPLY_SCOPE, EnterpriseAiAutonomySection, EnterpriseHandoffSafetySection } from './enterprise/EnterpriseCustomerServiceSettings';
import { Building2, Package, Megaphone, BookOpen, Save, CheckCircle2, Loader2, MessageSquare, Plus, X, Image, Bell, ChevronLeft, Globe2, ShieldCheck, ArrowRight, Users, type LucideIcon } from 'lucide-react';
import { authHeader } from '../lib/auth';
import { completeDemoStep } from '../lib/demoProgress';
import { prepareEnterpriseProductImport, removePendingImportedProduct, type PendingProductImport } from './enterprise/enterpriseProductImportPreparation';
import { confirmEnterpriseProductImportAssets } from './enterprise/enterpriseProductImportConfirmation';
import { useEnterpriseProductDocuments } from './enterprise/useEnterpriseProductDocuments';
import {importProductEvidenceUrl,uploadProductEvidence} from '../lib/enterpriseProductAssetUpload';
import SupportAccessControl from './SupportAccessControl';
import EnterpriseProductImportCard from './EnterpriseProductImportCard';
import type { AppliedProfile } from './enterprise/KnowledgeIntakePanel';
import {readWeeklyEnterpriseFactTarget} from '../lib/weeklyEnterpriseFactNavigation';
import type { ProductItem, AutonomyLevel, BizRules, FaqItem, NotificationSettings, Profile } from './enterprise/enterpriseProfileTypes';
import { emptyProduct, normalizeProductItems } from './enterprise/enterpriseProfileNormalization';
import { enterpriseProfileCompleteness, productAssetStats, productCreativeMaterialCount, sectionCompletion, type EnterpriseCompletenessTodo } from './enterprise/enterpriseProfileCompleteness';
export { normalizeEnterpriseProfile } from './enterprise/enterpriseProfileNormalization';
export { enterpriseProfileCompleteness, sectionCompletion } from './enterprise/enterpriseProfileCompleteness';
export { profileSnapshot } from './enterprise/enterpriseProfileState';


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



const PAGE_SIZE = 5;

function advisorInitialEnterpriseView(): KnowledgeView {
  try {
    if (new URLSearchParams(window.location.search).get('arkVerification') === 'complete') return 'presenters';
    return normalizeKnowledgeView(localStorage.getItem('lingshu:enterprise:initial-view'));
  } catch { return 'company'; }
}


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
  const [, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
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
    selectedQuestionsForPack, togglePackQuestion, importFaqPack, reloadFaqPacks,
  } = useEnterpriseFaq({ profile, setProfile, setSaveError, pageSize: PAGE_SIZE });
  const { saving, loading, profileLoaded, apiStatus, hasUnsavedChanges, handleSave, acceptSavedPatch } = useEnterpriseProfileLifecycle({
    profile, setProfile, saveError, setSaveError, setSaved, acceptLoadedPacks, autoSave: false,
  });

  useEffect(() => {
    if (window.sessionStorage.getItem('lingshu:enterprise-focus') !== 'language-settings') return;
    window.sessionStorage.removeItem('lingshu:enterprise-focus');
    setEnterpriseArea('market');
    setKnowledgeView('market');
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
      setEnterpriseArea('experience');
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
    setEnterpriseArea('products');
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


  useEffect(() => {
    try { localStorage.removeItem('lingshu:enterprise:initial-view'); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const view = (event as CustomEvent<{ view?: string }>).detail?.view;
      if (!view) return;
      const normalized = normalizeKnowledgeView(view);
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
    setEnterpriseArea('settings');
    setKnowledgeView('advanced');
    setAutonomyHighlight(true);
    window.setTimeout(() => document.getElementById('ai-autonomy')?.scrollIntoView({ behavior: getScrollBehavior(), block: 'center' }), 80);
    window.setTimeout(() => setAutonomyHighlight(false), 3200);
  }, [loading]);

  useEffect(() => {
    if (localStorage.getItem('lingshu:enterprise:highlight-notifications') !== 'true') return;
    localStorage.removeItem('lingshu:enterprise:highlight-notifications');
    setEnterpriseArea('settings');
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
          const id = item.id?.trim();
          const index = id ? next.findIndex(product => product.id?.trim() === id)
            : sku ? next.findIndex(product => product.sku?.trim() === sku) : -1;
          if (index >= 0) {
            const previous = next[index];
            // A migration bundle may carry a new main photo but no legacy
            // attachment list. Keep existing account assets instead of clearing
            // them when a matching product is imported again.
            next[index] = { ...previous, ...item,
              images: item.images?.length ? [...(previous.images || []), ...item.images] : previous.images || [],
              packagingImages: [...(previous.packagingImages || []), ...(item.packagingImages || [])],
            };
          }
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
    setEnterpriseArea(enterpriseAreaForView(todo.view));
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


  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="text-text-muted animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-white" data-lingshu-guide="enterprise-center">
      {weeklyFactTarget && <section className="mx-6 mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm" id="weekly-enterprise-fact-target">
        <p className="font-semibold">一项周任务需要补充企业或产品资料</p><p className="mt-1 text-xs text-text-secondary">补齐并保存后，由原任务重新核对并继续执行。</p>
        <Button className="mt-2" size="small" onClick={() => { setEnterpriseArea('products'); setKnowledgeView('products'); }}>查看产品档案</Button>
      </section>}

      <div className="shrink-0 border-b border-border bg-surface px-4 pt-5 sm:px-6">
        <h1 className="sr-only">企业知识库</h1>
        <Tabs activeKey={enterpriseArea} onChange={key => {
          const area = key as EnterpriseArea;
          setEnterpriseArea(area);
          setKnowledgeView(KNOWLEDGE_VIEWS[area][0]!.id);
        }} tabBarExtraContent={{ right: <div className="flex items-center gap-2">
          <Button onClick={() => { setEnterpriseArea(enterpriseArea === 'settings' || enterpriseArea === 'appearance' ? 'facts' : 'settings'); setKnowledgeView(enterpriseArea === 'settings' || enterpriseArea === 'appearance' ? 'company' : 'advanced'); }}>
            {enterpriseArea === 'settings' || enterpriseArea === 'appearance' ? '返回知识库' : '客服设置'}
          </Button>
          <Button type="primary" onClick={handleSave} loading={saving} disabled={!hasUnsavedChanges}
            icon={saveError ? <X size={16} /> : !hasUnsavedChanges ? <CheckCircle2 size={16} /> : <Save size={16} />}>
            {saveError ? '重试保存' : !hasUnsavedChanges ? '已保存' : '保存资料'}
          </Button>
        </div> }} items={KNOWLEDGE_AREAS.map(({key, label}) => ({key, label}))} />
        {hasUnsavedChanges && <p className="pb-3 text-xs text-amber-700">有未保存的修改，确认后点击“保存资料”。切换分类会保留本页草稿。</p>}
        {saveError && <Alert className="mb-3" type="error" showIcon title={saveError} />}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1440px] space-y-5 px-4 py-5 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-text-secondary">{KNOWLEDGE_AREAS.find(area => area.key === enterpriseArea)?.description || '保留原有功能与记录，完成后可返回企业知识库。'}</p>
            {enterpriseArea === 'experience' && <Button size="small" onClick={openKnowledgeIntake}>整理已有资料</Button>}
          </div>
          {KNOWLEDGE_VIEWS[enterpriseArea].length > 1 && <Tabs activeKey={knowledgeView} onChange={key => setKnowledgeView(key as KnowledgeView)} items={KNOWLEDGE_VIEWS[enterpriseArea].map(item => ({ key: item.id, label: item.label }))} />}
          <EnterpriseKnowledgeFields view={knowledgeView} profile={profile} onChange={(section, field, value) => {
            if (field === '__knowledge') setProfile(prev => ({ ...prev, knowledge: value }));
            else set(section)(field, value);
          }} />
          {knowledgeView === 'company' && (
            <EnterpriseCompanyFactsPanel
              company={profile.company}
              marketCompleted={completions.market}
              companyCompleted={completions.company}
              highlighted={languageSettingsHighlight}
              onFieldChange={set('company')}
            />
          )}
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
            onPackSaved={acceptSavedPatch}
            reloadFaqPacks={reloadFaqPacks}
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
