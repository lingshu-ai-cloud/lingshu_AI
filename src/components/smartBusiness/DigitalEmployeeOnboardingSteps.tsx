import type { ReactNode } from 'react';
import { Button, Form, Input, Radio as AntRadio, Select, Upload } from 'antd';
import { CheckCircle2, FileSpreadsheet, Loader2 } from 'lucide-react';
import { LsBrandAction, LsFlowDialog } from '../ui/LsExperiencePrimitives';
import EnterprisePresenters from '../enterprise/EnterprisePresenters';
import SocialContentStageOnboarding from '../socialContent/SocialContentStageOnboarding';
import type { SocialContentStageId } from '../../lib/socialContentStage';
import type { ProductionContactKind, ProductionPresenterPolicy } from '../../../shared/contracts/productionOnboarding';
import { Field, inputClass } from './DigitalEmployeeFormField';
import { onboardingProductName } from './onboardingProductImport';

const applicationGuideSteps = [
  { index: 1, label: '企业信息' },
  { index: 2, label: '推广产品' },
  { index: 3, label: '经营阶段' },
  { index: 4, label: '视频制作' },
] as const;

function OnboardingGuideFrame({ step, title, headerAction, children, busy = false, dismissible = false,
  onClose, onBack, onSkip, skipLabel = '跳过', primaryLabel, primaryId, primaryDisabled = false, onPrimary,
}: {
  step: 1 | 2 | 3 | 4;
  title: string;
  headerAction?: ReactNode;
  children: ReactNode;
  busy?: boolean;
  dismissible?: boolean;
  onClose?: () => void;
  onBack?: () => void;
  onSkip?: () => void;
  skipLabel?: string;
  primaryLabel: string;
  primaryId?: string;
  primaryDisabled?: boolean;
  onPrimary: () => void;
}) {
  return (
    <LsFlowDialog
      open title="新手引导" width={840} centered current={step - 1}
      steps={applicationGuideSteps.map(item => ({
        title: item.label,
        status: item.index < step ? 'finish' : item.index === step ? 'process' : 'wait',
      }))}
      closable={dismissible && !busy} keyboard={dismissible && !busy} maskClosable={false}
      onCancel={() => dismissible && !busy && onClose?.()}
      styles={{ body: { maxHeight: 'min(68vh, 680px)', overflowY: 'auto' } }}
      footer={[
        onBack ? <Button key="back" disabled={busy} onClick={onBack}>返回上一步</Button> : null,
        onSkip ? <Button key="skip" type="text" disabled={busy} onClick={onSkip}>{skipLabel}</Button> : null,
        <LsBrandAction key="primary" id={primaryId} loading={busy} disabled={primaryDisabled} onClick={onPrimary}>{primaryLabel}</LsBrandAction>,
      ].filter(Boolean)}
    >
      <section aria-labelledby={`onboarding-step-${step}-title`}>
        <p className="ls-type-body-small font-semibold text-accent">第 {step} 步，共 4 步</p>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <h2 id={`onboarding-step-${step}-title`} className="ls-type-title-large min-w-0 text-text-primary">{title}</h2>
          {headerAction ? <div className="ml-auto shrink-0">{headerAction}</div> : null}
        </div>
        <div className="mt-5">{children}</div>
      </section>
    </LsFlowDialog>
  );
}

export function OnboardingEnterpriseStep({ busy, profileSaving, dismissible, onClose, onConfirm,
  missingProfileFields, invalidProductionContact, profileLoading, companyName, brandName,
  onCompanyNameChange, onBrandNameChange, profileError, productionContactKind,
  productionContactValue, productionCta, onContactKindChange, onContactValueChange, onCtaChange,
}: {
  busy: boolean; profileSaving: boolean; dismissible: boolean; onClose?: () => void;
  onConfirm: () => void; missingProfileFields: string[]; invalidProductionContact: boolean;
  profileLoading: boolean; companyName: string; brandName: string;
  onCompanyNameChange: (value: string) => void; onBrandNameChange: (value: string) => void;
  profileError: string; productionContactKind: ProductionContactKind;
  productionContactValue: string; productionCta: string;
  onContactKindChange: (value: ProductionContactKind) => void;
  onContactValueChange: (value: string) => void; onCtaChange: (value: string) => void;
}) {
  return <OnboardingGuideFrame
    step={1} title="先告诉我们你的企业和品牌" busy={profileSaving || busy}
    dismissible={dismissible} onClose={onClose} onSkip={dismissible ? onClose : undefined}
    skipLabel="稍后继续" primaryLabel="确认企业信息"
    primaryDisabled={Boolean(missingProfileFields.length) || invalidProductionContact} onPrimary={onConfirm}
  >
    <Form className="space-y-6" layout="vertical" aria-label="企业与品牌资料">
      <section id="onboarding-enterprise-profile" className="scroll-mt-24">
        {profileLoading ? <div role="status" className="flex items-center gap-2 rounded-lg bg-surface-2 p-5 text-sm text-text-muted"><Loader2 size={16} className="animate-spin" />正在读取企业知识库已有档案…</div> : <>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="企业名称" required><input className={inputClass} value={companyName} onChange={event => onCompanyNameChange(event.target.value)} placeholder="例如：灵枢科技" /></Field>
            <Field label="品牌名称" required><input className={inputClass} value={brandName} onChange={event => onBrandNameChange(event.target.value)} placeholder="例如：Aurelia" /></Field>
          </div>
          {profileError && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-xs text-red-700">{profileError}</p>}
          {missingProfileFields.length ? <p role="status" className="mt-5 text-xs text-amber-700">还需填写：{missingProfileFields.join('、')}</p> : null}
        </>}
      </section>
      <section className="space-y-3 border-t border-border pt-6" aria-labelledby="onboarding-contact-title">
        <h3 id="onboarding-contact-title" className="ls-type-title-medium text-text-primary">你想用哪种联系方式让客户找到你？</h3>
        <div className="grid gap-4 md:grid-cols-3">
          <Form.Item className="mb-0" label="联系方式" htmlFor="production-contact-kind">
            <Select id="production-contact-kind" value={productionContactKind} onChange={onContactKindChange}
              options={[
                { value: 'none', label: '本轮不展示' }, { value: 'whatsapp', label: 'WhatsApp' },
                { value: 'email', label: '邮箱' }, { value: 'phone', label: '电话' },
                { value: 'website', label: '网站' }, { value: 'wechat', label: '微信' },
              ]} />
          </Form.Item>
          <Form.Item className="mb-0" label="公开联系信息" htmlFor="production-contact-value"
            required={productionContactKind !== 'none'}
            validateStatus={productionContactKind !== 'none' && !productionContactValue.trim() ? 'error' : undefined}
            help={productionContactKind !== 'none' && !productionContactValue.trim() ? '请填写允许公开展示的联系信息' : undefined}>
            <Input id="production-contact-value" disabled={productionContactKind === 'none'} value={productionContactValue}
              onChange={event => onContactValueChange(event.target.value)}
              placeholder={productionContactKind === 'none' ? '不需要填写' : '例如：sales@example.com'}
              aria-required={productionContactKind !== 'none'}
              aria-invalid={productionContactKind !== 'none' && !productionContactValue.trim()} />
          </Form.Item>
          <Form.Item className="mb-0" label="视频行动号召" htmlFor="production-contact-cta"
            required={productionContactKind !== 'none'}
            validateStatus={productionContactKind !== 'none' && !productionCta.trim() ? 'error' : undefined}
            help={productionContactKind !== 'none' && !productionCta.trim() ? '请填写视频中使用的行动号召' : undefined}>
            <Input id="production-contact-cta" disabled={productionContactKind === 'none'} value={productionCta}
              onChange={event => onCtaChange(event.target.value)}
              placeholder={productionContactKind === 'none' ? '不安排联系镜头' : '例如：发送采购需求获取报价'}
              aria-required={productionContactKind !== 'none'}
              aria-invalid={productionContactKind !== 'none' && !productionCta.trim()} />
          </Form.Item>
        </div>
      </section>
    </Form>
  </OnboardingGuideFrame>;
}

export function OnboardingProductsStep({ busy, productsLoading, productSaving, productImporting, dismissible,
  onClose, onBack, onConfirm, onImport, knowledgeProducts, productImportMessage, productError,
}: {
  busy: boolean; productsLoading: boolean; productSaving: boolean; productImporting: boolean;
  dismissible: boolean; onClose?: () => void; onBack: () => void; onConfirm: () => void;
  onImport: (file: File) => void; knowledgeProducts: Array<Record<string, any>>;
  productImportMessage: string; productError: string;
}) {
  return <OnboardingGuideFrame step={2} title="这次想重点推广哪些产品？"
    headerAction={<Upload accept=".xlsx,.xls,.csv,.pdf,.docx,.txt" showUploadList={false}
      disabled={productsLoading || productSaving || productImporting || busy}
      beforeUpload={file => { onImport(file); return Upload.LIST_IGNORE; }}>
      <Button icon={<FileSpreadsheet size={16} />} loading={productImporting} disabled={productsLoading || productSaving || busy}>上传产品资料</Button>
    </Upload>}
    busy={productSaving || productImporting || busy} dismissible={dismissible} onClose={onClose}
    onBack={onBack} primaryLabel="确认产品表，下一步" primaryDisabled={!knowledgeProducts.length}
    onPrimary={onConfirm}>
    <section id="onboarding-focus-products" className="scroll-mt-24">
      {productsLoading ? <div role="status" className="mt-6 flex items-center gap-2 rounded-lg bg-slate-50 p-5 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" />正在读取企业知识库产品…</div> : <>
        {productImportMessage && <p role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-800">{productImportMessage}</p>}
        {!knowledgeProducts.length ? <div className="mt-4 rounded-lg border border-dashed border-slate-300 p-8 text-center"><p className="font-bold text-slate-800">企业知识库尚未录入产品</p><p className="mt-2 text-xs text-slate-500">请上传产品表后继续。</p></div> : <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">{knowledgeProducts.map((product, index) => { const name = onboardingProductName(product); const details = [product.category, product.sku || product.attributes?.model].filter(Boolean).join(' · '); return <div key={String(product.id || `${name}-${index}`)} className="rounded-lg border border-slate-200 p-4 text-left"><div className="flex items-start justify-between gap-2"><p className="font-bold text-slate-900">{name}</p><CheckCircle2 size={17} className="shrink-0 text-emerald-600" /></div><p className="mt-1 text-xs text-slate-500">{details || '暂无型号与类别'}</p><p className="mt-3 line-clamp-2 text-xs leading-relaxed text-slate-500">{product.description || product.highlights || '详细资料可稍后在企业中心完善'}</p></div>; })}</div>}
        {productError && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-xs text-red-700">{productError}</p>}
        <p role="status" className="mt-5 text-xs text-text-muted">{knowledgeProducts.length ? `产品表已有 ${knowledgeProducts.length} 个产品，可以继续。` : '导入至少一个产品后即可继续。'}</p>
      </>}
    </section>
  </OnboardingGuideFrame>;
}

export function OnboardingStageStep({ busy, stageSaving, dismissible, onClose, onBack, contentStage,
  stageError, onChange, onConfirm,
}: {
  busy: boolean; stageSaving: boolean; dismissible: boolean; onClose?: () => void; onBack: () => void;
  contentStage?: SocialContentStageId; stageError: string;
  onChange: (stage: SocialContentStageId) => void; onConfirm: (stage: SocialContentStageId) => void;
}) {
  return <OnboardingGuideFrame step={3} title="你的社媒经营目前到了哪一步？"
    busy={stageSaving || busy} dismissible={dismissible} onClose={onClose} onBack={onBack}
    primaryLabel="确认阶段，下一步" primaryDisabled={!contentStage}
    onPrimary={() => contentStage && onConfirm(contentStage)}>
    <SocialContentStageOnboarding embedded hideHeader hideActions eyebrow="第三步 · 社媒经营阶段"
      initialValue={contentStage} busy={stageSaving || busy} error={stageError}
      onChange={onChange} onConfirm={onConfirm} />
  </OnboardingGuideFrame>;
}

export function OnboardingPresenterStep({ busy, stageSaving, dismissible, onClose, onBack, onSkip,
  allowInitialPlan, recommendedPlanTriggerId, invalidProductionContact, presenterPolicy,
  presenterConfigured, onPolicyChange, onPresenterSelected, onConfirm, stageError,
}: {
  busy: boolean; stageSaving: boolean; dismissible: boolean; onClose?: () => void; onBack: () => void;
  onSkip: () => void; allowInitialPlan: boolean; recommendedPlanTriggerId: string;
  invalidProductionContact: boolean; presenterPolicy: ProductionPresenterPolicy;
  presenterConfigured: boolean; onPolicyChange: (value: ProductionPresenterPolicy) => void;
  onPresenterSelected: () => void; onConfirm: () => void; stageError: string;
}) {
  return <OnboardingGuideFrame step={4} title="最后，确认这轮视频怎么制作"
    busy={stageSaving || busy} dismissible={dismissible} onClose={onClose} onBack={onBack}
    onSkip={onSkip} skipLabel="本轮仅用本地素材"
    primaryLabel={allowInitialPlan ? '生成推荐计划' : '完成引导并保存'}
    primaryId={allowInitialPlan ? recommendedPlanTriggerId : undefined}
    primaryDisabled={invalidProductionContact || (presenterPolicy === 'digital_presenter' && !presenterConfigured)}
    onPrimary={onConfirm}>
    <Form className="space-y-5" layout="vertical" aria-label="生产开工资料">
      <section className="space-y-3" aria-label="出镜方式">
        <AntRadio.Group className="!grid w-full !gap-3 sm:!grid-cols-2" value={presenterPolicy}
          onChange={event => onPolicyChange(event.target.value as ProductionPresenterPolicy)} aria-label="出镜方式">
          <AntRadio value="digital_presenter" className={`m-0 flex rounded-lg border p-4 ${presenterPolicy === 'digital_presenter' ? 'border-accent bg-accent-glow' : 'border-border bg-surface'}`}><span><strong className="block text-sm text-text-primary">使用数字人口播</strong><span className="mt-1 block text-xs leading-5 text-text-muted">需要完成默认人物、声音与用途授权；选择后不会降级为素材匹配或其他制作路线。</span></span></AntRadio>
          <AntRadio value="local_video_only" className={`m-0 flex rounded-lg border p-4 ${presenterPolicy === 'local_video_only' ? 'border-accent bg-accent-glow' : 'border-border bg-surface'}`}><span><strong className="block text-sm text-text-primary">本轮仅用本地实拍</strong><span className="mt-1 block text-xs leading-5 text-text-muted">自动排除含真人口播的参考，不临时改成其他生成方式。</span></span></AntRadio>
        </AntRadio.Group>
        {presenterPolicy === 'digital_presenter' && <EnterprisePresenters initialConfiguration onInitialSelection={onPresenterSelected} />}
      </section>
      {stageError && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">{stageError}</p>}
    </Form>
  </OnboardingGuideFrame>;
}
