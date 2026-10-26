import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Select, Spin } from 'antd';
import { Upload } from 'lucide-react';
import LsPageHeader from '../ui/LsPageHeader';
import { ReviewImage } from './socialImageWorkbenchPresentation';
import SocialImageWorkbench from './SocialImageWorkbench';
import type { SocialContentCreateRequest } from './SocialContentWorkspace';
import type { SocialImageCreationTask } from '../../../shared/contracts/socialImageCreation';
import { readAssistantProductCatalog, type AssistantCatalogProduct } from '../../lib/assistantProductCatalog';
import { studioApi, type Material } from '../../lib/studioApi';
import { socialContentApi } from '../../lib/socialContentApi';
import { socialImageApi } from '../../lib/socialImageApi';
import { productionNavigationIdentity } from '../../lib/productionNavigation';
import { createImageReplicationDraft, imageReplicationDraftIssue,
  type ImageReplicationDraft, type ImageReplicationReference } from '../../lib/imageReplicationDraft';

const QUESTIONS = [
  '先确认要复刻哪张参考图。你可以使用已选图文、从素材库选择，或上传一张图片。',
  '这张图文要推广哪个企业产品？',
  '这次重点突出什么卖点？希望吸引哪类客户？',
  '准备发布到哪里？请确认画幅、配文语言和客户行动。',
  '请核对复刻方案。确认后会创建一个单图任务，并自动生成图片与帖子配文。',
];
const PLATFORM_LABELS = { facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn' };

/** Conversational intake reuses the existing content task and image run; it never starts paid production. */
export default function ImageReplicationConversation({ request, onShowCreations }: {
  request?: SocialContentCreateRequest | null;
  onShowCreations: () => void;
}) {
  const context = request?.sourceContext;
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [reference, setReference] = useState<ImageReplicationReference | null>(() => context?.referenceMediaUrl || context?.referenceThumbnail ? {
    url: context.referenceMediaUrl || context.referenceThumbnail!, title: context.referenceTitle,
    caption: context.referenceCaption, layerBlueprints: context.referenceLayerBlueprints,
  } : null);
  const [products, setProducts] = useState<AssistantCatalogProduct[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [productId, setProductId] = useState('');
  const [objective, setObjective] = useState('');
  const [audience, setAudience] = useState('');
  const hintedPlatform = request?.prefill?.platforms?.[0];
  const [platform, setPlatform] = useState<ImageReplicationDraft['platform']>(
    hintedPlatform === 'instagram' || hintedPlatform === 'linkedin' ? hintedPlatform : 'facebook');
  const hintedRatio = context?.aspectRatio;
  const [aspectRatio, setAspectRatio] = useState<ImageReplicationDraft['aspectRatio']>(
    hintedRatio === '1:1' || hintedRatio === '9:16' || hintedRatio === '16:9' ? hintedRatio : '4:5');
  const [language, setLanguage] = useState<ImageReplicationDraft['language']>('en');
  const [callToAction, setCallToAction] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [created, setCreated] = useState<SocialImageCreationTask>();
  const [submitted, setSubmitted] = useState(false);
  const alive = useRef(true);
  const identity = useRef(productionNavigationIdentity());
  const locked = useRef(false);
  const frozen = useRef<ImageReplicationDraft | undefined>(undefined);
  const key = useRef(`image-replication-${crypto.randomUUID()}`);
  const uploadInput = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const isCurrent = () => alive.current && identity.current === productionNavigationIdentity();

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let active = true; setLoading(true); setLoadError('');
    void Promise.all([readAssistantProductCatalog(), studioApi.listMaterials('all')]).then(([catalog, library]) => {
      if (!active || !isCurrent()) return;
      setProducts(catalog);
      const images = library.filter(item => item.type === 'image' && item.scope !== 'shared');
      setMaterials(images);
      if (context?.referenceMaterialId) {
        const item = images.find(image => image.id === context.referenceMaterialId);
        if (!item?.url) { setReference(null); setLoadError('对话中的参考图片已不可用，请重新选择或上传。'); }
        else setReference({ url: item.url, title: item.name, materialId: item.id });
      }
    }).catch(cause => { if (active && isCurrent()) setLoadError(cause instanceof Error ? cause.message : '产品与参考图片读取失败'); })
      .finally(() => { if (active && isCurrent()) setLoading(false); });
    return () => { active = false; };
  }, [reload, context?.referenceMaterialId]);

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }); }, [step, created]);
  const product = products.find(item => item.id === productId);
  const draft = (): ImageReplicationDraft => ({ reference: reference!, product: product!, objective, audience, platform, aspectRatio, language, callToAction });
  const advance = () => {
    if (busy || loading || submitted) return;
    if (!isCurrent()) { setError('登录状态已变化，请重新打开创作。'); return; }
    let answer = '';
    if (step === 0) {
      if (!reference?.url) { setError('请先选择或上传一张参考图。'); return; }
      answer = `参考图：${reference.title || '已选图文'}。保留构图与视觉层级，替换为企业产品、品牌和已确认的文案。`;
    } else if (step === 1) {
      if (!product) { setError('请选择一个企业知识库中的产品。'); return; }
      answer = `推广产品：${product.name}`;
    } else if (step === 2) {
      if (!objective.trim() || !audience.trim()) { setError('请填写核心卖点和目标受众。'); return; }
      answer = `核心卖点：${objective.trim()}\n目标受众：${audience.trim()}`;
    } else if (step === 3) {
      const issue = imageReplicationDraftIssue(draft());
      if (issue) { setError(issue); return; }
      answer = `${PLATFORM_LABELS[platform]} · ${aspectRatio} · ${language === 'en' ? '英文' : '中文'} · 单图与帖子配文\n客户行动：${callToAction.trim()}`;
    }
    setAnswers(previous => [...previous.slice(0, step), answer]); setStep(step + 1); setError('');
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
      setMaterials(previous => [...previous.filter(item => item.id !== result.material.id), result.material]);
    } catch (cause) { if (isCurrent()) setError(cause instanceof Error ? cause.message : '参考图上传失败'); }
    finally { locked.current = false; if (isCurrent()) setBusy(false); }
  };

  const submit = async () => {
    if (locked.current || step !== 4 || !reference || !product) return;
    if (!isCurrent()) { setError('登录状态已变化，请重新打开创作。'); return; }
    frozen.current ||= structuredClone(draft());
    locked.current = true; setBusy(true); setSubmitted(true); setError('');
    try {
      const task = await createImageReplicationDraft({ draft: frozen.current, operationKey: key.current,
        entrySource: request?.assistantEntry ? 'assistant' : 'workspace', isCurrent,
        ports: { createTask: socialContentApi.createTask, createOrResumeRun: socialImageApi.createOrResumeRun, updateTask: socialImageApi.updateTask } });
      if (isCurrent()) setCreated(task);
    } catch (cause) { if (isCurrent()) setError(cause instanceof Error ? cause.message : '复刻任务保存失败，请重试'); }
    finally { locked.current = false; if (isCurrent()) setBusy(false); }
  };

  if (created) return <SocialImageWorkbench creationPath="viral_replication" initialTask={created} autoStart
    contentTaskId={created.productionRuntime?.binding?.contentTaskId} entrySource={request?.assistantEntry ? 'assistant' : 'workspace'}
    referenceTitle={created.referenceSnapshot?.title} referenceMediaUrl={created.referenceSnapshot?.imageUrls[0]}
    referenceCaption={created.referenceSnapshot?.caption} referenceLayerBlueprints={created.replicationRecipe?.referenceLayerBlueprints}
    onShowCreations={onShowCreations}/>;

  return <div className="flex h-full min-h-0 flex-col bg-surface" data-image-replication-conversation>
    <LsPageHeader title="图文爆款复刻" extra={<Button onClick={onShowCreations} disabled={busy}>我的创作</Button>}/>
    <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-3xl space-y-5">
        {request?.specialRequirements && <p className="whitespace-pre-wrap break-words text-sm text-text-secondary">创作需求：{request.specialRequirements}</p>}
        {QUESTIONS.slice(0, step + 1).map((question, index) => <div key={question} className="space-y-3">
          <div className="ls-messenger-bubble ls-messenger-bubble--inbound"><span className="mb-1 block text-xs opacity-75">灵小枢</span>{question}</div>
          {answers[index] && <div className="ls-messenger-bubble ls-messenger-bubble--outbound whitespace-pre-wrap"><span className="mb-1 block text-xs opacity-75">已确认</span>{answers[index]}</div>}
        </div>)}
        {loading ? <div role="status"><Spin size="small"/> 正在读取企业产品与图片素材</div> : null}
        {loadError && <Alert type="warning" showIcon title={loadError} action={<Button size="small" onClick={() => setReload(value => value + 1)}>重新读取</Button>}/>}
        <form className="space-y-4" aria-label="图文复刻问答" onSubmit={event => { event.preventDefault(); if (step < 4) advance(); else void submit(); }}>
          {step === 0 && <>
            {reference && <div className="h-64 overflow-hidden rounded-lg border border-border"><ReviewImage key={reference.url} src={reference.url} alt={`参考图：${reference.title}`}/></div>}
            {reference && <p className="break-words text-sm text-text-secondary">参考图：{reference.title}</p>}
            <label className="block space-y-2"><span>从图片素材库选择参考</span><Select className="w-full" aria-label="参考图" showSearch optionFilterProp="label" placeholder="选择一张参考图片"
              value={reference?.materialId} disabled={busy || loading} options={materials.map(item => ({ value: item.id, label: item.name }))}
              onChange={id => { const item = materials.find(value => value.id === id); if (item) { setReference({ url: item.url, title: item.name, materialId: item.id }); setError(''); } }}/></label>
            <input ref={uploadInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label="上传参考图" className="sr-only" disabled={busy || loading}
              onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file); }}/>
            <Button icon={<Upload size={16}/>} loading={busy} disabled={loading} onClick={() => uploadInput.current?.click()}>上传参考图</Button>
          </>}
          {step === 1 && <label className="block space-y-2"><span>企业产品</span><Select className="w-full" aria-label="企业产品" showSearch optionFilterProp="label" placeholder="选择一个已确认产品"
            value={productId || undefined} disabled={busy || loading} options={products.map(item => ({ value: item.id, label: item.name }))}
            onChange={id => setProductId(id)} notFoundContent="企业知识库暂无产品，请先补充产品资料"/></label>}
          {step === 2 && <>
            <label className="block space-y-2"><span>核心卖点或创作目标</span><Input.TextArea aria-label="核心卖点" rows={3} maxLength={1000} showCount value={objective} onChange={event => setObjective(event.target.value)} placeholder="填写本次要表达的真实产品卖点"/></label>
            <label className="block space-y-2"><span>目标受众</span><Input aria-label="目标受众" maxLength={500} value={audience} onChange={event => setAudience(event.target.value)} placeholder="例如：海外品牌采购负责人"/></label>
          </>}
          {step === 3 && <>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="space-y-2"><span className="block">发布平台</span><Select aria-label="发布平台" className="w-full" value={platform} onChange={setPlatform} options={Object.entries(PLATFORM_LABELS).map(([value, label]) => ({ value, label }))}/></label>
              <label className="space-y-2"><span className="block">画幅</span><Select aria-label="画幅" className="w-full" value={aspectRatio} onChange={setAspectRatio} options={['1:1', '4:5', '9:16', '16:9'].map(value => ({ value, label: value }))}/></label>
              <label className="space-y-2"><span className="block">配文语言</span><Select aria-label="配文语言" className="w-full" value={language} onChange={setLanguage} options={[{ value: 'en', label: '英文' }, { value: 'zh', label: '中文' }]}/></label>
            </div>
            <label className="block space-y-2"><span>希望客户采取的行动</span><Input aria-label="客户行动" maxLength={500} value={callToAction} onChange={event => setCallToAction(event.target.value)} placeholder="例如：咨询产品详情、申请样品"/></label>
          </>}
          {step === 4 && <Alert type="info" showIcon title="交付：一张复刻图片、帖子配文与话题标签"
            description="确认后自动分析参考图、核验企业素材、策划并生成一张图片与配文。生成会使用当前配置的模型与额度；缺少必要素材、授权或执行条件时会停止并提示。生成结果仍需你审阅采用。"/>}
          {error && <Alert type="error" showIcon title={error}/>}
          <div className="flex flex-wrap gap-3">
            <Button type="primary" htmlType="submit" loading={busy} disabled={loading || (step === 0 && !reference) || (step === 1 && !product)}>{step < 4 ? '确认并继续' : submitted ? '恢复本次复刻任务' : '确认并生成首版'}</Button>
            {step > 0 && !submitted && <Button disabled={busy} onClick={() => { setStep(value => value - 1); setAnswers(previous => previous.slice(0, step - 1)); setError(''); }}>返回修改</Button>}
          </div>
        </form>
        <div ref={bottom}/>
      </div>
    </main>
  </div>;
}
