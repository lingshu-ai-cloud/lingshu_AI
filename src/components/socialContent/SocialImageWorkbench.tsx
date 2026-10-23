import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Input, Modal, Select, Spin, Steps, Tag } from 'antd';
import { FileImage, ImagePlus, Layers3, RefreshCw, Upload } from 'lucide-react';
import LsPageHeader from '../ui/LsPageHeader';
import { LsMediaStateFrame } from '../ui/LsExperiencePrimitives';
import { CHECK_LABELS, IMAGE_TYPES, STEP_ITEMS, passedQualityKeys, posterStyleForType, resolvedQuality,
  ReviewImage, topicForType } from './socialImageWorkbenchPresentation';
import { SocialImageReviewActions } from './SocialImageReviewActions';
import { authHeader } from '../../lib/auth';
import { socialImageApi } from '../../lib/socialImageApi';
import { socialContentApi } from '../../lib/socialContentApi';
import { runPlannedMultiOutput } from '../../lib/socialImageCarousel';
import { studioApi, type FbPosterBrief, type Material } from '../../lib/studioApi';
import {
  SOCIAL_IMAGE_HARD_CHECKS,
  socialImageOutputHardChecksPassed,
  socialImageReviewOutputs,
  type SocialImageContentType,
  type SocialImageCreationPath,
  type SocialImageCreationTask,
  type SocialImageEnterpriseAssetBinding,
  type SocialImageQualityCheckKey,
  type SocialImageReferenceLayerBlueprint,
  type SocialImageRepairInstruction,
} from '../../../shared/contracts/socialImageCreation';

type ProductOption = { id: string; name: string };
type WorkbenchStep = 'type' | 'inputs' | 'plan' | 'generate' | 'review';

type PlannedRun = { task: SocialImageCreationTask; poster: FbPosterBrief; caption: string };

function actionableConfirmationFields(fields: string[] = []) {
  return [...new Set(fields.map(String).map(item => item.trim()).filter(item => item && item !== '图文策划需人工审阅'))];
}

function hasUnresolvedPaidImageJob(task: SocialImageCreationTask | null): boolean {
  return Boolean(task?.generationJobs?.some(job =>
    (task.imageType === 'carousel' || task.imageType === 'gif_poster' ? ['running', 'outcome_unknown'] : ['queued', 'running', 'outcome_unknown']).includes(job.status)
      && !job.outputNodeIds.length,
  ));
}

interface SocialImageWorkbenchProps {
  creationPath: SocialImageCreationPath;
  contentTaskId?: string;
  entrySource?: 'assistant' | 'workspace' | 'weekly_package';
  referenceTitle?: string;
  referenceThumbnail?: string;
  referenceMediaUrl?: string;
  referenceCaption?: string;
  referenceLayerBlueprints?: SocialImageReferenceLayerBlueprint[];
  initialTask?: SocialImageCreationTask;
  onShowCreations: () => void;
}

export function socialImageWorkbenchScopeKey(props: Pick<SocialImageWorkbenchProps, 'creationPath' | 'contentTaskId' | 'initialTask' | 'referenceMediaUrl' | 'referenceThumbnail' | 'referenceTitle'>) {
  return props.initialTask?.id ? `image-task:${props.initialTask.id}`
    : props.contentTaskId ? `content-task:${props.contentTaskId}`
      : `new:${props.creationPath}:${props.referenceMediaUrl || props.referenceThumbnail || props.referenceTitle || 'blank'}`;
}

export default function SocialImageWorkbench(props: SocialImageWorkbenchProps) {
  return <SocialImageWorkbenchSession key={socialImageWorkbenchScopeKey(props)} {...props} />;
}

function SocialImageWorkbenchSession({
  creationPath, contentTaskId, entrySource = 'workspace', referenceTitle, referenceThumbnail, referenceMediaUrl, referenceCaption,
  referenceLayerBlueprints, initialTask, onShowCreations,
}: SocialImageWorkbenchProps) {
  const carouselPending = (initialTask?.imageType === 'carousel' || initialTask?.imageType === 'gif_poster') && initialTask.renderPlan?.units.some(unit =>
    !initialTask.generationJobs.find(job => job.id === unit.jobId)?.outputNodeIds.length);
  const restoredStep: WorkbenchStep = carouselPending ? 'generate' : initialTask?.step === 'motion' ? 'review' : initialTask?.step === 'type' ? 'inputs' : initialTask?.step || 'inputs';
  const [step, setStep] = useState<WorkbenchStep>(restoredStep);
  const [imageType, setImageType] = useState<SocialImageContentType>(initialTask?.imageType || 'product_poster');
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [productIds, setProductIds] = useState<string[]>(initialTask?.contentBrief.productRefs || []);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialIds, setMaterialIds] = useState<string[]>(initialTask?.materialIds || []);
  const [title, setTitle] = useState(initialTask?.title || (creationPath === 'viral_replication' ? '爆款复刻 · 图片草稿' : '自由创作 · 图片草稿'));
  const [coreClaim, setCoreClaim] = useState(initialTask?.contentBrief.coreClaim || '');
  const [audience, setAudience] = useState(initialTask?.contentBrief.audience[0] || '海外品牌研发与采购');
  const [platform, setPlatform] = useState<'facebook' | 'instagram' | 'linkedin'>((initialTask?.deliverySpec.platform === 'instagram' || initialTask?.deliverySpec.platform === 'linkedin') ? initialTask.deliverySpec.platform : 'facebook');
  const [ratio, setRatio] = useState<'1:1' | '4:5' | '9:16' | '16:9'>(
    initialTask && ['1:1', '4:5', '9:16', '16:9'].includes(initialTask.deliverySpec.aspectRatio)
      ? initialTask.deliverySpec.aspectRatio : '4:5');
  const [language, setLanguage] = useState<'en' | 'zh'>(initialTask?.deliverySpec.language === 'zh' ? 'zh' : 'en');
  const [imageQuality, setImageQuality] = useState<'low' | 'medium' | 'high'>(initialTask?.deliverySpec.imageGeneration?.quality || 'low');
  const [factuality, setFactuality] = useState<'verified' | 'user_supplied' | 'mock'>(initialTask?.contentBrief.factuality || 'verified');
  const [task, setTask] = useState<SocialImageCreationTask | null>(initialTask || null);
  const [poster, setPoster] = useState<FbPosterBrief | null>(initialTask?.renderBrief || null);
  const [caption, setCaption] = useState(initialTask?.imageTextContract.caption || '');
  const [hashtags, setHashtags] = useState<string[]>(initialTask?.imageTextContract.hashtags || []);
  const [imageUrl, setImageUrl] = useState(initialTask?.outputs.find(output => output.role === 'gif_output' && output.state !== 'superseded')?.mediaUrl
    || initialTask?.outputs.find(output => output.mediaUrl && output.role !== 'gif_plate')?.mediaUrl || '');
  const [fieldsToConfirm, setFieldsToConfirm] = useState<string[]>(actionableConfirmationFields(initialTask?.fieldsToConfirm));
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [confirmationValues, setConfirmationValues] = useState<Record<string, string>>(() => Object.fromEntries(
    (initialTask?.contentBrief.evidenceItems || []).filter(item => item.source === 'user_input').map(item => [item.label, item.value]),
  ));
  const [qualityPasses, setQualityPasses] = useState<SocialImageQualityCheckKey[]>(initialTask ? passedQualityKeys(initialTask.outputs) : []);
  const [busy, setBusy] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [contentTaskHydrating, setContentTaskHydrating] = useState(Boolean(contentTaskId && !initialTask));
  const [contentTaskReady, setContentTaskReady] = useState(Boolean(!contentTaskId || initialTask));
  const [generationElapsed, setGenerationElapsed] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [repairRequest, setRepairRequest] = useState('');
  const uploadRef = useRef<HTMLInputElement>(null);
  const generationAbortRef = useRef<AbortController | null>(null);
  const generationAbortReasonRef = useRef<'manual' | 'deadline' | null>(null);
  const contentTaskRef = useRef<Awaited<ReturnType<typeof socialContentApi.getTask>> | null>(null);
  const formDirtyRef = useRef(false);
  const runRequestKeyRef = useRef(`image-workbench-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`);

  useEffect(() => () => generationAbortRef.current?.abort(), []);

  useEffect(() => {
    if (!contentTaskId || initialTask) return;
    let active = true;
    setContentTaskHydrating(true);
    setContentTaskReady(false);
    setError('');
    void socialContentApi.getTask(contentTaskId).then(content => {
      if (!active) return;
      contentTaskRef.current = content;
      setTitle(content.brief.title || '图片内容制作');
      setCoreClaim(content.brief.objective || '');
      setProductIds(content.brief.productId ? [content.brief.productId] : []);
      setAudience(content.brief.audience || '海外品牌研发与采购');
      if (content.brief.platforms[0] === 'facebook' || content.brief.platforms[0] === 'instagram' || content.brief.platforms[0] === 'linkedin') {
        setPlatform(content.brief.platforms[0]);
      }
      if (content.brief.aspectRatio === '1:1' || content.brief.aspectRatio === '4:5'
        || content.brief.aspectRatio === '9:16' || content.brief.aspectRatio === '16:9') {
        setRatio(content.brief.aspectRatio);
      }
      setLanguage(content.brief.languages[0] === 'zh' ? 'zh' : 'en');
      formDirtyRef.current = false;
      setContentTaskReady(true);
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : '统一内容任务读取失败');
    }).finally(() => {
      if (active) setContentTaskHydrating(false);
    });
    return () => { active = false; };
  }, [contentTaskId, initialTask]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch('/api/overseas/enterprise/profile', { headers: authHeader(), credentials: 'same-origin' }).then(response => response.ok ? response.json() : Promise.reject(new Error('企业产品读取失败'))),
      studioApi.listMaterials('all'),
    ]).then(([profileResult, library]) => {
      if (!active) return;
      const profile = profileResult.profile || profileResult;
      const items = (profile.products?.items || []).map((item: Record<string, unknown>, index: number) => ({
        id: String(item.id || item.productId || item.sku || `product-${index}`), name: String(item.name || '').trim(),
      })).filter((item: ProductOption) => item.name);
      setProducts(items);
      setMaterials(library.filter(item => item.type === 'image' && item.scope !== 'shared').slice(0, 60));
    }).catch(reason => setError(reason instanceof Error ? reason.message : '企业素材读取失败'));
    return () => { active = false; };
  }, []);

  const selectedProducts = useMemo(() => products.filter(item => productIds.includes(item.id)), [productIds, products]);
  const selectedMaterials = useMemo(() => materials.filter(item => materialIds.includes(item.id)), [materialIds, materials]);
  const resolvedCoreClaim = coreClaim.trim() || selectedProducts.map(item => item.name).join('、') || '企业产品展示';
  const currentStepIndex = step === 'type' || step === 'inputs'
    ? STEP_ITEMS.findIndex(item => item.key === 'inputs')
    : step === 'plan' || step === 'generate'
    ? STEP_ITEMS.findIndex(item => item.key === 'production')
    : STEP_ITEMS.findIndex(item => item.key === step);
  const hardChecks = SOCIAL_IMAGE_HARD_CHECKS;
  const multiOutput = imageType === 'carousel' || imageType === 'gif_poster';
  const recoverableJob = task?.generationJobs.find(job => ['running', 'outcome_unknown'].includes(job.status) && !job.outputNodeIds.length);
  const carouselPages = task?.imageType === 'carousel' || task?.imageType === 'gif_poster' ? task.renderPlan?.units.map(unit => ({
    unit, output: task.outputs.find(output => output.role === (task.imageType === 'gif_poster' && task.gifDelivery ? 'gif_frame' : unit.role)
      && output.label === unit.label && output.state !== 'superseded'),
  })) || [] : [];
  const reviewOutputs = task ? socialImageReviewOutputs(task) : [];
  const reviewCandidate = imageType === 'gif_poster' ? reviewOutputs.at(-1) : reviewOutputs[0];
  const legacyReadOnly = Boolean(task && (task.schemaVersion !== 'social-image-creation.v3' || !task.productionRuntime?.binding));
  const directorAccepted = Boolean(reviewCandidate && task?.directorReviewDecision?.decision === 'accept_for_user_review'
    && task.directorReviewDecision.candidateId === reviewCandidate.id
    && task.directorReviewDecision.candidateVersion === reviewCandidate.version
    && (!multiOutput || reviewOutputs.every((output, index) => {
      const ref = task.directorReviewDecision?.candidateRefs?.[index];
      return ref?.id === output.id && ref.version === output.version && ref.contentHash === output.contentHash;
    })));
  const reviewHardChecksPassed = reviewOutputs.length > 0 && reviewOutputs.every(output =>
    ['quality_checking', 'approved'].includes(output.state) && socialImageOutputHardChecksPassed(output));
  const reviewQualityPasses = hardChecks.filter(key => reviewOutputs.length > 0 && reviewOutputs.every(output =>
    output.qualityChecks.some(check => check.key === key && check.severity === 'hard' && resolvedQuality(check.verdict))));

  const reconcileSavedImage = async () => {
    if (!task || !recoverableJob) return;
    setBusy(true); setReconciling(true); setError(''); setNotice('正在核对已有素材；不会重新调用图片供应商。');
    try {
      const result = await socialImageApi.reconcileMaterial(task.id, recoverableJob.id);
      const pendingCarouselPage = (result.task.imageType === 'carousel' || result.task.imageType === 'gif_poster') && result.task.renderPlan?.units.some(unit =>
        !result.task.generationJobs.find(job => job.id === unit.jobId)?.outputNodeIds.length);
      const gifNeedsFinalization = result.task.imageType === 'gif_poster' && !result.task.gifDelivery;
      setTask(result.task); if (result.task.imageType !== 'gif_poster') setImageUrl(result.url);
      setStep(pendingCarouselPage || gifNeedsFinalization ? 'generate' : 'review');
      setQualityPasses(passedQualityKeys(result.task.outputs));
      setNotice(pendingCarouselPage || gifNeedsFinalization ? '已找回当前多图单元。可继续未提交的单元或收口 GIF，不会重新生成已保存单元。'
        : '已从企业素材库找回成片并关联任务；质量检查仍待确认。');
    } catch (reason) {
      setNotice(''); setError(reason instanceof Error ? reason.message : '未找到可安全关联的成片；不会重新生成图片。');
      void socialImageApi.getTask(task.id).then(result => setTask(result.task)).catch(() => undefined);
    } finally { setReconciling(false); setBusy(false); }
  };

  const uploadImages = async (files: File[]) => {
    const valid = files.filter(file => file.type.startsWith('image/')).slice(0, 8);
    if (!valid.length) { setError('请选择 JPG、PNG、GIF 或 WebP 图片。'); return; }
    setBusy(true); setError(''); setNotice('正在上传企业图片素材…');
    try {
      const uploaded: Material[] = [];
      for (const file of valid) {
        const result = await studioApi.uploadMaterialFile(file, { folder: 'upload', type: 'image', sourceType: 'social-image-workbench' });
        if (!result.ok || !result.material) throw new Error(result.error || `${file.name} 上传失败`);
        uploaded.push(result.material);
      }
      setMaterials(current => [...uploaded, ...current.filter(item => !uploaded.some(next => next.id === item.id))]);
      setMaterialIds(current => [...new Set([...current, ...uploaded.map(item => item.id)])]);
      formDirtyRef.current = true;
      setNotice(`已上传并选择 ${uploaded.length} 张企业图片。`);
    } catch (reason) { setNotice(''); setError(reason instanceof Error ? reason.message : '图片上传失败'); }
    finally { setBusy(false); }
  };

  const ensureTask = async () => {
    if (task && !task.productionRuntime?.binding) {
      throw new Error('历史图片项目未绑定统一内容任务，已按只读方式恢复；不能自动新建任务或再次发起付费生成。请从原项目继续核对已有产物。');
    }
    const benchmarkImage = referenceMediaUrl || referenceThumbnail || '';
    const enterpriseAssets: SocialImageEnterpriseAssetBinding[] = [
      ...selectedProducts.map(item => ({ assetId: item.id, role: 'product' as const, name: item.name, source: 'enterprise_knowledge_base' as const, required: true })),
      ...selectedMaterials.map(item => ({ assetId: item.id, role: /logo|标志|品牌标识/i.test(item.name) ? 'logo' as const : 'scene' as const,
        name: item.name, source: 'enterprise_material_library' as const, contentHash: item.contentSha256, required: true })),
    ];
    let content = contentTaskRef.current;
    const boundContentTaskId = task?.productionRuntime?.binding?.contentTaskId;
    const requestedContentTaskId = boundContentTaskId || contentTaskId;
    if (!content && requestedContentTaskId) content = await socialContentApi.getTask(requestedContentTaskId);
    if (!content) {
      content = await socialContentApi.createTask({
        title: title.trim() || '图片内容制作', objective: resolvedCoreClaim,
        productId: productIds[0] || null, productRef: selectedProducts[0]?.name || null, audience,
        platforms: [platform], languages: [language], formats: ['social_image'], aspectRatio: ratio,
        requestedOutputCount: 1, callToAction: '联系销售或申请样品', creationMode: creationPath,
        assetAvailability: selectedMaterials.length ? 'ready' : 'none', managementMode: 'one_click_managed',
        productionMode: 'social_ready', productionApproach: 'ai_enhanced', mode: entrySource === 'weekly_package' ? 'weekly' : 'instant',
        themeId: 'product_value', topic: title.trim() || resolvedCoreClaim,
      }, `${runRequestKeyRef.current}:content`);
    } else if (formDirtyRef.current) {
      const existingContent = content;
      const changes = {
        title: title.trim() || '图片内容制作', objective: resolvedCoreClaim,
        productId: productIds[0] || null, productRef: selectedProducts[0]?.name || null, audience,
        platforms: [platform], languages: [language], formats: ['social_image'], aspectRatio: ratio,
        requestedOutputCount: 1, callToAction: '联系销售或申请样品', creationMode: creationPath,
        assetAvailability: selectedMaterials.length ? 'ready' as const : 'none' as const,
      };
      const changed = Object.entries(changes).some(([key, value]) => JSON.stringify(existingContent.brief[key as keyof typeof existingContent.brief]) !== JSON.stringify(value));
      if (changed) content = await socialContentApi.updateTask(existingContent.taskId, { expectedVersion: existingContent.version, changes },
        `${runRequestKeyRef.current}:content:${existingContent.version}`);
    }
    if (!content) throw new Error('统一内容任务创建失败');
    contentTaskRef.current = content;
    formDirtyRef.current = false;
    if (task) {
      const binding = task.productionRuntime?.binding;
      if (binding) {
        if (binding.contentTaskId !== content.taskId) throw new Error('图片运行与统一内容任务不一致，请刷新后重试');
        if (binding.contentTaskVersion === content.version) return task;
        const refreshed = await socialImageApi.refreshContentTask(task, content.version);
        setTask(refreshed.task);
        return refreshed.task;
      }
    }
    const created = await socialImageApi.createOrResumeRun(content.taskId, {
      expectedContentTaskVersion: content.version,
      idempotencyKey: `${runRequestKeyRef.current}:run`,
      deliverableKey: 'primary-image', entrySource, imageType,
    });
    const configured = await socialImageApi.updateTask(created.task, {
      title, creationPath, imageType, materialIds, enterpriseAssets,
      contentBrief: { ...created.task.contentBrief, coreClaim: resolvedCoreClaim, productRefs: productIds,
        productNames: selectedProducts.map(item => item.name), audience: [audience], factuality, topicType: topicForType(imageType) },
      deliverySpec: { ...created.task.deliverySpec, platform, aspectRatio: ratio, language },
      referenceUrls: [benchmarkImage].filter((value): value is string => Boolean(value)),
      ...(creationPath === 'viral_replication' ? { referenceSnapshot: {
        sourceUrl: referenceMediaUrl || referenceThumbnail, title: referenceTitle, caption: referenceCaption, imageUrls: benchmarkImage ? [benchmarkImage] : [],
        collectedAt: new Date().toISOString(), fingerprint: '',
      }, replicationRecipe: { ...created.task.replicationRecipe!, referenceLayerBlueprints } } : {}),
    });
    setTask(configured.task);
    return configured.task;
  };

  const saveInputs = async () => {
    if (contentTaskHydrating) { setError('正在读取统一内容任务，请稍候。'); return; }
    if (contentTaskId && !initialTask && !contentTaskReady) { setError('统一内容任务尚未成功读取，不能使用默认值继续生产。'); return; }
    if (!selectedProducts.length) { setError('请选择至少一个企业产品。'); return; }
    if (imageType === 'gif_poster' && selectedProducts.length > 2) { setError('GIF 固定图层目前支持 1–2 个企业产品。'); return; }
    setBusy(true); setError('');
    try {
      const current = await ensureTask();
      const saved = await socialImageApi.updateTask(current, {
        title, imageType, step: 'plan', materialIds,
        enterpriseAssets: [
          ...selectedProducts.map(item => ({ assetId: item.id, role: 'product' as const, name: item.name, source: 'enterprise_knowledge_base' as const, required: true })),
          ...selectedMaterials.map(item => ({ assetId: item.id, role: /logo|标志|品牌标识/i.test(item.name) ? 'logo' as const : 'scene' as const, name: item.name, source: 'enterprise_material_library' as const, contentHash: item.contentSha256, required: true })),
        ],
        contentBrief: { ...current.contentBrief, coreClaim: resolvedCoreClaim, productRefs: productIds, productNames: selectedProducts.map(item => item.name), audience: [audience], factuality, topicType: topicForType(imageType) as SocialImageCreationTask['contentBrief']['topicType'] },
        deliverySpec: { ...current.deliverySpec, platform, aspectRatio: ratio, language, imageGeneration: { provider: 'openai', model: 'gpt-image-2', quality: imageQuality }, format: imageType === 'gif_poster' ? 'gif' : imageType === 'carousel' ? 'carousel' : 'jpg', outputCount: imageType === 'carousel' || imageType === 'gif_poster' ? 4 : 1,
          motion: imageType === 'gif_poster' ? current.deliverySpec.motion || { mechanism: 'background_switch', fixedLayers: ['headline', 'content_module', 'brand'], dynamicLayers: ['background'], loopDurationMs: 6000 } : undefined },
      });
      setTask(saved.task); setStep('plan'); setNotice('正在校验企业素材字节并生成参考图区域证据…');
      const evidenced = await socialImageApi.prepareEvidence(saved.task);
      setTask(evidenced.task); setNotice('输入与图片证据已冻结，正在自动完成图文策划与首版生成…');
      const planned = await requestPlan(evidenced.task, confirmationValues);
      if (planned) await generateImage(planned);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '图片任务保存失败'); }
    finally { setBusy(false); }
  };

  async function requestPlan(activeTask: SocialImageCreationTask, confirmedFacts: Record<string, string>): Promise<PlannedRun | null> {
    const result = await studioApi.fbPoster({
      mode: creationPath === 'viral_replication' ? 'clone' : 'product',
      productInfo: selectedProducts.map(item => `产品名称：${item.name}`).join('\n'),
      platform, ratio, posterStyle: posterStyleForType(imageType), language,
      materials: selectedMaterials.map(item => ({ id: item.id, name: item.name, type: item.type, folder: item.folder, role: item.shotFunction || item.primaryTheme || '企业图片素材' })),
      referenceNotes: [referenceTitle ? `对标作品：${referenceTitle}` : '', `核心主张：${resolvedCoreClaim}`, `内容类型：${IMAGE_TYPES.find(item => item.id === imageType)?.label}`].filter(Boolean).join('\n'),
      referenceCaption: activeTask.referenceSnapshot?.caption || referenceCaption || '',
      categoryTerms: selectedProducts.map(item => item.name),
      targetMarket: audience,
      confirmedFields: confirmedFacts,
    });
    if (!result.ok || !result.poster) throw new Error(result.error || '图文策划生成失败');
    const pendingFields = actionableConfirmationFields([...fieldsToConfirm, ...(result.fieldsToConfirm || [])]);
    setPoster(result.poster); setCaption(result.caption); setHashtags(result.hashtags || []); setFieldsToConfirm(pendingFields);
    const saved = await socialImageApi.updateTask(activeTask, {
      status: 'planned', step: 'generate', fieldsToConfirm: pendingFields,
      renderBrief: result.poster,
      imageTextContract: {
        ...activeTask.imageTextContract, headline: result.poster.headline, supportingText: result.poster.subheadline,
        caption: result.caption, hashtags: result.hashtags || [], cta: result.poster.cta,
        requiredFacts: [resolvedCoreClaim], prohibitedInferences: activeTask.contentBrief.prohibitedClaims,
        visualMustShow: selectedProducts.map(item => item.name), visualMustNotImply: factuality === 'mock' ? ['真实已发生的合作或发布'] : [],
      },
    });
    setTask(saved.task); setStep('generate');
    setNotice(pendingFields.length
      ? '已自动移除未经确认的商业声明，正在生成可审阅首版；相关风险将在审阅交付中提示。'
      : '图文策划已完成，正在直接生成首版图片…');
    return { task: saved.task, poster: result.poster, caption: result.caption };
  }

  const generatePlan = async () => {
    if (!task) return;
    setBusy(true); setError(''); setNotice('正在依据企业资料生成图文策划…');
    try {
      const planned = await requestPlan(task, confirmationValues);
      if (planned) await generateImage(planned);
    } catch (reason) { setNotice(''); setError(reason instanceof Error ? reason.message : '图文策划生成失败'); }
    finally { setBusy(false); }
  };

  const confirmMissingInformation = async () => {
    if (!task) return;
    if (task.renderPlan) { setConfirmationOpen(false); setError('图片付费计划已冻结；请先显式废弃计划并核对已有回执，再修改事实输入。'); return; }
    const suppliedFields = fieldsToConfirm.filter(field => confirmationValues[field]?.trim());
    const remainingFields = fieldsToConfirm.filter(field => !confirmationValues[field]?.trim());
    setBusy(true); setError(''); setNotice('正在统一保存已补充信息…');
    try {
      const retainedEvidence = task.contentBrief.evidenceItems.filter(item => item.source !== 'user_input' || !fieldsToConfirm.includes(item.label));
      const suppliedEvidence = suppliedFields.map(field => ({
        id: `user-confirmed:${field}`, label: field, source: 'user_input' as const, value: confirmationValues[field]!.trim(),
      }));
      const saved = await socialImageApi.updateTask(task, {
        fieldsToConfirm: remainingFields,
        contentBrief: { ...task.contentBrief, evidenceItems: [...retainedEvidence, ...suppliedEvidence] },
      });
      setTask(saved.task); setConfirmationOpen(false); setFieldsToConfirm(remainingFields);
      setNotice(remainingFields.length ? '已保存本次补充信息；其余待确认项不影响成片，可稍后继续处理。' : '待确认信息已统一保存。');
    } catch (reason) { setNotice(''); setError(reason instanceof Error ? reason.message : '补充信息保存失败'); }
    finally { setBusy(false); }
  };

  const generateLayeredImage = async (planned: PlannedRun): Promise<boolean> => {
    setBusy(true); setError(''); setNotice('正在编译对标图层并使用企业产品生成首版…');
    try {
      const compiled = await socialImageApi.compileLayered(planned.task);
      const rendered = await socialImageApi.renderLayered(compiled.task);
      setTask(rendered.task); setImageUrl(rendered.url); setStep('review');
      const preflight = await socialImageApi.runPreflight(rendered.task);
      setTask(preflight.task);
      setQualityPasses(passedQualityKeys(preflight.task.outputs));
      setNotice(preflight.task.fieldsToConfirm.length
        ? '首版已生成。未经确认的商业信息不会出现在成片中，请在审阅交付中继续修改或补充。'
        : '首版已完成分层渲染和确定性预检。');
      return true;
    } catch {
      setError('');
      setNotice('分层资产不完整，已自动切换通用渲染继续生成首版…');
      return false;
    }
    finally { setBusy(false); }
  };

  const generateMultiOutputImage = async (sourceTask: SocialImageCreationTask) => {
    const isGif = sourceTask.imageType === 'gif_poster';
    if (hasUnresolvedPaidImageJob(sourceTask)) {
      setError('多图任务有结果未明的单元，请先核对已落库成片；不会自动重复提交付费请求。');
      return;
    }
    if (isGif && !sourceTask.renderPlan) {
      const confirmed = await new Promise<boolean>(resolve => Modal.confirm({
        title: '确认生成 GIF 的 4 张背景底图？',
        content: `这将按顺序最多提交 4 个独立的 GPT Image 2 付费请求（当前质量：${sourceTask.deliverySpec.imageGeneration?.quality || 'low'}）。每张底图保存后才继续下一张；结果不明时停止，不自动重试。`,
        okText: '确认并生成', cancelText: '暂不生成',
        onOk: () => { resolve(true); }, onCancel: () => { resolve(false); },
      }));
      if (!confirmed) { setStep('generate'); setNotice('尚未提交 GIF 背景底图付费请求；可稍后继续。'); return; }
    }
    const controller = new AbortController();
    generationAbortRef.current = controller;
    generationAbortReasonRef.current = null;
    setGenerationElapsed(0);
    const elapsedTimer = window.setInterval(() => setGenerationElapsed(value => value + 1), 1000);
    setBusy(true); setError(''); setStep('generate'); setNotice('已冻结多图计划，正在逐单元生成；任一结果不明会停止后续付费提交。');
    try {
      const rendered = await runPlannedMultiOutput({
        task: sourceTask,
        planUnits: async current => {
          const result = await socialImageApi.planUnits(current);
          if (!result.paidExecutionEnabled) throw new Error('多图付费执行尚未通过服务端准入');
          return result.task;
        },
        renderUnit: async (taskId, jobId) => {
          const deadlineTimer = window.setTimeout(() => { generationAbortReasonRef.current = 'deadline'; controller.abort(); }, 195_000);
          try { return await socialImageApi.renderPlannedUnit(taskId, jobId, controller.signal); }
          finally { window.clearTimeout(deadlineTimer); }
        },
        onTask: (current, url) => {
          setTask(current);
          if (url && !isGif) setImageUrl(url);
          const completed = current.renderPlan?.units.filter(unit => current.generationJobs.find(job => job.id === unit.jobId)?.outputNodeIds.length).length || 0;
          setNotice(`${isGif ? 'GIF 底图' : '轮播页'}已保存 ${completed}/${current.renderPlan?.units.length || 4} 张；下一张只在上一张持久化后提交。`);
        },
        signal: controller.signal,
      });
      const finished = isGif ? await socialImageApi.finalizeGif(rendered) : null;
      if (finished) { setTask(finished.task); setImageUrl(finished.url); }
      const preflight = await socialImageApi.runPreflight(finished?.task || rendered);
      setTask(preflight.task); setStep('review');
      setQualityPasses(hardChecks.filter(key => preflight.task.renderPlan?.units.every(unit => {
        const output = preflight.task.outputs.find(item => item.role === (isGif ? 'gif_frame' : unit.role) && item.label === unit.label && item.state !== 'superseded');
        const final = isGif ? preflight.task.outputs.find(item => item.role === 'gif_output' && item.id === preflight.task.gifDelivery?.finalOutputId) : null;
        return output?.qualityChecks.some(check => check.key === key && resolvedQuality(check.verdict))
          && (!isGif || final?.qualityChecks.some(check => check.key === key && resolvedQuality(check.verdict)));
      })));
      setNotice(isGif ? 'GIF 各背景与固定图层成片已持久化并完成预检；请逐帧审阅产品、文字与安全区。'
        : '轮播图各页已持久化并完成预检；不确定的视觉项目仍需人工逐页审阅。');
    } catch (reason) {
      const latest = await socialImageApi.getTask(sourceTask.id).catch(() => null);
      if (latest) setTask(latest.task);
      setStep('generate'); setNotice('');
      setError(controller.signal.aborted
        ? generationAbortReasonRef.current === 'manual' ? '已停止等待。当前页结果可能仍在处理中，请先核对，勿重复付费提交。'
          : '当前页等待超时。请先核对服务端任务与素材库，勿重复付费提交。'
        : reason instanceof Error ? reason.message : '轮播图当前页结果未确认，后续页已停止提交。');
    } finally {
      window.clearInterval(elapsedTimer);
      if (generationAbortRef.current === controller) generationAbortRef.current = null;
      setBusy(false);
    }
  };

  const generateImage = async (planned?: PlannedRun) => {
    const sourceTask = planned?.task || task;
    const sourcePoster = planned?.poster || poster;
    const sourceCaption = planned?.caption ?? caption;
    if (!sourceTask || !sourcePoster) return;
    if (sourceTask.imageType === 'carousel' || sourceTask.imageType === 'gif_poster') { await generateMultiOutputImage(sourceTask); return; }
    if (hasUnresolvedPaidImageJob(sourceTask)) {
      setError('本任务仍有未完成或待核对的生成单元，不能再次提交。请由管理员核对任务状态、供应商回执和企业素材库。');
      setStep('generate');
      return;
    }
    if (planned && creationPath === 'viral_replication' && imageType === 'product_poster') {
      if (await generateLayeredImage(planned)) return;
    }
    const controller = new AbortController();
    generationAbortRef.current = controller;
    generationAbortReasonRef.current = null;
    setGenerationElapsed(0);
    const elapsedTimer = window.setInterval(() => setGenerationElapsed(value => value + 1), 1000);
    const deadlineTimer = window.setTimeout(() => {
      generationAbortReasonRef.current = 'deadline';
      controller.abort();
    }, 195_000);
    setBusy(true); setError(''); setNotice('任务已入队，正在生成图片并写入企业素材库；通常需要 1–3 分钟。');
    const jobId = crypto.randomUUID();
    const idempotencyKey = `${sourceTask.id}:${jobId}:v${sourceTask.version}`;
    let activeTask = sourceTask;
    try {
      const queued = await socialImageApi.updateTask(activeTask, {
        status: 'generating', step: 'generate', generationJobs: [...(activeTask.generationJobs || []), {
          id: jobId, idempotencyKey, status: 'queued', outputNodeIds: [], attempt: 0,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        }],
      });
      activeTask = queued.task; setTask(activeTask);
      const renderRequest = {
        poster: sourcePoster, caption: sourceCaption, ratio, materialIds, productIds, imageQuality,
        referenceImageUrls: creationPath === 'viral_replication' ? [referenceMediaUrl || referenceThumbnail || ''].filter(Boolean) : [],
        idempotencyKey, imageTaskId: activeTask.id, imageJobId: jobId,
        confirmedFields: confirmationValues,
        imagePrompt: [resolvedCoreClaim, `Content type: ${imageType}.`,
          creationPath === 'viral_replication'
            ? 'Treat the benchmark as a locked visual recipe: preserve its composition hierarchy, product-group rhythm, palette relationship, background lighting, overlay zones and typography mood. Replace only competitor identity, product, claims and contact content with verified enterprise assets and facts. Never invent a missing package, badge, certification or product view.'
            : 'Use the enterprise brand and product assets as the primary visual system.',
          'Preserve every supplied enterprise product identity and packaging anchor. Keep the main subject outside headline, translucent overlay, logo and CTA safe zones. Minor overlap is allowed, but never hide the complete cap, brand name or core label.',
          ...(activeTask.repairInstructions || []).filter(item => item.status === 'pending').map(item => `Targeted repair (${item.targetLayer}): ${item.instruction}`),
        ].join(' '),
      };
      const rendered = await studioApi.fbPosterRender(renderRequest, { signal: controller.signal });
      if (!rendered.ok || !rendered.url || !rendered.task) throw new Error(rendered.code === 'social_image_atomic_store_required'
        ? '当前数据存储尚未具备图片付费作业的原子认领能力，系统未调用图片供应商。请由管理员完成存储能力核验后再生成。'
        : rendered.error || '图片生成结果未写入耐久任务');
      setImageUrl(rendered.url); setQualityPasses([]);
      activeTask = rendered.task;
      setTask(activeTask);
      const preflight = await socialImageApi.runPreflight(activeTask);
      setQualityPasses(passedQualityKeys(preflight.task.outputs));
      setTask(preflight.task); setStep('review'); setNotice('图片已生成并完成确定性预检；不确定的视觉项目仍需人工确认。');
    } catch (reason) {
      setNotice('');
      if (activeTask.generationJobs?.some(job => job.id === jobId && !job.outputNodeIds.length)) {
        void socialImageApi.getTask(activeTask.id).then(result => setTask(result.task)).catch(() => undefined);
      }
      if (controller.signal.aborted) {
        setError(generationAbortReasonRef.current === 'manual'
          ? '已停止等待。供应商可能仍在处理本次请求，请不要立即重复提交。'
          : '等待超过 195 秒，已退出生成状态。供应商结果尚未确认，请不要立即重复提交。');
        return;
      }
      const pending = (reason as { payload?: { fieldsToConfirm?: unknown } })?.payload?.fieldsToConfirm;
      if (Array.isArray(pending) && pending.length) {
        const nextFields = pending.map(String).filter(Boolean);
        setFieldsToConfirm(current => [...new Set([...current, ...nextFields])]);
      }
      setError(reason instanceof Error ? reason.message : '图片生成失败');
    }
    finally {
      window.clearInterval(elapsedTimer);
      window.clearTimeout(deadlineTimer);
      if (generationAbortRef.current === controller) generationAbortRef.current = null;
      setBusy(false);
    }
  };

  const applyNaturalLanguageRepair = async () => {
    if (!task || !repairRequest.trim()) return;
    if (!task.layerGraph) { setError('当前版本还不是分层成片，请先重新生成首版后再按图层修改。'); return; }
    setBusy(true); setError(''); setNotice('正在理解修改要求并只调整对应图层…');
    try {
      const repaired = await socialImageApi.repairLayered(task, repairRequest.trim());
      const rendered = await socialImageApi.renderLayered(repaired.task);
      const preflight = await socialImageApi.runPreflight(rendered.task);
      setTask(preflight.task); setImageUrl(rendered.url); setStep('review'); setRepairRequest('');
      setQualityPasses(passedQualityKeys(preflight.task.outputs));
      setNotice(`已修改${repaired.targetLayer}图层并生成新版本，其他图层保持不变。`);
    } catch (reason) { setNotice(''); setError(reason instanceof Error ? reason.message : '图层修改失败'); }
    finally { setBusy(false); }
  };

  const stopWaitingForImage = () => {
    if (!generationAbortRef.current) return;
    generationAbortReasonRef.current = 'manual';
    generationAbortRef.current.abort();
  };

  const abandonCarouselPlan = () => {
    if (!task?.renderPlan || !['carousel', 'gif_poster'].includes(task.imageType) || hasUnresolvedPaidImageJob(task)) return;
    const current = task;
    const plan = task.renderPlan;
    const renderedCount = plan.units.filter(unit => current.generationJobs.find(job => job.id === unit.jobId)?.outputNodeIds.length).length;
    Modal.confirm({
      title: `废弃当前${task.imageType === 'gif_poster' ? 'GIF' : '轮播'}计划并重新策划？`,
      content: renderedCount
        ? `已有 ${renderedCount} 张生成页。素材与付费记录会保留，但新计划需要重新生成这些页面，可能再次产生费用。结果不明的单元无法废弃。`
        : '尚未保存成片的单元将关闭并保留记录。结果不明的单元无法废弃。',
      okText: '确认废弃并返回输入', okType: 'danger', cancelText: '继续当前计划',
      onOk: async () => {
        setBusy(true); setError('');
        try {
          const result = await socialImageApi.abandonPlan(current);
          setTask(result.task); setImageUrl(''); setQualityPasses([]); setStep('inputs');
          setNotice('旧计划已安全归档。可修改输入并生成新计划；历史素材与回执仍保留。');
        } catch (reason) {
          setNotice(''); setError(reason instanceof Error ? reason.message : '计划未废弃，请刷新任务状态后重试');
          void socialImageApi.getTask(current.id).then(result => setTask(result.task)).catch(() => undefined);
        } finally { setBusy(false); }
      },
    });
  };

  const startTargetedRepair = async () => {
    if (!task) return;
    const failedChecks = hardChecks.filter(key => !qualityPasses.includes(key));
    if (!failedChecks.length) return;
    const targetLayer: SocialImageRepairInstruction['targetLayer'] = failedChecks.some(key => key === 'product_identity' || key === 'packaging_visibility') ? 'product'
      : failedChecks.some(key => key === 'label_ocr' || key === 'text_overflow') ? 'typography'
      : failedChecks.some(key => key === 'brand_consistency') ? 'logo'
      : failedChecks.some(key => key === 'subject_visibility' || key === 'safe_zone') ? 'background'
      : 'full_composite';
    setBusy(true); setError('');
    try {
      const currentVersion = Math.max(1, ...task.outputs.map(item => item.version));
      const instruction = {
        id: crypto.randomUUID(), outputNodeId: task.outputs.at(-1)?.id || '', failedChecks, targetLayer,
        instruction: failedChecks.map(key => CHECK_LABELS[key]).join('、'), status: 'pending' as const, fromVersion: currentVersion,
      };
      const saved = await socialImageApi.updateTask(task, {
        status: 'planned', step: 'generate', repairInstructions: [...(task.repairInstructions || []), instruction],
        outputs: task.outputs.map(output => output.id === instruction.outputNodeId ? { ...output, state: 'repair_required' as const } : output),
      });
      setTask(saved.task); setStep('generate'); setNotice(`已创建${targetLayer}图层定向返工，下一次生成将保留修复指令和旧版本。`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '返工任务创建失败'); }
    finally { setBusy(false); }
  };

  const requestDirectorReview = async () => {
    if (!task || !reviewCandidate) return;
    setBusy(true); setError(''); setNotice('正在依据已保存的独立质检证据完成编导复核…');
    try {
      const reviewed = await socialImageApi.runDirectorReview(task, reviewCandidate.id, reviewCandidate.version);
      setTask(reviewed.task);
      setNotice(reviewed.task.directorReviewDecision?.decision === 'accept_for_user_review'
        ? '编导复核已通过，请明确采用或要求修改。' : '编导复核未通过，候选仍是草稿，请按问题区域修改。');
    } catch (reason) { setNotice(''); setError(reason instanceof Error ? reason.message : '编导复核失败'); }
    finally { setBusy(false); }
  };

  const decideReviewCandidate = async (decision: 'approved' | 'rejected') => {
    if (!task || !reviewCandidate?.contentHash) { setError('候选文件缺少实际字节哈希，不能验收。'); return; }
    setBusy(true); setError(''); setNotice(decision === 'approved' ? '正在冻结采用版本并生成交付包…' : '正在保存修改决定…');
    try {
      const decided = await socialImageApi.decideCandidate(task, {
        candidateId: reviewCandidate.id, candidateVersion: reviewCandidate.version,
        expectedContentHash: decision === 'approved' && multiOutput
          ? task.directorReviewDecision?.candidateSetHash || '' : reviewCandidate.contentHash, decision,
        note: decision === 'rejected' ? repairRequest.trim() || '用户要求修改当前候选' : undefined,
      });
      if (decision === 'approved') {
        const delivered = await socialImageApi.createDeliveryPackage(decided.task);
        setTask(delivered.task);
        setNotice('当前图片版本已明确采用并生成交付包；未执行任何平台发布。');
      } else {
        setTask(decided.task); setNotice('已拒绝当前候选并保留历史版本，可填写修改要求后定点返工。');
      }
    } catch (reason) { setNotice(''); setError(reason instanceof Error ? reason.message : '图片验收失败'); }
    finally { setBusy(false); }
  };

  const renderLeft = () => {
    if (step === 'type') return <div className="space-y-2 p-3">{IMAGE_TYPES.map(item => <button key={item.id} type="button" disabled={!item.available} onClick={() => { formDirtyRef.current = true; setImageType(item.id); }} className={`w-full rounded-lg border p-3 text-left ${!item.available ? 'cursor-not-allowed border-border bg-zinc-50 opacity-60' : imageType === item.id ? 'border-blue-500 bg-blue-50' : 'border-border bg-white hover:bg-zinc-50'}`}><span className="flex items-center justify-between gap-2 text-sm font-semibold text-text-primary"><span>{item.label}</span>{!item.available && <Tag>后续阶段</Tag>}</span><span className="mt-1 block text-xs leading-5 text-text-secondary">{item.description}</span></button>)}</div>;
    if (step === 'inputs') return <div className="space-y-3 p-3"><p className="text-sm font-semibold">内容节点</p>{['内容类型', '核心主张', '企业产品', '图片素材', '受众与平台', '事实真实性'].map((label, index) => <div key={label} className="flex items-center justify-between rounded-lg border border-border bg-white px-3 py-2 text-xs"><span>{label}</span><Tag color={(index === 0 ? imageType : index === 1 ? coreClaim : index === 2 ? productIds.length : index === 3 ? materialIds.length : true) ? 'success' : 'warning'}>{(index === 0 ? imageType : index === 1 ? coreClaim : index === 2 ? productIds.length : index === 3 ? materialIds.length : true) ? '已填写' : '待补充'}</Tag></div>)}</div>;
    if (step === 'plan') return <div className="space-y-2 p-3"><p className="text-sm font-semibold">图文合同</p>{['核心主张', '画面标题', '帖子配文', 'CTA', '事实边界'].map(label => <div key={label} className="rounded-lg border border-border bg-white p-3 text-xs">{label}<span className="float-right text-text-muted">{poster ? '已生成' : '待生成'}</span></div>)}</div>;
    if (step === 'generate') return <div className="space-y-2 p-3"><p className="text-sm font-semibold">候选版本</p>{(imageType === 'carousel' || imageType === 'gif_poster') && carouselPages.length ? carouselPages.map(({ unit, output }) => <div key={unit.jobId} className="rounded-lg border border-blue-300 bg-blue-50 p-3 text-xs">{unit.label}<span className="float-right">{output?.mediaUrl ? '已保存' : '待生成'}</span></div>) : <div className="rounded-lg border border-blue-300 bg-blue-50 p-3 text-xs">候选 1<span className="float-right">{imageUrl ? '已生成' : '待生成'}</span></div>}</div>;
    return <div className="space-y-2 p-3"><p className="text-sm font-semibold">交付物</p><div className="rounded-lg border border-border bg-white p-3 text-xs">{imageType === 'carousel' ? `轮播图 · ${carouselPages.filter(page => page.output?.mediaUrl).length}/${carouselPages.length || 4} 张` : imageType === 'gif_poster' ? `GIF 动态海报 · ${task?.gifDelivery ? '成片已保存' : '待合成'}` : '主视觉'} <Tag color={task?.publishable ? 'success' : 'warning'}>{task?.publishable ? '可发布' : '待审核'}</Tag></div><div className="rounded-lg border border-border bg-white p-3 text-xs">帖子配文 <Tag color={caption ? 'success' : 'default'}>{caption ? '已生成' : '待生成'}</Tag></div></div>;
  };

  return <div className="flex h-full min-h-0 flex-col bg-white">
    <LsPageHeader title="图片内容制作工作台" extra={<Button onClick={onShowCreations}>我的创作</Button>}>
      <Steps size="small" current={currentStepIndex} items={STEP_ITEMS.map(item => ({ title: item.title }))} className="px-4 pb-3" />
    </LsPageHeader>
    <div className="social-creation-workbench-layout grid min-h-0 flex-1 overflow-y-auto md:overflow-hidden">
      <aside className="min-h-0 border-b border-border bg-white md:overflow-y-auto md:border-b-0 md:border-r">{renderLeft()}</aside>
      <main className="flex min-h-[460px] min-w-0 flex-col bg-[#f5f5f5] md:min-h-0">
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-lg border border-border bg-white">
            {(imageType === 'carousel' || imageType === 'gif_poster' && !task?.gifDelivery) && carouselPages.some(page => page.output?.mediaUrl) ? <div className="grid h-full w-full grid-cols-2 gap-3 overflow-y-auto p-3">{carouselPages.map(({ unit, output }) => <div key={unit.jobId} className="flex min-h-0 flex-col rounded-lg border border-border bg-white p-2"><p className="pb-2 text-xs font-medium">{unit.label}</p>{output?.mediaUrl ? <ReviewImage key={output.mediaUrl} src={output.mediaUrl} alt={unit.label} /> : <LsMediaStateFrame state="processing" label="等待背景底图" className="min-h-32 flex-1" />}</div>)}</div>
              : imageUrl ? <ReviewImage key={imageUrl} src={imageUrl} alt={imageType === 'gif_poster' ? 'GIF 成片预览' : '生成图片预览'} />
              : referenceThumbnail && creationPath === 'viral_replication' ? <img src={referenceThumbnail} alt="对标作品" className="h-full w-full object-contain" />
              : poster ? <div className="max-w-xl p-8 text-center"><Layers3 className="mx-auto text-blue-600" /><h2 className="mt-4 text-xl font-semibold">{poster.headline}</h2><p className="mt-2 text-sm text-text-secondary">{poster.subheadline}</p><p className="mt-6 text-xs text-text-muted">已完成图文策划，下一步生成正式图片</p></div>
              : <div className="max-w-md px-8 text-center"><FileImage size={40} className="mx-auto text-zinc-400" /><p className="mt-4 text-base font-semibold">图片内容制作</p><p className="mt-2 text-sm leading-6 text-text-secondary">选择内容类型、绑定企业产品和事实，再联合生成图片与帖子配文。</p></div>}
          </div>
        </div>
        {(caption || hashtags.length > 0) && <div className="border-t border-border bg-white p-4"><p className="text-xs font-semibold">帖子配文</p><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-text-secondary">{caption}</p><p className="mt-2 text-xs text-blue-600">{hashtags.map(tag => `#${tag.replace(/^#/, '')}`).join(' ')}</p></div>}
      </main>
      <aside className="flex min-h-0 flex-col border-t border-border bg-white md:border-l md:border-t-0">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {step === 'type' && <><p className="text-sm font-semibold">交付规格</p><label className="block text-xs font-medium">平台<Select className="mt-1 w-full" value={platform} onChange={value => { formDirtyRef.current = true; setPlatform(value); }} options={[{value:'facebook',label:'Facebook'},{value:'instagram',label:'Instagram'},{value:'linkedin',label:'LinkedIn'}]} /></label><label className="block text-xs font-medium">比例<Select className="mt-1 w-full" value={ratio} onChange={value => { formDirtyRef.current = true; setRatio(value); }} options={['1:1','4:5','9:16','16:9'].map(value => ({value,label:value}))} /></label><label className="block text-xs font-medium">语言<Select className="mt-1 w-full" value={language} onChange={value => { formDirtyRef.current = true; setLanguage(value); }} options={[{value:'en',label:'English'},{value:'zh',label:'中文'}]} /></label></>}
          {step === 'inputs' && <>
            <p className="text-sm font-semibold">内容与资产</p>
            {contentTaskHydrating && <Alert type="info" showIcon message="正在读取统一内容任务" />}
            <label className="block text-xs font-medium">内容类型<Select className="mt-1 w-full" value={imageType} onChange={value => { formDirtyRef.current = true; setImageType(value); }} options={IMAGE_TYPES.filter(item => item.available).map(item => ({value:item.id,label:item.label}))} /></label>
            <label className="block text-xs font-medium">任务名称<Input className="mt-1" value={title} onChange={event => { formDirtyRef.current = true; setTitle(event.target.value); }} /></label>
            <label className="block text-xs font-medium">企业产品<Select mode="multiple" className="mt-1 w-full" value={productIds} onChange={value => { formDirtyRef.current = true; setProductIds(value); }} options={products.map(item => ({value:item.id,label:item.name}))} placeholder="至少选择一个产品" /></label>
            <label className="block text-xs font-medium">核心主张<Input.TextArea className="mt-1" rows={4} value={coreClaim} onChange={event => { formDirtyRef.current = true; setCoreClaim(event.target.value); }} placeholder="这条内容只讲清的一件事" /></label>
            <label className="block text-xs font-medium">目标受众<Input className="mt-1" value={audience} onChange={event => { formDirtyRef.current = true; setAudience(event.target.value); }} /></label>
            <label className="block text-xs font-medium">事实状态<Select className="mt-1 w-full" value={factuality} onChange={value => { formDirtyRef.current = true; setFactuality(value); }} options={[{value:'verified',label:'企业资料已验证'},{value:'user_supplied',label:'用户提供，待核验'},{value:'mock',label:'模拟内容，不可直接发布'}]} /></label>
            <div><div className="flex items-center justify-between gap-2"><p className="text-xs font-medium">企业图片素材</p><Button size="small" icon={<Upload size={13} />} loading={busy} onClick={() => uploadRef.current?.click()}>上传图片</Button><input ref={uploadRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple className="hidden" onChange={event => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ''; void uploadImages(files); }} /></div><div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-2">{materials.length ? materials.map(item => <Checkbox key={item.id} checked={materialIds.includes(item.id)} onChange={event => { formDirtyRef.current = true; setMaterialIds(current => event.target.checked ? [...current,item.id] : current.filter(id => id !== item.id)); }} className="flex text-xs"><span className="line-clamp-1">{item.name}</span></Checkbox>) : <p className="p-2 text-xs text-text-muted">素材库暂无企业图片，可以在这里直接上传。</p>}</div></div>
          </>}
          {step === 'plan' && <><p className="text-sm font-semibold">策划依据</p><p className="rounded-lg bg-zinc-50 p-3 text-xs leading-5">题材：{IMAGE_TYPES.find(item => item.id === imageType)?.label}<br />图文关系：图片证明或解释核心主张<br />配色：从企业产品与品牌素材推导</p></>}
          {step === 'generate' && <><p className="text-sm font-semibold">正在生成</p><p className="text-xs leading-5 text-text-secondary">系统将自动完成策划、资产匹配、首版渲染与预检，不再因补充信息中断。</p>{hasUnresolvedPaidImageJob(task) && !busy && <Alert type="warning" showIcon message="图片生成单元待核对" description={<>当前任务不会自动重试付费生成。请核对供应商回执和企业素材库。{recoverableJob && <Button size="small" className="mt-2" onClick={() => void reconcileSavedImage()}>核对已落库成片（不重新生成）</Button>}</>} />}</>}
          {step === 'review' && <>
            {legacyReadOnly && <Alert type="warning" showIcon message="历史图片项目以只读方式恢复" description="可核对和下载已有产物；系统不会自动新建统一任务、升级运行或再次触发付费生成。" />}
            {multiOutput ? <><p className="text-sm font-semibold">{imageType === 'gif_poster' ? 'GIF 逐帧审阅' : '轮播页审阅'}</p><p className="text-xs leading-5 text-text-secondary">逐帧检查产品、文字和安全区；GIF 成片需另看循环效果。若要改变内容，请废弃计划重新策划，已提交的付费单元不会自动重试。</p></>
              : <><p className="text-sm font-semibold">自然语言修改</p><Input.TextArea rows={3} value={repairRequest} onChange={event => setRepairRequest(event.target.value)} placeholder="例如：产品缩小一点并下移；遮罩淡一点；标题改成 Golden Hair Ritual；删除认证信息" /><p className="text-xs leading-5 text-text-secondary">系统只修改对应图层并保留其他图层。所有待处理信息统一汇总，不影响成片生成和下载。</p></>}
            {fieldsToConfirm.length > 0 && <Alert type="warning" showIcon message={`待处理信息 · ${fieldsToConfirm.length} 项`}
              description={task?.renderPlan ? '付费计划已冻结。仍可预览；正式下载需先完成复核与采用。修改事实前需显式废弃计划。'
                : <Button size="small" className="mt-2" onClick={() => setConfirmationOpen(true)}>统一查看与补充</Button>} />}
            <p className="pt-2 text-sm font-semibold">自动检查（硬门禁）</p>
            <div className="flex flex-wrap gap-2">{hardChecks.map(key => <Tag key={key} color={reviewQualityPasses.includes(key) ? 'success' : 'default'}>{CHECK_LABELS[key]}</Tag>)}</div>
            {imageType === 'gif_poster' && <Tag color={reviewOutputs.at(-1)?.qualityChecks.some(check =>
              check.key === 'motion_mechanism_similarity' && check.severity === 'hard' && resolvedQuality(check.verdict))
              ? 'success' : 'default'}>GIF 全帧与动效检查</Tag>}
            {multiOutput && <div className="space-y-1">{reviewOutputs.map(output => <p key={output.id} className="flex items-center justify-between text-xs"><span>{output.label}</span><Tag color={socialImageOutputHardChecksPassed(output) ? 'success' : 'warning'}>{socialImageOutputHardChecksPassed(output) ? '质检通过' : '待检查或需修改'}</Tag></p>)}</div>}
            {factuality === 'mock' && <Alert type="warning" showIcon message="当前为模拟内容，请在发布前自行确认事实" />}
          </>}
          {error && <Alert type="error" showIcon message={error} />}{notice && <Alert type="info" showIcon message={notice} />}
        </div>
        <div className="border-t border-border px-4 pb-24 pt-4">
          {step === 'inputs' && <label className="mb-3 block text-xs font-medium">GPT Image 2 质量<Select className="mt-1 w-full" value={imageQuality} onChange={value => { formDirtyRef.current = true; setImageQuality(value); }} options={[{value:'low',label:'Low · 默认'},{value:'medium',label:'Medium'},{value:'high',label:'High'}]} /></label>}
          {step === 'type' && <Button type="primary" block onClick={() => setStep('inputs')} icon={<ImagePlus size={15} />}>进入内容与资产</Button>}
          {step === 'inputs' && <Button type="primary" block loading={busy || contentTaskHydrating} disabled={contentTaskHydrating || !contentTaskReady || legacyReadOnly} onClick={() => void saveInputs()}>{legacyReadOnly ? '历史项目只读' : contentTaskHydrating ? '正在读取任务' : !contentTaskReady ? '任务读取失败' : busy ? '正在生成首版' : '一次生成首版'}</Button>}
          {step === 'plan' && <><Button type="primary" block loading={busy} disabled={busy} onClick={() => void generatePlan()}>{busy ? '正在自动策划并生成首版' : '重试一键生成'}</Button><Button block className="mt-2" disabled={busy} onClick={() => setStep('inputs')}>返回修改输入</Button></>}
          {step === 'generate' && <><Button type="primary" block loading={busy} disabled={busy || !poster || hasUnresolvedPaidImageJob(task)} onClick={() => void generateImage()} icon={busy ? <Spin size="small" /> : <RefreshCw size={15} />}>{busy ? reconciling ? '正在核对已存素材' : `${multiOutput ? '正在生成多图单元' : '正在生成首版'} · ${generationElapsed} 秒` : multiOutput ? '继续未完成单元或收口成片' : '重试生成首版'}</Button>{busy && !reconciling ? <Button block danger className="mt-2" onClick={stopWaitingForImage}>停止等待</Button> : !busy && !(multiOutput && task?.renderPlan) ? <Button block className="mt-2" onClick={() => setStep('inputs')}>返回修改输入</Button> : null}{multiOutput && task?.renderPlan && !busy && <Button block danger className="mt-2" disabled={hasUnresolvedPaidImageJob(task)} onClick={abandonCarouselPlan}>废弃计划并重新策划</Button>}</>}
          {step === 'review' && <SocialImageReviewActions task={task} busy={busy} legacyReadOnly={legacyReadOnly}
            directorAccepted={directorAccepted} hardChecksPassed={reviewHardChecksPassed} reviewCandidate={reviewCandidate}
            fieldsToConfirm={fieldsToConfirm} repairRequest={repairRequest} imageUrl={imageUrl}
            qualityNeedsRepair={qualityPasses.length < hardChecks.length} carouselPages={carouselPages}
            onDirectorReview={() => void requestDirectorReview()} onDecision={decision => void decideReviewCandidate(decision)}
            onLayerRepair={() => void applyNaturalLanguageRepair()} onConfirmFields={() => setConfirmationOpen(true)}
            onTargetedRepair={() => void startTargetedRepair()} onAbandonPlan={abandonCarouselPlan} />}
          {step === 'review' && imageType === 'gif_poster' && task?.gifDelivery && carouselPages.map(({ unit, output }) => output?.mediaUrl && <Button key={unit.jobId} block className="mt-2" href={output.mediaUrl} target="_blank">查看{unit.label}合成帧</Button>)}
          {step === 'review' && fieldsToConfirm.length > 0 && task?.renderPlan && <Alert className="mt-2" type="warning" showIcon message="待确认事实不可改写已冻结的付费计划；可先预览，正式下载须完成验收。" />}
        </div>
      </aside>
    </div>
    <Modal
      title="补充待确认信息"
      open={confirmationOpen}
      okText="保存已填写信息"
      cancelText="暂不处理"
      confirmLoading={busy}
      onOk={() => void confirmMissingInformation()}
      onCancel={() => { if (!busy) setConfirmationOpen(false); }}
      maskClosable={!busy}
    >
      <p className="mb-4 text-sm leading-6 text-text-secondary">所有待处理信息都汇总在这里。可只填写当前已知内容，其余项目不会阻断成片生成、审阅或下载。</p>
      <div className="max-h-[52vh] space-y-4 overflow-y-auto pr-1">
        {fieldsToConfirm.map(field => <label key={field} className="block text-sm font-medium text-text-primary">{field}<Input.TextArea className="mt-1" rows={2} value={confirmationValues[field] || ''} onChange={event => setConfirmationValues(current => ({ ...current, [field]: event.target.value }))} placeholder={`请输入已确认的${field}，不要填写估计值`} /></label>)}
      </div>
      {error && <Alert className="mt-4" type="error" showIcon message={error} />}
    </Modal>
  </div>;
}
