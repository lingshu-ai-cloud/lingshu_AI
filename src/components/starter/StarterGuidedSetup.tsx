import { useMemo, useState } from 'react';
import {
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileUp,
  Globe2,
  Languages,
  Loader2,
  PackageOpen,
  Sparkles,
  UserRound,
  Users2,
  WalletCards,
} from 'lucide-react';

export const GUIDED_SETUP_PLATFORMS = [
  { id: 'tiktok', label: 'TikTok' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'facebook', label: 'Facebook' },
] as const;

export type GuidedSetupPlatform = typeof GUIDED_SETUP_PLATFORMS[number]['id'];
export type GuidedPresenter = 'brand_spokesperson' | 'product_expert' | 'none';

export interface GuidedPlanLimits {
  contentArtifactCountPerCycle: number;
  primaryPlatformCount: number;
  budgetCnyPerCycle: number;
  contentBudgetCnyPerCycle?: number;
}

export interface GuidedSetupDraft {
  companyName: string;
  brandName: string;
  industry: string;
  primaryBusiness: string;
  targetMarkets: string;
  customerProfile: string;
  productSource: string;
  focusProduct: string;
  presenter: GuidedPresenter;
  selectedPlatforms: GuidedSetupPlatform[];
  accountWeeklyOutput: Partial<Record<GuidedSetupPlatform, number>>;
  primaryLanguage: string;
  weeklyMasterCount: number;
  constraints: string;
}

export interface GuidedRecommendedPlan {
  products: string[];
  primaryProduct: string;
  platforms: Array<{ id: GuidedSetupPlatform; label: string; accountName: string; weeklyOutput: number }>;
  weeklyMasterCount: number;
  weeklyVariantCount: number;
  estimatedCostCny: { min: number; max: number };
  budgetCny: number;
  deliveryDays: number;
  language: string;
  market: string;
}

const PRODUCT_HEADER_PATTERN = /^(?:product(?:\s*name)?|name|sku|产品|产品名称|商品名称)$/i;
const PRODUCT_COLUMN_HEADER_PATTERN = /^(?:product(?:\s*name)?|name|产品|产品名称|商品名称)$/i;

function limitedInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function splitDelimitedLine(value: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"') {
      if (quoted && value[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function productColumnValues(value: string): string[] | null {
  const lines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  for (const delimiter of ['\t', ',', '，', ';', '；']) {
    const headers = splitDelimitedLine(lines[0], delimiter);
    const productIndex = headers.findIndex(header => PRODUCT_COLUMN_HEADER_PATTERN.test(header.trim().replace(/^\uFEFF/, '')));
    if (headers.length < 2 || productIndex < 0) continue;
    return lines.slice(1).map(line => splitDelimitedLine(line, delimiter)[productIndex] || '');
  }
  return null;
}

export function parseImportedProducts(value: string): string[] {
  const seen = new Set<string>();
  const products: string[] = [];
  const columnValues = productColumnValues(value);
  for (const raw of columnValues ?? value.split(/[\n,，;；\t]+/)) {
    const product = raw.trim().replace(/^\uFEFF/, '').replace(/^['"]|['"]$/g, '').slice(0, 120);
    if (!product || PRODUCT_HEADER_PATTERN.test(product)) continue;
    const key = product.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    products.push(product);
    if (products.length >= 20) break;
  }
  return products;
}

export function recommendedProducts(value: string): string[] {
  return parseImportedProducts(value).slice(0, 2);
}

export function recommendedWeeklyMasterCount(limits: GuidedPlanLimits): number {
  const artifactLimit = limitedInteger(limits.contentArtifactCountPerCycle);
  const overallBudget = Math.max(0, Number.isFinite(limits.budgetCnyPerCycle) ? limits.budgetCnyPerCycle : 0);
  const contentBudget = limits.contentBudgetCnyPerCycle === undefined
    ? overallBudget
    : Math.max(0, Number.isFinite(limits.contentBudgetCnyPerCycle) ? limits.contentBudgetCnyPerCycle : 0);
  const affordableCount = Math.floor(Math.min(overallBudget, contentBudget) / 15);
  return Math.min(5, artifactLimit, affordableCount);
}

function selectedPlatforms(draft: GuidedSetupDraft, limits: GuidedPlanLimits): GuidedSetupPlatform[] {
  const allowedCount = Math.min(GUIDED_SETUP_PLATFORMS.length, limitedInteger(limits.primaryPlatformCount));
  const validPlatforms = new Set<GuidedSetupPlatform>(GUIDED_SETUP_PLATFORMS.map(item => item.id));
  return [...new Set(draft.selectedPlatforms.filter(platform => validPlatforms.has(platform)))].slice(0, allowedCount);
}

export function buildGuidedRecommendedPlan(
  draft: GuidedSetupDraft,
  limits: GuidedPlanLimits,
): GuidedRecommendedPlan {
  const products = parseImportedProducts(draft.productSource);
  const platforms = selectedPlatforms(draft, limits);
  const maximumMasterCount = recommendedWeeklyMasterCount(limits);
  const requestedMasterCount = limitedInteger(draft.weeklyMasterCount);
  const weeklyMasterCount = maximumMasterCount === 0
    ? 0
    : Math.max(1, Math.min(maximumMasterCount, requestedMasterCount || 1));
  const rawVariantCount = weeklyMasterCount * platforms.length;
  // Four-platform plans keep a stable 4–5 post cadence without cloning all five
  // masters to every account. This is the agreed 5-master / 18-version baseline.
  const defaultVariantCount = platforms.length === 4 && weeklyMasterCount === 5
    ? 18
    : rawVariantCount;
  const baseOutput = platforms.length > 0 ? Math.floor(defaultVariantCount / platforms.length) : 0;
  const extraOutput = platforms.length > 0 ? defaultVariantCount % platforms.length : 0;
  const platformPlans = platforms.map((platform, index) => {
    const requestedOutput = limitedInteger(draft.accountWeeklyOutput[platform] ?? 0);
    return {
      id: platform,
      label: GUIDED_SETUP_PLATFORMS.find(item => item.id === platform)?.label || platform,
      accountName: draft.companyName.trim() || '企业账号',
      weeklyOutput: weeklyMasterCount > 0
        ? Math.max(1, Math.min(weeklyMasterCount, requestedOutput || baseOutput + (index < extraOutput ? 1 : 0)))
        : 0,
    };
  });
  const weeklyVariantCount = platformPlans.reduce((sum, item) => sum + item.weeklyOutput, 0);
  const overallBudget = Math.max(0, limits.budgetCnyPerCycle || 0);
  const contentBudget = limits.contentBudgetCnyPerCycle === undefined
    ? overallBudget
    : Math.max(0, limits.contentBudgetCnyPerCycle || 0);
  return {
    products,
    primaryProduct: products.includes(draft.focusProduct) ? draft.focusProduct : (products[0] || ''),
    platforms: platformPlans,
    weeklyMasterCount,
    weeklyVariantCount,
    estimatedCostCny: { min: weeklyMasterCount * 10, max: weeklyMasterCount * 15 },
    budgetCny: Math.min(overallBudget, contentBudget),
    deliveryDays: 7,
    language: draft.primaryLanguage,
    market: draft.targetMarkets.trim(),
  };
}

const GUIDED_LANGUAGE_PATTERN = /^[a-z]{2}(?:-[A-Z]{2})?$/;

export function guidedSetupSubmissionReady(draft: GuidedSetupDraft, limits: GuidedPlanLimits): boolean {
  const plan = buildGuidedRecommendedPlan(draft, limits);
  return [
    draft.companyName,
    draft.brandName,
    draft.industry,
    draft.primaryBusiness,
    draft.targetMarkets,
    draft.customerProfile,
  ].every(value => Boolean(value.trim()))
    && plan.products.includes(plan.primaryProduct)
    && plan.platforms.length > 0
    && plan.weeklyMasterCount > 0
    && GUIDED_LANGUAGE_PATTERN.test(draft.primaryLanguage);
}

export function buildInitialSetupPayload(
  draft: GuidedSetupDraft,
  limits: GuidedPlanLimits,
): Record<string, unknown> {
  if (!guidedSetupSubmissionReady(draft, limits)) throw new Error('guided_setup_not_ready');
  const plan = buildGuidedRecommendedPlan(draft, limits);
  const userConstraints = draft.constraints
    .split('\n')
    .map(item => item.trim().slice(0, 240))
    .filter(Boolean)
    .slice(0, 6);
  return {
    companyName: draft.companyName.trim(),
    industry: draft.industry.trim(),
    primaryBusiness: draft.primaryBusiness.trim(),
    focusProducts: plan.primaryProduct,
    targetMarkets: draft.targetMarkets.trim(),
    customerProfile: draft.customerProfile.trim(),
    primaryPlatform: plan.platforms[0]?.id || 'tiktok',
    primaryLanguage: draft.primaryLanguage,
    constraints: userConstraints,
    operatingPlan: {
      brandName: draft.brandName.trim() || draft.companyName.trim(),
      presenter: draft.presenter,
      plannedAccounts: plan.platforms.map(item => ({
        platform: item.id,
        accountName: item.accountName,
        weeklyOutput: item.weeklyOutput,
      })),
      weeklyMasterCount: plan.weeklyMasterCount,
      weeklyVariantCount: plan.weeklyVariantCount,
      estimatedCostCny: plan.estimatedCostCny,
      deliveryDays: plan.deliveryDays,
    },
  };
}

export function buildGuidedStartInput(draft: GuidedSetupDraft, limits: GuidedPlanLimits): string {
  if (!guidedSetupSubmissionReady(draft, limits)) throw new Error('guided_setup_not_ready');
  const plan = buildGuidedRecommendedPlan(draft, limits);
  const accountSchedule = plan.platforms
    .map(item => `${item.label} 的“${item.accountName}”计划每周 ${item.weeklyOutput} 条`)
    .join('；');
  return [
    `请按我确认的新手推荐计划开始制作：主推产品“${plan.primaryProduct}”`,
    `目标市场“${plan.market}”，内容语言 ${plan.language}`,
    accountSchedule,
    `本周制作 ${plan.weeklyMasterCount} 条母版并形成 ${plan.weeklyVariantCount} 条平台版本`,
    `按选题与参考匹配、脚本和结构素材、制作与质检、交付发布包的顺序推进`,
    `计划成本范围 ¥${plan.estimatedCostCny.min}–${plan.estimatedCostCny.max}，预算上限 ¥${plan.budgetCny}，预计计划窗口 ${plan.deliveryDays} 天`,
    '账号连接、外部服务和素材权利必须在执行前按真实状态核验；缺失时暂停并明确告诉我，不得伪造完成。',
  ].join('；');
}

export function guidedSetupMissingFacts(
  draft: GuidedSetupDraft,
  limits: GuidedPlanLimits,
  startAvailable = true,
): string[] {
  const plan = buildGuidedRecommendedPlan(draft, limits);
  const missing: string[] = [];
  if (!draft.companyName.trim()) missing.push('企业名称');
  if (!draft.brandName.trim()) missing.push('品牌名称');
  if (plan.products.length === 0) missing.push('产品信息');
  else if (!plan.products.includes(plan.primaryProduct)) missing.push('主推产品');
  if (!draft.presenter) missing.push('数字人方案');
  if (!draft.industry.trim()) missing.push('所属行业');
  if (!draft.primaryBusiness.trim()) missing.push('主要业务');
  if (!draft.targetMarkets.trim()) missing.push('目标市场');
  if (!draft.customerProfile.trim()) missing.push('核心客户');
  if (!GUIDED_LANGUAGE_PATTERN.test(draft.primaryLanguage)) missing.push('内容语言');
  if (plan.platforms.length === 0) missing.push('目标平台额度');
  if (plan.weeklyMasterCount === 0) missing.push('内容或预算额度');
  if (!startAvailable) missing.push('灵小枢任务启动能力');
  return missing;
}

const STEPS = [
  { id: 'company', label: '企业与品牌', icon: Building2 },
  { id: 'products', label: '导入产品', icon: PackageOpen },
  { id: 'presenter', label: '选择数字人', icon: UserRound },
] as const;

const PRESENTER_OPTIONS: Array<{ id: GuidedPresenter; title: string; description: string }> = [
  { id: 'brand_spokesperson', title: '品牌主理人数字人', description: '适合建立品牌信任、讲企业故事和稳定出镜。' },
  { id: 'product_expert', title: '产品专家数字人', description: '适合讲产品卖点、采购问题和专业知识。' },
  { id: 'none', title: '本轮不用数字人口播', description: '优先使用产品、工厂和其他已授权素材。' },
];

const LANGUAGE_OPTIONS = [
  { id: 'en', label: 'English' },
  { id: 'de', label: 'Deutsch' },
  { id: 'fr', label: 'Français' },
  { id: 'es', label: 'Español' },
  { id: 'pt', label: 'Português' },
];

const inputClass = 'w-full rounded-lg border border-border bg-white px-3 py-2 text-sm font-normal text-text-primary outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10';

function initialDraft(limits: GuidedPlanLimits): GuidedSetupDraft {
  const platformCount = Math.max(0, Math.min(GUIDED_SETUP_PLATFORMS.length, Math.floor(Number.isFinite(limits.primaryPlatformCount) ? limits.primaryPlatformCount : 0)));
  return {
    companyName: '',
    brandName: '',
    industry: '',
    primaryBusiness: '',
    targetMarkets: '',
    customerProfile: '',
    productSource: '',
    focusProduct: '',
    presenter: 'brand_spokesperson',
    selectedPlatforms: GUIDED_SETUP_PLATFORMS.slice(0, platformCount).map(item => item.id),
    accountWeeklyOutput: {},
    primaryLanguage: 'en',
    weeklyMasterCount: recommendedWeeklyMasterCount(limits),
    constraints: '',
  };
}

function StepShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-4 rounded-xl border border-border bg-white p-4 sm:p-5">
      <h3 className="text-base font-bold text-text-primary">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-text-muted">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function StarterGuidedSetup({
  limits,
  busy,
  startAvailable,
  startUnavailableReason,
  onConfirm,
}: {
  limits: GuidedPlanLimits;
  busy: boolean;
  startAvailable: boolean;
  startUnavailableReason?: string;
  onConfirm: (payload: Record<string, unknown>, startInput: string) => Promise<unknown>;
}) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<GuidedSetupDraft>(() => initialDraft(limits));
  const [fileStatus, setFileStatus] = useState('');
  const [planAdjusting, setPlanAdjusting] = useState(false);
  const [planVisible, setPlanVisible] = useState(false);
  const products = useMemo(() => parseImportedProducts(draft.productSource), [draft.productSource]);
  const suggestedProducts = useMemo(() => recommendedProducts(draft.productSource), [draft.productSource]);
  const plan = useMemo(() => buildGuidedRecommendedPlan(draft, limits), [draft, limits]);
  const maxPlatforms = Math.max(0, Math.min(GUIDED_SETUP_PLATFORMS.length, Math.floor(Number.isFinite(limits.primaryPlatformCount) ? limits.primaryPlatformCount : 0)));
  const maxMasterCount = recommendedWeeklyMasterCount(limits);

  const companyReady = [draft.companyName, draft.brandName].every(value => Boolean(value.trim()));
  const productsReady = products.length > 0 && products.includes(draft.focusProduct);
  const currentReady = step === 0 ? companyReady : step === 1 ? productsReady : Boolean(draft.presenter);
  const missingFacts = useMemo(
    () => guidedSetupMissingFacts(draft, limits, startAvailable),
    [draft, limits, startAvailable],
  );

  const update = <K extends keyof GuidedSetupDraft>(key: K, value: GuidedSetupDraft[K]) => {
    setDraft(current => ({ ...current, [key]: value }));
  };

  const updateProductSource = (value: string) => {
    const nextProducts = parseImportedProducts(value);
    setDraft(current => ({
      ...current,
      productSource: value,
      focusProduct: nextProducts.includes(current.focusProduct) ? current.focusProduct : (nextProducts[0] || ''),
    }));
  };

  const importFile = async (file: File | null) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setFileStatus('文件超过 2MB，请改用精简后的 CSV 或 TXT。');
      return;
    }
    try {
      const content = await file.text();
      const merged = [draft.productSource, content].filter(Boolean).join('\n');
      updateProductSource(merged);
      const count = parseImportedProducts(merged).length;
      setFileStatus(`已读取 ${file.name}，当前识别 ${count} 个产品。`);
    } catch {
      setFileStatus('文件读取失败，请改用 CSV、TXT 或直接粘贴产品名称。');
    }
  };

  const togglePlatform = (platform: GuidedSetupPlatform) => {
    setDraft(current => {
      if (current.selectedPlatforms.includes(platform)) {
        if (current.selectedPlatforms.length === 1) return current;
        return { ...current, selectedPlatforms: current.selectedPlatforms.filter(item => item !== platform) };
      }
      if (current.selectedPlatforms.length >= maxPlatforms) return current;
      return { ...current, selectedPlatforms: [...current.selectedPlatforms, platform] };
    });
  };

  const advance = () => {
    if (!currentReady) return;
    if (step < STEPS.length - 1) {
      setStep(current => current + 1);
      return;
    }
    setPlanVisible(true);
    if (guidedSetupMissingFacts(draft, limits, startAvailable).length > 0) setPlanAdjusting(true);
  };

  return (
    <div>
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm font-bold text-text-primary">灵小枢带你用 3 步完成开工准备</p>
        <p className="mt-1 text-xs leading-relaxed text-text-secondary">确认企业与品牌、主推产品和数字人后，系统会给出推荐计划。只有你点击“确认计划并开始制作”，真实任务才会进入队列。</p>
      </div>

      <ol className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label="首次配置步骤">
        {STEPS.map((item, index) => {
          const Icon = item.icon;
          const active = index === step;
          const complete = index < step;
          return (
            <li key={item.id}>
              <button
                type="button"
                disabled={index > step}
                onClick={() => {
                  if (index > step) return;
                  setStep(index);
                  setPlanVisible(false);
                }}
                className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-semibold transition ${active ? 'border-accent bg-[#edf7f1] text-accent' : complete ? 'border-emerald-100 bg-white text-text-primary' : 'border-border bg-surface-2 text-text-muted'} disabled:cursor-default`}
              >
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${complete ? 'bg-accent text-white' : 'bg-white'}`}>
                  {complete ? <Check size={13} aria-hidden="true" /> : <Icon size={13} aria-hidden="true" />}
                </span>
                {item.label}
              </button>
            </li>
          );
        })}
      </ol>

      {!planVisible && step === 0 && (
        <StepShell title="先确认企业和品牌" description="这里只确认企业身份；行业、市场和客户等执行边界会在计划中单独确认，系统不会擅自补写。">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-[11px] font-semibold text-text-secondary">企业名称<input value={draft.companyName} onChange={event => update('companyName', event.target.value)} maxLength={120} className={inputClass} /></label>
            <label className="grid gap-1 text-[11px] font-semibold text-text-secondary">品牌名称<input value={draft.brandName} onChange={event => update('brandName', event.target.value)} maxLength={120} placeholder="没有独立品牌时可与企业名一致" className={inputClass} /></label>
          </div>
        </StepShell>
      )}

      {!planVisible && step === 1 && (
        <StepShell title="导入产品并确认主推产品" description="粘贴产品名，或导入 CSV / TXT。系统默认展示清单前 2 个候选，你也可以选择任何已导入产品。">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div>
              <textarea value={draft.productSource} onChange={event => updateProductSource(event.target.value)} rows={7} maxLength={4000} placeholder={'每行一个产品，例如：\n云朵泡沫卸妆蜜\n积雪草屏障修护精华\n氨基酸洁面慕斯'} className={`${inputClass} resize-y leading-relaxed`} />
              <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-text-secondary hover:bg-surface-2">
                <FileUp size={14} aria-hidden="true" />导入 CSV / TXT
                <input type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={event => void importFile(event.target.files?.[0] || null)} />
              </label>
              {fileStatus && <p className="mt-2 text-[11px] text-text-muted">{fileStatus}</p>}
            </div>
            <div className="rounded-xl border border-border bg-surface-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-bold text-text-primary">已识别 {products.length} 个产品</p>
                <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-accent">默认候选 {Math.min(2, suggestedProducts.length)} 个</span>
              </div>
              {products.length === 0 ? (
                <p className="mt-5 text-center text-xs text-text-muted">导入后，产品会在这里以选择卡展示。</p>
              ) : (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {products.map((product, index) => {
                    const selected = draft.focusProduct === product;
                    const recommended = index < 2;
                    return (
                      <button key={product} type="button" onClick={() => update('focusProduct', product)} className={`rounded-lg border p-3 text-left transition ${selected ? 'border-accent bg-emerald-50 ring-1 ring-accent/20' : 'border-border bg-white hover:border-emerald-200'}`}>
                        <div className="flex items-start justify-between gap-2"><span className="text-xs font-bold text-text-primary">{product}</span>{recommended && <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-800">默认候选</span>}</div>
                        <p className="mt-2 text-[10px] text-text-muted">{selected ? '已选为本轮主推产品' : '点击设为本轮主推产品'}</p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </StepShell>
      )}

      {!planVisible && step === 2 && (
        <StepShell title="确认本轮数字人方案" description="系统会在需要口播时使用已授权人物；选择不会代替后续的肖像授权和素材验收。">
          <div className="grid gap-3 md:grid-cols-3">
            {PRESENTER_OPTIONS.map(option => {
              const selected = draft.presenter === option.id;
              return (
                <button key={option.id} type="button" onClick={() => update('presenter', option.id)} className={`rounded-xl border p-4 text-left transition ${selected ? 'border-accent bg-emerald-50 ring-1 ring-accent/20' : 'border-border bg-white hover:border-emerald-200'}`}>
                  <div className="flex items-center justify-between gap-2"><UserRound size={18} className={selected ? 'text-accent' : 'text-text-muted'} /><span className={`flex h-5 w-5 items-center justify-center rounded-full border ${selected ? 'border-accent bg-accent text-white' : 'border-border'}`}>{selected && <Check size={12} />}</span></div>
                  <p className="mt-3 text-sm font-bold text-text-primary">{option.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-text-muted">{option.description}</p>
                </button>
              );
            })}
          </div>
        </StepShell>
      )}

      {planVisible && (
        <section role="dialog" aria-labelledby="recommended-plan-title" className="mt-4 overflow-hidden rounded-xl border border-accent/30 bg-white shadow-lg shadow-emerald-950/5">
          <div className="border-b border-border bg-[#edf7f1] px-4 py-4 sm:px-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-accent">灵小枢推荐计划</p>
            <h3 id="recommended-plan-title" className="mt-1 text-base font-bold text-text-primary">确认后立即进入真实任务队列</h3>
            <p className="mt-1 text-xs leading-relaxed text-text-secondary">系统会先核验账号连接、素材权利和外部服务；缺少必要条件时会暂停并明确提示，不会把计划数量当成已完成产出。</p>
          </div>

          <div className="p-4 sm:p-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-border bg-surface-2 p-3"><div className="flex items-center gap-2 text-[10px] font-bold text-text-muted"><PackageOpen size={13} />主推产品 / 市场 / 语言</div><p className="mt-2 text-sm font-bold text-text-primary">{plan.primaryProduct || '待补充主推产品'}</p><p className="mt-1 text-xs text-text-secondary">{plan.market || '待补充目标市场'} · {plan.language || '待补充语言'}</p></div>
              <div className="rounded-lg border border-border bg-surface-2 p-3"><div className="flex items-center gap-2 text-[10px] font-bold text-text-muted"><Users2 size={13} />本周内容计划</div><p className="mt-2 text-sm font-bold text-text-primary">{plan.weeklyMasterCount} 条母版 · {plan.weeklyVariantCount} 条平台版本</p><p className="mt-1 text-xs text-text-secondary">按账号稳定分布，不要求机械地每天一条</p></div>
              <div className="rounded-lg border border-border bg-surface-2 p-3"><div className="flex items-center gap-2 text-[10px] font-bold text-text-muted"><WalletCards size={13} />费用范围 / 预算上限</div><p className="mt-2 text-sm font-bold text-text-primary">¥{plan.estimatedCostCny.min}–{plan.estimatedCostCny.max}</p><p className="mt-1 text-xs text-text-secondary">¥10–15 / 母版为规划基线；预算上限 ¥{plan.budgetCny}，实际结算以费用回执为准</p></div>
              <div className="rounded-lg border border-border bg-surface-2 p-3"><div className="flex items-center gap-2 text-[10px] font-bold text-text-muted"><Clock3 size={13} />预计交付时间</div><p className="mt-2 text-sm font-bold text-text-primary">{plan.deliveryDays} 天计划窗口</p><p className="mt-1 text-xs text-text-secondary">用于工作排期，不是供应商 SLA 承诺</p></div>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {plan.platforms.map(platform => (
                <div key={platform.id} className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-xs">
                  <Globe2 size={14} className="shrink-0 text-accent" />
                  <span className="shrink-0 font-bold text-text-primary">{platform.label}</span>
                  <span className="min-w-0 flex-1 truncate text-text-muted" title={platform.accountName}>{platform.accountName}（连接状态待核验）</span>
                  <span className="shrink-0 text-[10px] font-semibold text-accent">{platform.weeklyOutput} 条 / 周</span>
                </div>
              ))}
            </div>

            <div className="mt-3 overflow-hidden rounded-xl border border-border">
              <p className="border-b border-border bg-surface-2 px-3 py-2 text-[11px] font-bold text-text-primary">Agent 工作排期</p>
              <div className="grid gap-px bg-border md:grid-cols-4">
                {[
                  ['1', '选题与参考匹配', '核验爆款参考、产品和账号事实'],
                  ['2', '脚本与结构素材', '生成标题、Tag、脚本和逐镜素材需求'],
                  ['3', '制作与质检', '制作母版、平台适配并完成质量检查'],
                  ['4', '交付发布包', '内容确认后生成自助发布包；不自动发布'],
                ].map(item => (
                  <div key={item[0]} className="bg-white p-3"><span className="text-[10px] font-bold text-accent">{item[0]}</span><p className="mt-1 text-xs font-bold text-text-primary">{item[1]}</p><p className="mt-1 text-[10px] leading-relaxed text-text-muted">{item[2]}</p></div>
                ))}
              </div>
            </div>

            {planAdjusting && (
              <div className="mt-3 grid gap-4 rounded-xl border border-amber-200 bg-amber-50 p-4 lg:grid-cols-4">
                <label className="grid gap-1 text-[11px] font-semibold text-text-secondary">所属行业<input value={draft.industry} onChange={event => update('industry', event.target.value)} maxLength={120} aria-required="true" placeholder="例如：美妆代工" className={inputClass} /></label>
                <label className="grid gap-1 text-[11px] font-semibold text-text-secondary">主要业务<input value={draft.primaryBusiness} onChange={event => update('primaryBusiness', event.target.value)} maxLength={500} aria-required="true" placeholder="例如：护肤品 OEM / ODM" className={inputClass} /></label>
                <label className="grid gap-1 text-[11px] font-semibold text-text-secondary">目标市场<input value={draft.targetMarkets} onChange={event => update('targetMarkets', event.target.value)} maxLength={300} aria-required="true" placeholder="例如：美国、东南亚" className={inputClass} /></label>
                <label className="grid gap-1 text-[11px] font-semibold text-text-secondary">核心客户<input value={draft.customerProfile} onChange={event => update('customerProfile', event.target.value)} maxLength={500} aria-required="true" placeholder="例如：美妆品牌采购负责人" className={inputClass} /></label>
                <div className="lg:col-span-2">
                  <p className="text-[11px] font-bold text-text-secondary">经营平台（最多 {maxPlatforms} 个）</p>
                  <div className="mt-2 flex flex-wrap gap-2">{GUIDED_SETUP_PLATFORMS.map(platform => {
                    const selected = draft.selectedPlatforms.includes(platform.id);
                    const unavailable = !selected && draft.selectedPlatforms.length >= maxPlatforms;
                    return <button key={platform.id} type="button" disabled={unavailable} title={unavailable ? `当前最多选择 ${maxPlatforms} 个平台` : undefined} onClick={() => togglePlatform(platform.id)} className={`rounded-full border px-2.5 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${selected ? 'border-accent bg-white text-accent' : 'border-border bg-white text-text-muted'}`}>{platform.label}</button>;
                  })}</div>
                </div>
                <label className="grid content-start gap-1 text-[11px] font-bold text-text-secondary">母版视频数（最多 {maxMasterCount} 条）<input type="number" min={maxMasterCount > 0 ? 1 : 0} max={maxMasterCount} value={draft.weeklyMasterCount} disabled={maxMasterCount === 0} onChange={event => update('weeklyMasterCount', Math.max(1, Math.min(maxMasterCount, Number(event.target.value) || 1)))} className={inputClass} /></label>
                <label className="grid content-start gap-1 text-[11px] font-bold text-text-secondary"><span className="flex items-center gap-1"><Languages size={12} />内容语言</span><select value={draft.primaryLanguage} onChange={event => update('primaryLanguage', event.target.value)} className={inputClass}>{LANGUAGE_OPTIONS.map(language => <option key={language.id} value={language.id}>{language.label}</option>)}</select></label>
                <div className="lg:col-span-4">
                  <p className="text-[11px] font-bold text-text-secondary">每个账号本周条数</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {plan.platforms.map(platform => (
                      <label key={platform.id} className="grid gap-1 text-[10px] font-semibold text-text-muted">
                        {platform.label} · {platform.accountName}
                        <input
                          type="number"
                          min={1}
                          max={Math.max(1, plan.weeklyMasterCount)}
                          value={platform.weeklyOutput}
                          onChange={event => setDraft(current => ({
                            ...current,
                            accountWeeklyOutput: {
                              ...current.accountWeeklyOutput,
                              [platform.id]: Math.max(1, Math.min(current.weeklyMasterCount, Number(event.target.value) || 1)),
                            },
                          }))}
                          className={inputClass}
                        />
                      </label>
                    ))}
                  </div>
                </div>
                <label className="grid gap-1 text-[11px] font-bold text-text-secondary lg:col-span-4">不能违反的规则（可选，每行一条）<textarea value={draft.constraints} onChange={event => update('constraints', event.target.value)} rows={2} maxLength={1440} placeholder="例如：不得编造功效、认证和交期" className={`${inputClass} resize-y`} /></label>
              </div>
            )}

            {missingFacts.length > 0 && (
              <p role="alert" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-950">
                还不能开始制作，请先补齐或恢复：{missingFacts.join('、')}。
                {!startAvailable && startUnavailableReason ? ` 当前原因：${startUnavailableReason}。` : ''}
              </p>
            )}

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" disabled={busy} onClick={() => setPlanAdjusting(true)} className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-text-secondary">调整计划</button>
              <button
                type="button"
                disabled={missingFacts.length > 0 || busy}
                onClick={() => void onConfirm(buildInitialSetupPayload(draft, limits), buildGuidedStartInput(draft, limits)).catch(() => {})}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}确认计划并开始制作
              </button>
            </div>
          </div>
        </section>
      )}

      {!planVisible && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <button type="button" disabled={step === 0 || busy} onClick={() => setStep(current => Math.max(0, current - 1))} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-text-secondary disabled:invisible"><ChevronLeft size={14} />上一步</button>
          <button type="button" disabled={!currentReady || busy} onClick={advance} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
            {step < STEPS.length - 1 ? '确认并继续' : '生成推荐计划'}<ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
