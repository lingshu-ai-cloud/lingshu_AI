import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Select, Spin } from 'antd';
import LsPageHeader from '../ui/LsPageHeader';
import ImageReplicationReferencePicker from './ImageReplicationReferencePicker';
import { IMAGE_LANGUAGE_OPTIONS, imageLanguageLabel } from '../../../shared/contracts/imageLanguages';
import { openImageCreationTask } from '../../lib/imageCreationTaskNavigation';
import type { SocialContentCreateRequest } from './SocialContentWorkspace';
import type { SocialImageCreationTask } from '../../../shared/contracts/socialImageCreation';
import { readAssistantProductCatalog, type AssistantCatalogProduct } from '../../lib/assistantProductCatalog';
import { studioApi } from '../../lib/studioApi';
import { socialContentApi } from '../../lib/socialContentApi';
import { socialImageApi } from '../../lib/socialImageApi';
import { productionNavigationIdentity } from '../../lib/productionNavigation';
import { resolveImageReplicationIntake, type ImageReplicationIntake, type ImageReplicationReferenceIdentity } from '../../lib/imageReplicationIntake';
import { createImageReplicationDraft, imageReplicationDraftIssue,
  type ImageReplicationDraft, type ImageReplicationReference } from '../../lib/imageReplicationDraft';

import { readImageReplicationReferences } from '../../lib/imageReplicationReferences';

const QUESTIONS = [
  '先确认要复刻哪张参考图。可以选择已采集的图文帖子，或上传一张图片。',
  '要推广哪个产品？请确认发布平台和语言。产品卖点会从企业资料带入，有特别要求可以补充。',
  '请核对这次复刻需求。确认后，我会分析参考构图、匹配企业素材，完成图片和帖子配文。',
];
const PLATFORM_LABELS = { facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn' };

/** Answers stay in the existing conversation; only final confirmation hands off to production. */
export default function ImageReplicationConversation({ request, onShowCreations, embedded = false, checkpoint, operationKey, onCheckpoint }: {
  request?: SocialContentCreateRequest | null;
  embedded?: boolean; checkpoint?: ImageReplicationIntake; operationKey?: string;
  onCheckpoint?: (value: ImageReplicationIntake, reference?: ImageReplicationReferenceIdentity | null) => void;
  onShowCreations: () => void;
}) {
  const context = request?.sourceContext;
  const [step, setStep] = useState(checkpoint?.step || 0);
  const [reference, setReference] = useState<ImageReplicationReference | null>(() => context?.referenceMediaUrl || context?.referenceThumbnail ? {
    url: context.referenceMediaUrl || context.referenceThumbnail!, title: context.referenceTitle,
    caption: context.referenceCaption, layerBlueprints: context.referenceLayerBlueprints,
  } : null);
  const [products, setProducts] = useState<AssistantCatalogProduct[]>([]);
  const [references, setReferences] = useState<ImageReplicationReference[]>([]);
  const [productId, setProductId] = useState(checkpoint?.productId || '');
  const [objective, setObjective] = useState(checkpoint?.objective || '');
  const [audience, setAudience] = useState(checkpoint?.audience || '');
  const hintedPlatform = request?.prefill?.platforms?.[0];
  const [platform, setPlatform] = useState<ImageReplicationDraft['platform']>(
    checkpoint?.platform || (hintedPlatform === 'instagram' || hintedPlatform === 'linkedin' ? hintedPlatform : 'facebook'));
  const hintedRatio = context?.aspectRatio;
  const [aspectRatio, setAspectRatio] = useState<ImageReplicationDraft['aspectRatio']>(
    checkpoint?.aspectRatio || (hintedRatio === '1:1' || hintedRatio === '9:16' || hintedRatio === '16:9' ? hintedRatio : '4:5'));
  const [language, setLanguage] = useState<ImageReplicationDraft['language']>(checkpoint?.language || 'en');
  const [callToAction, setCallToAction] = useState(checkpoint?.callToAction || '');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [created, setCreated] = useState<SocialImageCreationTask>();
  const [submitted, setSubmitted] = useState(checkpoint?.submitted || false);
  const startNew = useRef(false);
  const handedOff = useRef('');
  const checkpointWriter = useRef(onCheckpoint); checkpointWriter.current = onCheckpoint;
  const alive = useRef(true);
  const identity = useRef(productionNavigationIdentity());
  const locked = useRef(false);
  const frozen = useRef<ImageReplicationDraft | undefined>(undefined);
  const key = useRef(operationKey || `image-replication-${crypto.randomUUID()}`);
  const uploadInput = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const isCurrent = () => alive.current && identity.current === productionNavigationIdentity();

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let active = true; setLoading(true); setLoadError('');
    void Promise.all([readAssistantProductCatalog(), readImageReplicationReferences(context?.referenceSourceRecordId), checkpoint?.imageTaskId ? socialImageApi.getTask(checkpoint.imageTaskId) : undefined]).then(async ([catalog, collected, restored]) => {
      if (!active || !isCurrent()) return;
      setProducts(catalog);
      if (restored) setCreated(restored.task);
      setReferences(collected);
      if (context?.referenceSourceRecordId) {
        const item = collected.find(image => image.sourceRecordId === context.referenceSourceRecordId
          && (image.imageIndex || 0) === (context.referenceImageIndex || 0));
        if (!item) { setReference(null); setStep(0); setLoadError('原帖参考已不可用，请重新选择已采集图文或上传图片。'); }
        else setReference(item);
      }
      if (context?.referenceMaterialId) {
        const uploads = await studioApi.listMaterials('all');
        if (!active || !isCurrent()) return;
        const item = uploads.find(image => image.id === context.referenceMaterialId && image.sourceType === 'image-replication-reference');
        if (!item?.url) { setReference(null); setStep(0); setLoadError('对话中的参考图片已不可用，请重新选择或上传。'); }
        else setReference({ url: item.url, title: item.name, materialId: item.id });
      }
    }).catch(cause => { if (active && isCurrent()) setLoadError(cause instanceof Error ? cause.message : '产品与参考图片读取失败'); })
      .finally(() => { if (active && isCurrent()) setLoading(false); });
    return () => { active = false; };
  }, [reload, context?.referenceMaterialId, context?.referenceSourceRecordId, context?.referenceImageIndex]);

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }); }, [step, created]);
  const product = products.find(item => item.id === productId);
  const resolved = product ? resolveImageReplicationIntake(product, { objective, audience, callToAction }) : { objective, audience, callToAction };
  const draft = (): ImageReplicationDraft => ({ reference: reference!, product: product!, ...resolved, platform, aspectRatio, language });
  useEffect(() => {
    if (!isCurrent()) return;
    checkpointWriter.current?.({ step, productId, objective, audience, callToAction, platform, aspectRatio, language, submitted,
      ...((created?.id || checkpoint?.imageTaskId) ? { imageTaskId: created?.id || checkpoint?.imageTaskId } : {}) }, reference?.sourceRecordId ? { sourceRecordId: reference.sourceRecordId,
        imageIndex: reference.imageIndex || 0, name: reference.title.slice(0, 200) }
      : reference?.materialId ? { materialId: reference.materialId, name: reference.title.slice(0, 200) } : loading ? undefined : null);
  }, [step, productId, objective, audience, callToAction, platform, aspectRatio, language, submitted, created?.id,
    reference?.materialId, reference?.sourceRecordId, reference?.imageIndex, loading]);
  const answers = [reference ? `参考图：${reference.title || '已选图文'}` : '',
    product ? `推广产品：${product.name}\n${PLATFORM_LABELS[platform]} · ${aspectRatio} · ${imageLanguageLabel(language)}` : ''];
  const advance = () => {
    if (busy || loading || submitted) return;
    if (!isCurrent()) { setError('登录状态已变化，请重新打开创作。'); return; }
    if (step === 0 && !reference?.url) { setError('请先选择或上传一张参考图。'); return; }
    if (step === 1) {
      if (!product) { setError('请选择一个企业知识库中的产品。'); return; }
      const issue = imageReplicationDraftIssue(draft());
      if (issue) { setError(issue); return; }
    }
    setStep(step + 1); setError('');
  };

  const upload = async (file: File) => {
    if (locked.current || submitted || !isCurrent()) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) {
      setError('请上传20MB以内的 JPG、PNG 或 WebP 参考图。'); return;
    }
    locked.current = true; setBusy(true); setError('');
    try {
      const result = await studioApi.uploadMaterialFile(file, { folder: 'image-replication-references', type: 'image', sourceType: 'image-replication-reference' });
      if (!isCurrent()) return;
      if (!result.ok || !result.material?.url) throw new Error(result.error || '参考图上传失败');
      setReference({ url: result.material.url, title: result.material.name, materialId: result.material.id });
    } catch (cause) { if (isCurrent()) setError(cause instanceof Error ? cause.message : '参考图上传失败'); }
    finally { locked.current = false; if (isCurrent()) setBusy(false); }
  };

  const submit = async () => {
    if (locked.current || step !== 2 || !reference || !product) return;
    if (!isCurrent()) { setError('登录状态已变化，请重新打开创作。'); return; }
    frozen.current ||= structuredClone(draft());
    setObjective(frozen.current.objective); setAudience(frozen.current.audience); setCallToAction(frozen.current.callToAction);
    locked.current = true; setBusy(true); setSubmitted(true); setError('');
    try {
      const task = await createImageReplicationDraft({ draft: frozen.current, operationKey: key.current,
        entrySource: request?.assistantEntry ? 'assistant' : 'workspace', isCurrent,
        ports: { createTask: socialContentApi.createTask, createOrResumeRun: socialImageApi.createOrResumeRun, updateTask: socialImageApi.updateTask } });
      if (!isCurrent()) return;
      const queued = await socialImageApi.enqueueExecution(task);
      if (isCurrent()) { startNew.current = true; setCreated(queued.task); }
    } catch (cause) { if (isCurrent()) setError(cause instanceof Error ? cause.message : '复刻任务保存失败，请重试'); }
    finally { locked.current = false; if (isCurrent()) setBusy(false); }
  };

  useEffect(() => {
    if (!created || !startNew.current || handedOff.current === created.id || !isCurrent()) return;
    handedOff.current = created.id; openImageCreationTask(created);
  }, [created]);
  if (created) return <Button onClick={() => openImageCreationTask(created)}>进入创作任务</Button>;

  return <div className={embedded ? "min-w-0 space-y-3" : "flex h-full min-h-0 flex-col bg-surface"} data-image-replication-conversation>
    {!embedded && <LsPageHeader title="图文爆款复刻" extra={<Button onClick={onShowCreations} disabled={busy}>我的创作</Button>}/>}
    <main className={embedded ? "min-w-0" : "min-h-0 flex-1 overflow-y-auto p-4 sm:p-6"}>
      <div className="mx-auto max-w-3xl space-y-5">
        {!embedded && request?.specialRequirements && <p className="whitespace-pre-wrap break-words text-sm text-text-secondary">创作需求：{request.specialRequirements}</p>}
        {QUESTIONS.slice(0, step + 1).map((question, index) => <div key={question} className="space-y-3">
          <div className="ls-messenger-bubble ls-messenger-bubble--inbound"><span className="mb-1 block text-xs opacity-75">灵小枢</span>{question}</div>
          {index < step && answers[index] && <div className="ls-messenger-bubble ls-messenger-bubble--outbound whitespace-pre-wrap"><span className="mb-1 block text-xs opacity-75">已确认</span>{answers[index]}</div>}
        </div>)}
        {loading ? <div role="status"><Spin size="small"/> 正在读取企业产品与已采集图文</div> : null}
        {loadError && <Alert type="warning" showIcon title={loadError} action={<Button size="small" onClick={() => setReload(value => value + 1)}>重新读取</Button>}/>}
        <form className="space-y-4" aria-label="图文复刻问答" onSubmit={event => { event.preventDefault(); if (step < 2) advance(); else void submit(); }}>
          {step === 0 && <>
            <ImageReplicationReferencePicker items={references} reference={reference} disabled={busy || loading} unavailable={Boolean(loadError)} onReload={() => setReload(value => value + 1)}
              onSelect={value => { setReference(value); setError(''); }} onConfirm={advance} onUpload={() => uploadInput.current?.click()}/>
            <input ref={uploadInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label="上传参考图" className="sr-only" disabled={busy || loading}
              onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file); }}/>
          </>}
          {step === 1 && <>
            <label className="block space-y-2"><span>企业产品</span><Select className="w-full" aria-label="企业产品" showSearch optionFilterProp="label" placeholder="选择一个已确认产品"
              value={productId || undefined} disabled={busy || loading} options={products.map(item => ({ value: item.id, label: item.name }))}
              onChange={id => { setProductId(id); setObjective(''); setError(''); }} notFoundContent="企业知识库暂无产品，请先补充产品资料"/></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-2"><span className="block">发布平台</span><Select aria-label="发布平台" className="w-full" value={platform} onChange={setPlatform} options={Object.entries(PLATFORM_LABELS).map(([value, label]) => ({ value, label }))}/></label>
              <label className="space-y-2"><span className="block">图文语言</span><Select aria-label="图文语言" showSearch optionFilterProp="label" className="w-full" value={language} onChange={setLanguage} options={IMAGE_LANGUAGE_OPTIONS}/><span className="block text-xs text-text-secondary">图片创作文案与帖子配文使用同一语言，产品原包装和品牌名保留原样。</span></label>
            </div>
            {product && <p className="text-sm text-text-secondary">{product.highlights ? `已带入产品卖点：${product.highlights}` : '企业资料尚无产品卖点，请补充已确认的信息后继续。'}</p>}
            {product && !product.highlights?.trim() && <label className="block space-y-2"><span>补充产品卖点（必填）</span><Input.TextArea aria-label="核心卖点" maxLength={1000} rows={3} value={objective} onChange={event => setObjective(event.target.value)}/></label>}
            <details><summary className="cursor-pointer text-sm text-text-secondary">补充创作要求（可选）</summary><div className="mt-3 space-y-3">
              {product?.highlights?.trim() && <label className="block space-y-2"><span>这次重点表达什么</span><Input.TextArea aria-label="核心卖点" rows={2} maxLength={1000} value={objective} onChange={event => setObjective(event.target.value)} placeholder="留空使用企业产品卖点"/></label>}
              <label className="block space-y-2"><span>目标受众</span><Input aria-label="目标受众" maxLength={500} value={audience} onChange={event => setAudience(event.target.value)} placeholder="留空由系统依据企业资料策划"/></label>
              <label className="block space-y-2"><span>画幅</span><Select aria-label="画幅" className="w-full" value={aspectRatio} onChange={setAspectRatio} options={['1:1', '4:5', '9:16', '16:9'].map(value => ({ value, label: value }))}/></label>
              <label className="block space-y-2"><span>希望客户采取的行动</span><Input aria-label="客户行动" maxLength={500} value={callToAction} onChange={event => setCallToAction(event.target.value)} placeholder="默认：咨询产品详情"/></label>
            </div></details>
          </>}
          {step === 2 && <section className="space-y-3" aria-label="确认图文复刻需求">
            <dl className="space-y-2 text-sm"><div><dt className="text-text-secondary">本次卖点</dt><dd className="whitespace-pre-wrap">{resolved.objective}</dd></div>
              <div><dt className="text-text-secondary">受众安排</dt><dd>{audience || '由系统依据企业资料策划，资料不足时使用通用产品介绍'}</dd></div>
              <div><dt className="text-text-secondary">交付规格</dt><dd>{PLATFORM_LABELS[platform]} · {aspectRatio} · {imageLanguageLabel(language)} · 一张图片、帖子配文与话题标签</dd></div>
              <div><dt className="text-text-secondary">客户行动</dt><dd>{resolved.callToAction}</dd></div></dl>
            <p className="text-sm text-text-secondary">确认后自动分析参考图、核验企业素材、策划构图与文案、生成图片并质检，使用已配置的模型与额度。有需要你补充的信息时会提示，生成结果由你审阅采用。</p>
          </section>}
          {error && <Alert type="error" showIcon title={error}/>}
          <div className="flex flex-wrap gap-3">
            {step > 0 && <Button type="primary" htmlType="submit" loading={busy} disabled={loading || (step === 1 && !product)}>{step === 1 ? '确认并继续' : submitted ? '恢复本次复刻任务' : '确认并生成首版'}</Button>}
            {step > 0 && !submitted && <Button disabled={busy} onClick={() => { setStep(value => value - 1); setError(''); }}>返回修改</Button>}
          </div>
        </form>
        <div ref={bottom}/>
      </div>
    </main>
  </div>;
}
