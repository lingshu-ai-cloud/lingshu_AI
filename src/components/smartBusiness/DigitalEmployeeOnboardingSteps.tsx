import { createContext, useContext, useState, type ReactNode } from 'react';
import { Button, Form, Input, Modal, Select, Upload } from 'antd';
import { CheckCircle2, FileSpreadsheet, Loader2, Sparkles } from 'lucide-react';
import {
  enterpriseOnboardingSourceLabel,
  type EnterpriseOnboardingDraft,
  type EnterpriseOnboardingFieldKey,
  type EnterpriseOnboardingProduct,
  type EnterpriseOnboardingSource,
} from '../../../shared/contracts/enterpriseOnboarding';
import { LsBrandAction, LsFlowDialog } from '../ui/LsExperiencePrimitives';
import EnterprisePresenters from '../enterprise/EnterprisePresenters';
import SocialContentStageOnboarding from '../socialContent/SocialContentStageOnboarding';
import type { SocialContentStageId } from '../../lib/socialContentStage';
import type { ProductionPresenterPolicy } from '../../../shared/contracts/productionOnboarding';
import { Field, inputClass } from './DigitalEmployeeFormField';
import { onboardingProductName } from './onboardingProductImport';

const applicationGuideSteps = [
  { index: 1, label: '企业与品牌' },
  { index: 2, label: '产品与主推' },
  { index: 3, label: '市场与内容' },
  { index: 4, label: '综合确认' },
] as const;

export const OnboardingGuideTitleContext = createContext('新手引导');

const assistantQuestions = {
  1: '你好，我是灵小枢。先告诉我，你的企业和品牌叫什么、主要做什么？我会把你确认的回答整理为企业资料。',
  2: '接下来，你希望我重点了解哪些产品？可以上传已有资料，也可以手动填写，并选出最多三个主推产品。',
  3: '这些产品主要面向哪些市场和买家？请告诉我你计划使用的平台、语言及希望客户采取的行动。',
  4: '我把刚才的回答整理好了。请核对每项内容和来源，确认后我才会写入企业资料。',
} as const;

function OnboardingGuideFrame({ step, title, guideTitle = '新手引导', headerAction, children, busy = false, dismissible = false,
  onClose, onBack, primaryLabel, primaryDisabled = false, onPrimary,
}: {
  step: 1 | 2 | 3 | 4;
  title: string;
  guideTitle?: string;
  headerAction?: ReactNode;
  children: ReactNode;
  busy?: boolean;
  dismissible?: boolean;
  onClose?: () => void;
  onBack?: () => void;
  primaryLabel: string;
  primaryDisabled?: boolean;
  onPrimary: () => void;
}) {
  const contextualGuideTitle = useContext(OnboardingGuideTitleContext);
  return <LsFlowDialog
    open title={guideTitle === '新手引导' ? contextualGuideTitle : guideTitle} width={840} centered current={step - 1}
    steps={applicationGuideSteps.map(item => ({
      title: item.label,
      status: item.index < step ? 'finish' : item.index === step ? 'process' : 'wait',
    }))}
    closable={dismissible && !busy} keyboard={dismissible && !busy} maskClosable={false}
    onCancel={() => dismissible && !busy && onClose?.()}
    styles={{ body: { maxHeight: 'min(72vh, 720px)', overflowY: 'auto' } }}
    footer={[
      onBack ? <Button key="back" disabled={busy} onClick={onBack}>返回上一步</Button> : null,
      dismissible ? <Button key="skip" type="text" disabled={busy} onClick={onClose} title="保存当前草稿，稍后继续">跳过</Button> : null,
      <LsBrandAction key="primary" loading={busy} disabled={primaryDisabled} onClick={onPrimary}>{primaryLabel}</LsBrandAction>,
    ].filter(Boolean)}
  >
    <section aria-labelledby={`onboarding-step-${step}-title`}>
      <p className="ls-type-body-small font-semibold text-accent">第 {step} 步，共 4 步</p>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <h2 id={`onboarding-step-${step}-title`} className="ls-type-title-large min-w-0 text-text-primary">{title}</h2>
        {headerAction ? <div className="ml-auto shrink-0">{headerAction}</div> : null}
      </div>
      <div className="mt-5 flex items-start gap-3" aria-label="灵小枢提问">
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-glow text-sm font-semibold text-accent">枢</span>
        <p className="max-w-2xl rounded-2xl rounded-tl-sm bg-surface-2 px-4 py-3 text-sm leading-6 text-text-primary">{assistantQuestions[step]}</p>
      </div>
      <div className="mt-5" aria-label="我的回答">{children}</div>
    </section>
  </LsFlowDialog>;
}

export function OnboardingEnterpriseStep({ busy, profileLoading, dismissible, onClose, onConfirm, guideTitle,
  missingFields, companyName, brandName, industry, primaryBusiness, onChange, error,
}: {
  busy: boolean; profileLoading: boolean; dismissible: boolean; onClose?: () => void; onConfirm: () => void; guideTitle?: string;
  missingFields: string[]; companyName: string; brandName: string; industry: string; primaryBusiness: string;
  onChange: (field: 'companyName' | 'brandName' | 'industry' | 'primaryBusiness', value: string) => void;
  error: string;
}) {
  return <OnboardingGuideFrame step={1} title="先建立企业与品牌身份" guideTitle={guideTitle} busy={busy}
    dismissible={dismissible} onClose={onClose} primaryLabel="保存草稿，下一步"
    primaryDisabled={Boolean(missingFields.length)} onPrimary={onConfirm}>
    <Form className="space-y-5" layout="vertical" aria-label="企业与品牌资料">
      {profileLoading
        ? <div role="status" className="flex items-center gap-2 rounded-lg bg-surface-2 p-5 text-sm text-text-muted"><Loader2 size={16} className="animate-spin" />正在读取企业知识库与未完成草稿…</div>
        : <div id="onboarding-enterprise-profile" className="grid gap-4 md:grid-cols-2">
          <Field label="企业名称" required><input className={inputClass} value={companyName} onChange={event => onChange('companyName', event.target.value)} placeholder="例如：灵枢科技" /></Field>
          <Field label="品牌名称" required><input className={inputClass} value={brandName} onChange={event => onChange('brandName', event.target.value)} placeholder="例如：Aurelia" /></Field>
          <Field label="行业/主营分类" required><input className={inputClass} value={industry} onChange={event => onChange('industry', event.target.value)} placeholder="例如：工业自动化设备" /></Field>
          <Field label="主要提供什么" required><input className={inputClass} value={primaryBusiness} onChange={event => onChange('primaryBusiness', event.target.value)} placeholder="例如：面向海外经销商的视觉检测设备" /></Field>
        </div>}
      {error ? <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-xs text-red-700">{error}</p> : null}
      {missingFields.length ? <p role="status" className="text-xs text-amber-700">还需填写：{missingFields.join('、')}</p> : null}
    </Form>
  </OnboardingGuideFrame>;
}

export function OnboardingProductsStep({ busy, productsLoading, productImporting, dismissible, guideTitle,
  onClose, onBack, onConfirm, onImport, onAddProduct, products, focusProductIds, onToggleFocus, onProductChange,
  importMessage, error,
}: {
  busy: boolean; productsLoading: boolean; productImporting: boolean; dismissible: boolean; guideTitle?: string;
  onClose?: () => void; onBack: () => void; onConfirm: () => void; onImport: (file: File) => void; onAddProduct: (name: string) => void;
  products: EnterpriseOnboardingProduct[]; focusProductIds: string[];
  onToggleFocus: (id: string) => void;
  onProductChange: (id: string, patch: Partial<Pick<EnterpriseOnboardingProduct, 'name' | 'category' | 'highlights'>>) => void;
  importMessage: string; error: string;
}) {
  const [manualProductName, setManualProductName] = useState('');
  const addManualProduct = () => {
    const name = manualProductName.trim();
    if (!name) return;
    onAddProduct(name);
    setManualProductName('');
  };
  const focusProducts = focusProductIds.map(id => products.find(product => product.id === id)).filter(Boolean) as EnterpriseOnboardingProduct[];
  const incompleteFocus = focusProducts.some(product => !product.name.trim() || !product.category?.trim() || !(product.highlights || product.description)?.trim());
  return <OnboardingGuideFrame step={2} title="导入产品，并确认最多 3 个主推产品" guideTitle={guideTitle}
    headerAction={<Upload accept=".xlsx,.xls,.csv,.pdf,.docx,.txt" showUploadList={false}
      disabled={productsLoading || productImporting || busy}
      beforeUpload={file => { onImport(file); return Upload.LIST_IGNORE; }}>
      <Button icon={<FileSpreadsheet size={16} />} loading={productImporting} disabled={productsLoading || busy}>上传产品资料</Button>
    </Upload>}
    busy={busy || productImporting} dismissible={dismissible} onClose={onClose} onBack={onBack}
    primaryLabel="确认主推产品，下一步"
    primaryDisabled={!products.length || !focusProductIds.length || focusProductIds.length > 3 || incompleteFocus}
    onPrimary={onConfirm}>
    <section id="onboarding-focus-products" className="scroll-mt-24">
      <p className="rounded-lg bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-800">系统会先按产品资料完整度给出建议；这只是建议，选中并完成综合确认后才成为企业事实。</p>
      {productsLoading ? <div role="status" className="mt-4 flex items-center gap-2 rounded-lg bg-surface-2 p-5 text-sm text-text-muted"><Loader2 size={16} className="animate-spin" />正在读取产品与草稿…</div> : <>
        {importMessage ? <p role="status" className="mt-3 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-xs font-semibold text-success">{importMessage}</p> : null}
        {!products.length ? <div className="mt-4 rounded-lg border border-dashed border-border p-8 text-center"><p className="font-semibold text-text-primary">还没有产品</p><p className="mt-2 text-xs text-text-muted">可以上传产品资料，或先手动录入一个产品。</p></div> : <div className="mt-4 grid gap-3 md:grid-cols-2">{products.map((product, index) => {
          const selected = focusProductIds.includes(product.id);
          const disabled = !selected && focusProductIds.length >= 3;
          return <article key={product.id} className={`rounded-lg border p-4 ${selected ? 'border-accent bg-accent-glow' : 'border-border bg-surface'}`}>
            <label className="flex min-h-11 cursor-pointer items-start gap-3">
              <input type="checkbox" className="mt-1" checked={selected} disabled={disabled} onChange={() => onToggleFocus(product.id)} />
              <span className="min-w-0"><strong className="block text-sm text-text-primary">{onboardingProductName(product) || `产品 ${index + 1}`}</strong><span className="mt-1 block text-xs text-text-muted">{selected ? '已选为主推产品' : disabled ? '最多选择 3 个' : '可选择为主推产品'}</span></span>
              {selected ? <CheckCircle2 size={17} className="ml-auto shrink-0 text-accent" /> : null}
            </label>
            {selected ? <div className="mt-3 grid gap-3">
              <Field label="产品名称" required><input className={inputClass} value={product.name} onChange={event => onProductChange(product.id, { name: event.target.value })} placeholder="例如：视觉检测设备" /></Field>
              <Field label="类目" required><input className={inputClass} value={product.category || ''} onChange={event => onProductChange(product.id, { category: event.target.value })} placeholder="例如：视觉检测设备" /></Field>
              <Field label="核心卖点" required><Input.TextArea rows={2} value={product.highlights || product.description || ''} onChange={event => onProductChange(product.id, { highlights: event.target.value })} placeholder="只填写可被产品资料支持的卖点" /></Field>
            </div> : null}
          </article>;
        })}</div>}
        <div className="mt-4 flex flex-wrap gap-2"><Input className="min-w-48 flex-1" aria-label="手动录入产品名称" value={manualProductName} onChange={event => setManualProductName(event.target.value)} onPressEnter={addManualProduct} placeholder="输入一个产品名称" /><Button disabled={busy || productImporting || !manualProductName.trim()} onClick={addManualProduct}>手动添加产品</Button></div>
        <p role="status" className="mt-4 text-xs text-text-muted">已选择 {focusProductIds.length}/3 个主推产品。</p>
      </>}
      {error ? <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-xs text-red-700">{error}</p> : null}
    </section>
  </OnboardingGuideFrame>;
}

const platformOptions = [
  { value: 'linkedin', label: 'LinkedIn' }, { value: 'youtube', label: 'YouTube' },
  { value: 'tiktok', label: 'TikTok' }, { value: 'instagram', label: 'Instagram' },
  { value: 'facebook', label: 'Facebook' },
];

export function OnboardingMarketStep({ busy, aiBusy, dismissible, guideTitle, onClose, onBack, onConfirm, onGenerateProposal, contentStage,
  targetMarket, targetBuyer, primaryPlatform, language, primaryCta, onChange, error,
}: {
  busy: boolean; aiBusy: boolean; dismissible: boolean; guideTitle?: string; onClose?: () => void; onBack: () => void; onConfirm: () => void;
  onGenerateProposal: () => void;
  contentStage?: SocialContentStageId; targetMarket: string; targetBuyer: string; primaryPlatform: string;
  language: string; primaryCta: string; error: string;
  onChange: (field: 'targetMarket' | 'targetBuyer' | 'primaryPlatform' | 'language' | 'primaryCta' | 'contentStage', value: string) => void;
}) {
  const incomplete = !contentStage || !targetMarket.trim() || !targetBuyer.trim() || !primaryPlatform.trim() || !language.trim() || !primaryCta.trim();
  return <OnboardingGuideFrame step={3} title="确认面向谁、在哪里沟通，以及唯一 CTA" guideTitle={guideTitle}
    headerAction={<Button icon={<Sparkles size={16} />} loading={aiBusy} disabled={busy || !targetMarket.trim()} onClick={onGenerateProposal}>生成 AI 市场建议</Button>}
    busy={busy} dismissible={dismissible} onClose={onClose} onBack={onBack}
    primaryLabel="确认市场与内容方向" primaryDisabled={incomplete} onPrimary={onConfirm}>
    <Form className="space-y-5" layout="vertical" aria-label="市场与内容方向">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="主要目标市场" required><input className={inputClass} value={targetMarket} onChange={event => onChange('targetMarket', event.target.value)} placeholder="例如：美国与加拿大" /></Field>
        <Field label="主推买家" required><input className={inputClass} value={targetBuyer} onChange={event => onChange('targetBuyer', event.target.value)} placeholder="例如：当地经销商与采购负责人" /></Field>
        <Form.Item className="mb-0" label="主平台" required><Select value={primaryPlatform || undefined} options={platformOptions} onChange={value => onChange('primaryPlatform', value)} placeholder="选择主要内容平台" /></Form.Item>
        <Form.Item className="mb-0" label="主要语言" required><Select value={language || undefined} onChange={value => onChange('language', value)} options={[{ value: '英语', label: '英语' }, { value: '中文', label: '中文' }, { value: '西班牙语', label: '西班牙语' }, { value: '法语', label: '法语' }, { value: '德语', label: '德语' }]} /></Form.Item>
      </div>
      <section className="border-t border-border pt-5">
        <SocialContentStageOnboarding embedded hideHeader hideActions eyebrow="社媒经营阶段"
          initialValue={contentStage} busy={busy} error="" onChange={stage => onChange('contentStage', stage)} onConfirm={stage => onChange('contentStage', stage)} />
      </section>
      <Field label="唯一 CTA" required><Input.TextArea rows={2} value={primaryCta} onChange={event => onChange('primaryCta', event.target.value)} placeholder="例如：发送产品需求，获取适配方案" /><p className="mt-1 text-xs text-text-muted">这里只确认行动目标；电话、邮箱等公开联系方式可在具体任务需要时补充。</p></Field>
      {error ? <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-xs text-red-700">{error}</p> : null}
    </Form>
  </OnboardingGuideFrame>;
}

function SourceBadge({ source }: { source: EnterpriseOnboardingSource | undefined }) {
  const effective = source || 'user_provided';
  return <span className="shrink-0 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-text-muted">{enterpriseOnboardingSourceLabel[effective]}</span>;
}

function SummaryRow({ label, value, source }: { label: string; value: ReactNode; source?: EnterpriseOnboardingSource }) {
  return <div className="flex items-start justify-between gap-4 border-b border-border py-3 last:border-b-0"><div className="min-w-0"><p className="text-xs text-text-muted">{label}</p><div className="mt-1 text-sm font-medium text-text-primary">{value}</div></div><SourceBadge source={source} /></div>;
}

export function OnboardingConfirmationStep({ busy, dismissible, guideTitle, onClose, onBack, onConfirm, draft,
  onProposalChange, error,
}: {
  busy: boolean; dismissible: boolean; guideTitle?: string; onClose?: () => void; onBack: () => void; onConfirm: () => void;
  draft: EnterpriseOnboardingDraft;
  onProposalChange: (field: 'companyIntro' | 'brandTone', value: string) => void;
  error: string;
}) {
  const source = (key: EnterpriseOnboardingFieldKey) => draft.sources[key];
  const focusProducts = draft.focusProductIds.map(id => draft.products.find(product => product.id === id)).filter(Boolean) as EnterpriseOnboardingProduct[];
  return <OnboardingGuideFrame step={4} title="最后核对一次，确认后写入企业知识库" guideTitle={guideTitle}
    busy={busy} dismissible={dismissible} onClose={onClose} onBack={onBack}
    primaryLabel="确认并进入工作台" primaryDisabled={false}
    onPrimary={onConfirm}>
    <div className="space-y-5">
      <p className="rounded-lg bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-800">确认前仍是草稿。来源标签说明每项来自你的输入、系统识别或 AI 建议；只有点击下方确认后才会形成新的企业事实版本。</p>
      <section className="rounded-lg border border-border bg-surface px-4" aria-label="企业与品牌确认">
        <SummaryRow label="企业 / 品牌" value={`${draft.companyName} / ${draft.brandName}`} source={source('companyName')} />
        <SummaryRow label="行业与主营" value={`${draft.industry} · ${draft.primaryBusiness}`} source={source('primaryBusiness')} />
        <div className="border-b border-border py-3"><div className="mb-2 flex items-center justify-between gap-3"><label className="text-xs text-text-muted" htmlFor="onboarding-company-intro">公司简介（选填）</label><SourceBadge source={source('companyIntro')} /></div><Input.TextArea id="onboarding-company-intro" rows={3} value={draft.companyIntro} onChange={event => onProposalChange('companyIntro', event.target.value)} /></div>
        <div className="py-3"><div className="mb-2 flex items-center justify-between gap-3"><label className="text-xs text-text-muted" htmlFor="onboarding-brand-tone">品牌初始语气（选填）</label><SourceBadge source={source('brandTone')} /></div><Input.TextArea id="onboarding-brand-tone" rows={2} value={draft.brandTone} onChange={event => onProposalChange('brandTone', event.target.value)} /></div>
      </section>
      <section className="rounded-lg border border-border bg-surface px-4" aria-label="主推产品确认">
        <SummaryRow label="主推产品（最多 3 个）" value={<ul className="space-y-2">{focusProducts.map(product => {
          const proposal = draft.proposalSet?.focusProducts.find(item => item.productId === product.id);
          return <li key={product.id}><p>{product.name} · {product.category} · {product.highlights || product.description}</p>{product.description ? <p className="mt-1 text-xs font-normal text-text-secondary">{product.description}</p> : null}{proposal ? <p className="mt-1 text-xs font-normal text-text-muted">建议依据：{proposal.reason} · 置信度 {Math.round(proposal.confidence * 100)}%</p> : null}</li>;
        })}</ul>} source={source('focusProducts')} />
        {draft.evidenceRefs?.length ? <SummaryRow label="已留存原始证据" value={draft.evidenceRefs.map(item => item.name).join('、')} source="system_detected" /> : null}
      </section>
      <section className="rounded-lg border border-border bg-surface px-4" aria-label="市场与内容确认">
        <SummaryRow label="市场 / 买家" value={`${draft.targetMarket} · ${draft.targetBuyer}`} source={source('targetMarket')} />
        <SummaryRow label="平台 / 语言" value={`${platformOptions.find(option => option.value === draft.primaryPlatform)?.label || draft.primaryPlatform} · ${draft.language}`} source={source('primaryPlatform')} />
        <SummaryRow label="社媒阶段" value={draft.contentStage || '未确认'} source={source('contentStage')} />
        <SummaryRow label="唯一 CTA" value={draft.primaryCta} source={source('primaryCta')} />
        {draft.proposalSet?.market.coverage.note ? <SummaryRow label="AI 建议数据覆盖" value={`${draft.proposalSet.market.coverage.note}（置信度 ${Math.round(draft.proposalSet.market.confidence * 100)}%）`} source="ai_suggested" /> : null}
        <SummaryRow label="当前企业事实版本" value={draft.baseFactVersion} source="system_detected" />
      </section>
      {error ? <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-xs text-red-700">{error}</p> : null}
    </div>
  </OnboardingGuideFrame>;
}

export function PresenterSetupDialog({ busy, open, presenterPolicy, presenterConfigured, error,
  onClose, onPolicyChange, onPresenterSelected, onConfirm,
}: {
  busy: boolean; open: boolean; presenterPolicy: ProductionPresenterPolicy; presenterConfigured: boolean; error: string;
  onClose?: () => void; onPolicyChange: (value: ProductionPresenterPolicy) => void;
  onPresenterSelected: () => void; onConfirm: () => void;
}) {
  return <Modal open={open} title="按当前任务配置出镜方式" width={840} centered closable={!busy}
    maskClosable={false} keyboard={!busy} onCancel={onClose}
    footer={[<Button key="cancel" disabled={busy} onClick={onClose}>稍后处理</Button>, <LsBrandAction key="save" loading={busy} disabled={presenterPolicy === 'digital_presenter' && !presenterConfigured} onClick={onConfirm}>保存出镜设置</LsBrandAction>]}>
    <p className="mb-4 text-sm text-text-secondary">数字人不是首次建档条件。只有当前生产路线需要人物出镜时，才在这里补充人物、声音和授权。</p>
    <div className="grid gap-3 sm:grid-cols-2">
      {([['local_video_only', '使用企业实拍素材'], ['digital_presenter', '使用已授权数字人']] as const).map(([value, label]) => <Button key={value} className="!h-auto min-h-11 !whitespace-normal" type={presenterPolicy === value ? 'primary' : 'default'} onClick={() => onPolicyChange(value)}>{label}</Button>)}
    </div>
    {presenterPolicy === 'digital_presenter' ? <div className="mt-4"><EnterprisePresenters initialConfiguration onInitialSelection={onPresenterSelected} /></div> : null}
    {error ? <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-xs text-red-700">{error}</p> : null}
  </Modal>;
}
