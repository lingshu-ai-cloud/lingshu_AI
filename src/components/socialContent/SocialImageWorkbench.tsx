import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Input, Modal, Select, Spin, Steps, Tag } from 'antd';
import { CheckCircle2, ChevronLeft, ChevronRight, FileImage, ImagePlus, Layers3, Pause, Play, RefreshCw, Upload } from 'lucide-react';
import LsPageHeader from '../ui/LsPageHeader';
import { authHeader } from '../../lib/auth';
import { socialImageApi } from '../../lib/socialImageApi';
import { studioApi, type FbPosterBrief, type Material } from '../../lib/studioApi';
import {
  imageTypeForProductionMode,
  productionModeFromDelivery,
  type SocialImageProductionMode,
} from '../../lib/socialImageProductionMode';
import {
  SOCIAL_IMAGE_HARD_CHECKS,
  type SocialImageContentType,
  type SocialImageCreationPath,
  type SocialImageCreationTask,
  type SocialImageOutputNode,
} from '../../../shared/contracts/socialImageCreation';

type ProductOption = { id: string; name: string };
type WorkbenchStep = 'type' | 'inputs' | 'plan' | 'generate' | 'review';
type ImageQuality = 'low' | 'medium' | 'high';

const CONTENT_ARCHETYPES: Array<{ id: SocialImageContentType; label: string }> = [
  { id: 'light_packaging', label: '轻包装' }, { id: 'product_poster', label: '产品表达' },
  { id: 'brand_news', label: '品牌新闻' }, { id: 'experiment_comparison', label: '实验对比' },
  { id: 'trend', label: '趋势内容' }, { id: 'infographic', label: '信息图' },
  { id: 'carousel', label: '轮播叙事' }, { id: 'gif_poster', label: '动态海报' },
];

const PRODUCTION_MODES: Array<{ id: SocialImageProductionMode; label: string; description: string }> = [
  { id: 'single', label: '单图', description: '一张主视觉与一份帖子配文' },
  { id: 'gif', label: 'GIF', description: '底图切换、打字或状态动效' },
  { id: 'carousel', label: '轮播图', description: '多页连续讲清问题、证据与方案' },
];

const STEP_ITEMS = [
  { key: 'inputs', title: '内容与资产' }, { key: 'production', title: '生成首版' }, { key: 'review', title: '审阅交付' },
] as const;

type PlannedRun = { task: SocialImageCreationTask; poster: FbPosterBrief; caption: string };

function actionableConfirmationFields(fields: string[] = []) {
  return [...new Set(fields.map(String).map(item => item.trim()).filter(item => item && item !== '图文策划需人工审阅'))];
}

function topicForType(type: SocialImageContentType) {
  if (type === 'brand_news') return 'partnership_news';
  if (type === 'experiment_comparison') return 'experiment_comparison';
  if (type === 'trend') return 'trend';
  return 'technical_solution';
}

function posterStyleForType(type: SocialImageContentType) {
  if (type === 'brand_news') return 'news-editorial';
  if (type === 'experiment_comparison') return 'comparison-proof';
  if (type === 'trend') return 'trend-editorial';
  return 'oem-factory';
}

export default function SocialImageWorkbench({
  creationPath, referenceTitle, referenceThumbnail, referenceMediaUrl, referenceImageMode, referenceImageUrls, referenceCaption, initialTask, onShowCreations,
}: {
  creationPath: SocialImageCreationPath;
  referenceTitle?: string;
  referenceThumbnail?: string;
  referenceMediaUrl?: string;
  referenceImageMode?: SocialImageProductionMode;
  referenceImageUrls?: string[];
  referenceCaption?: string;
  initialTask?: SocialImageCreationTask;
  onShowCreations: () => void;
}) {
  const restoredStep: WorkbenchStep = initialTask?.step === 'motion' ? 'review' : initialTask?.step === 'type' ? 'inputs' : initialTask?.step || 'inputs';
  const [step, setStep] = useState<WorkbenchStep>(restoredStep);
  const initialProductionMode = initialTask ? productionModeFromDelivery(initialTask.deliverySpec.format) : referenceImageMode || 'single';
  const [productionMode, setProductionMode] = useState<SocialImageProductionMode>(initialProductionMode);
  const [imageType, setImageType] = useState<SocialImageContentType>(initialTask?.imageType || imageTypeForProductionMode(initialProductionMode));
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [productIds, setProductIds] = useState<string[]>(initialTask?.contentBrief.productRefs || []);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialIds, setMaterialIds] = useState<string[]>(initialTask?.materialIds || []);
  const [title, setTitle] = useState(initialTask?.title || (creationPath === 'viral_replication' ? '爆款复刻 · 图片草稿' : '自由创作 · 图片草稿'));
  const [coreClaim, setCoreClaim] = useState(initialTask?.contentBrief.coreClaim || '');
  const [audience, setAudience] = useState(initialTask?.contentBrief.audience[0] || '海外品牌研发与采购');
  const [platform, setPlatform] = useState<'facebook' | 'instagram' | 'linkedin'>((initialTask?.deliverySpec.platform === 'instagram' || initialTask?.deliverySpec.platform === 'linkedin') ? initialTask.deliverySpec.platform : 'facebook');
  const [ratio, setRatio] = useState<'1:1' | '4:5' | '9:16'>((initialTask?.deliverySpec.aspectRatio === '1:1' || initialTask?.deliverySpec.aspectRatio === '9:16') ? initialTask.deliverySpec.aspectRatio : '4:5');
  const [language, setLanguage] = useState<'en' | 'zh'>(initialTask?.deliverySpec.language === 'zh' ? 'zh' : 'en');
  const [imageQuality, setImageQuality] = useState<ImageQuality>(initialTask?.deliverySpec.imageGeneration?.quality || 'low');
  const [factuality, setFactuality] = useState<'verified' | 'user_supplied' | 'mock'>(initialTask?.contentBrief.factuality || 'verified');
  const [task, setTask] = useState<SocialImageCreationTask | null>(initialTask || null);
  const [poster, setPoster] = useState<FbPosterBrief | null>(initialTask?.renderBrief || null);
  const [caption, setCaption] = useState(initialTask?.imageTextContract.caption || '');
  const [hashtags, setHashtags] = useState<string[]>(initialTask?.imageTextContract.hashtags || []);
  const [imageUrl, setImageUrl] = useState(initialTask?.outputs.find(output => output.mediaUrl)?.mediaUrl || '');
  const [fieldsToConfirm, setFieldsToConfirm] = useState<string[]>(actionableConfirmationFields(initialTask?.fieldsToConfirm));
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [confirmationValues, setConfirmationValues] = useState<Record<string, string>>(() => Object.fromEntries(
    (initialTask?.contentBrief.evidenceItems || []).filter(item => item.source === 'user_input').map(item => [item.label, item.value]),
  ));
  const [busy, setBusy] = useState(false);
  const [generationElapsed, setGenerationElapsed] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [repairRequest, setRepairRequest] = useState('');
  const [previewSource, setPreviewSource] = useState<'generated' | 'reference'>('generated');
  const [referenceIndex, setReferenceIndex] = useState(0);
  const [generatedIndex, setGeneratedIndex] = useState(0);
  const [referencePlaying, setReferencePlaying] = useState(true);
  const uploadRef = useRef<HTMLInputElement>(null);
  const generationAbortRef = useRef<AbortController | null>(null);
  const generationAbortReasonRef = useRef<'manual' | 'deadline' | null>(null);
  const recoveredQualityTaskRef = useRef('');

  useEffect(() => () => generationAbortRef.current?.abort(), []);

  // Generation is persisted by the server before it responds. After a refresh
  // poll the same task instead of submitting another paid image request, then
  // resume QA exactly once when the durable outputs appear.
  useEffect(() => {
    if (!task?.id) return;
    const activeJob = task.generationJobs?.some(job => ['queued', 'running', 'output_ready', 'quality_checking'].includes(job.status));
    const needsQuality = task.outputs.some(output => output.state === 'quality_checking');
    if (!activeJob && !needsQuality) return;
    let cancelled = false;
    const recover = async () => {
      try {
        const latest = (await socialImageApi.getTask(task.id)).task;
        if (cancelled) return;
        setTask(latest);
        const currentOutput = latest.outputs.find(output => output.state === 'quality_checking' && output.mediaUrl);
        if (currentOutput) {
          setImageUrl(currentOutput.mediaUrl || '');
          const token = `${latest.id}:${latest.version}`;
          if (recoveredQualityTaskRef.current !== token) {
            recoveredQualityTaskRef.current = token;
            const checked = await socialImageApi.runPreflight(latest);
            if (!cancelled) { setTask(checked.task); setStep('review'); setNotice('已恢复后台生成结果并完成自动视觉质检。'); }
          }
        }
      } catch { /* retain the persisted task and retry on the next poll */ }
    };
    void recover();
    const timer = window.setInterval(recover, 2500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [task?.id, task?.version, task?.status, task?.generationJobs, task?.outputs]);

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
  const referenceAssets = useMemo(() => [...new Set([
    ...(referenceImageUrls || []),
    ...(task?.referenceSnapshot?.imageUrls || []),
    referenceMediaUrl || '',
    referenceThumbnail || '',
  ].map(item => String(item || '').trim()).filter(Boolean))], [referenceImageUrls, task?.referenceSnapshot?.imageUrls, referenceMediaUrl, referenceThumbnail]);
  const hasReferencePreview = creationPath === 'viral_replication' && referenceAssets.length > 0;
  const isReferenceCarousel = referenceAssets.length > 1;
  const currentReferenceAsset = referenceAssets[Math.min(referenceIndex, Math.max(0, referenceAssets.length - 1))] || '';
  const generatedAssets = useMemo(() => task?.outputs
    .filter(output => output.state !== 'superseded' && output.mediaUrl && output.role !== 'gif_output')
    .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
    .slice(0, 4) || [], [task]);
  const currentGeneratedAsset = generatedAssets[Math.min(generatedIndex, Math.max(0, generatedAssets.length - 1))]?.mediaUrl || imageUrl;

  useEffect(() => {
    if (!hasReferencePreview || previewSource !== 'reference' || !isReferenceCarousel || !referencePlaying) return undefined;
    const timer = window.setInterval(() => setReferenceIndex(index => (index + 1) % referenceAssets.length), 2500);
    return () => window.clearInterval(timer);
  }, [hasReferencePreview, isReferenceCarousel, previewSource, referenceAssets.length, referencePlaying]);

  useEffect(() => {
    if (!hasReferencePreview && previewSource === 'reference') setPreviewSource('generated');
    if (referenceIndex >= referenceAssets.length) setReferenceIndex(0);
  }, [hasReferencePreview, previewSource, referenceAssets.length, referenceIndex]);

  useEffect(() => { if (generatedIndex >= generatedAssets.length) setGeneratedIndex(0); }, [generatedAssets.length, generatedIndex]);

  const navigateToStage = (index: number) => {
    if (index === 0) { setStep('inputs'); return; }
    if (index === 1) { setStep(poster || imageUrl ? 'generate' : 'plan'); return; }
    setStep('review');
  };

  const changeProductionMode = (mode: SocialImageProductionMode) => {
    setProductionMode(mode);
    setImageType(current => mode === 'single' && !['carousel', 'gif_poster'].includes(current)
      ? current
      : imageTypeForProductionMode(mode));
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
      setNotice(`已上传并选择 ${uploaded.length} 张企业图片。`);
    } catch (reason) { setNotice(''); setError(reason instanceof Error ? reason.message : '图片上传失败'); }
    finally { setBusy(false); }
  };

  const ensureTask = async () => {
    if (task) return task;
    const benchmarkImage = referenceMediaUrl || referenceThumbnail || '';
    const enterpriseAssets = [
      ...selectedProducts.map(item => ({ assetId: item.id, role: 'product', name: item.name, source: 'enterprise_knowledge_base', required: true })),
      ...selectedMaterials.map(item => ({ assetId: item.id, role: /logo|标志|品牌标识/i.test(item.name) ? 'logo' : 'scene', name: item.name, source: 'enterprise_material_library', contentHash: item.contentSha256, required: true })),
    ];
    const create = creationPath === 'viral_replication' ? socialImageApi.createFromReference : socialImageApi.createTask;
    const created = await create({
      title, creationPath, imageType, objective: 'lead_generation', topicType: topicForType(imageType), coreClaim: resolvedCoreClaim,
      productRefs: productIds, productNames: selectedProducts.map(item => item.name), audience: [audience], factuality,
      targetAction: '联系销售或申请样品', referenceUrls: [benchmarkImage, referenceTitle].filter(Boolean), enterpriseAssets,
      ...(creationPath === 'viral_replication' ? { referenceSnapshot: {
        sourceUrl: referenceTitle, title: referenceTitle, caption: referenceCaption, imageUrls: referenceImageUrls?.length ? referenceImageUrls : benchmarkImage ? [benchmarkImage] : [], collectedAt: new Date().toISOString(),
      } } : {}),
    });
    setTask(created.task);
    return created.task;
  };

  const saveInputs = async () => {
    if (!selectedProducts.length) { setError('请选择至少一个企业产品。'); return; }
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
        deliverySpec: { ...current.deliverySpec, platform, aspectRatio: ratio, language, format: imageType === 'gif_poster' ? 'gif' : imageType === 'carousel' ? 'carousel' : 'jpg', outputCount: imageType === 'carousel' || imageType === 'gif_poster' ? Math.min(4, Math.max(1, referenceAssets.length || 4)) : 1, imageGeneration: { provider: 'openai', model: 'gpt-image-2', quality: imageQuality } },
      });
      setTask(saved.task); setStep('plan'); setNotice('输入已冻结，正在自动完成对标拆解、图文策划与首版生成…');
      const planned = await requestPlan(saved.task, confirmationValues);
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
      referenceNotes: [referenceTitle ? `对标作品：${referenceTitle}` : '', `核心主张：${resolvedCoreClaim}`, `成片模式：${PRODUCTION_MODES.find(item => item.id === productionMode)?.label}`, `后台题材：${CONTENT_ARCHETYPES.find(item => item.id === imageType)?.label}`].filter(Boolean).join('\n'),
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

  const generateImage = async (planned?: PlannedRun) => {
    const sourceTask = planned?.task || task;
    const sourcePoster = planned?.poster || poster;
    const sourceCaption = planned?.caption ?? caption;
    if (!sourceTask || !sourcePoster) return;
    if (planned && creationPath === 'viral_replication' && imageType === 'product_poster') {
      if (await generateLayeredImage(planned)) return;
    }
    const controller = new AbortController();
    generationAbortRef.current = controller;
    generationAbortReasonRef.current = null;
    setGenerationElapsed(0);
    const elapsedTimer = window.setInterval(() => setGenerationElapsed(value => value + 1), 1000);
    // Keep a client bound beyond the provider's server-side 360 s deadline so
    // the browser does not abandon a healthy render first. The task record is
    // already persisted before this request starts.
    const deadlineTimer = window.setTimeout(() => {
      generationAbortReasonRef.current = 'deadline';
      controller.abort();
    }, 390_000);
    setBusy(true); setError(''); setNotice('任务已入队，正在生成图片并写入企业素材库；通常需要 1–3 分钟。');
    const jobId = crypto.randomUUID();
    const idempotencyKey = `${sourceTask.id}:${jobId}:v${sourceTask.version}`;
    let activeTask = sourceTask;
    try {
      const queued = await socialImageApi.updateTask(activeTask, {
        status: 'generating', step: 'generate', generationJobs: [...(activeTask.generationJobs || []), {
          id: jobId, idempotencyKey, status: 'running', outputNodeIds: [], attempt: 1,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        }],
      });
      activeTask = queued.task; setTask(activeTask);
      const renderRequest = {
        poster: sourcePoster, caption: sourceCaption, ratio, materialIds, productIds,
        imageModel: 'gpt-image-2' as const, imageQuality, imageType,
        referenceImageUrls: creationPath === 'viral_replication' ? referenceAssets.slice(0, 4) : [],
        idempotencyKey,
        confirmedFields: confirmationValues,
        replicationRecipe: activeTask.replicationRecipe,
        socialImageTaskId: activeTask.id,
        socialImageJobId: jobId,
        socialImageTaskVersion: activeTask.version,
        imagePrompt: [resolvedCoreClaim,
          creationPath === 'viral_replication' ? 'Reconstruct the supplied benchmark with our verified enterprise content.' : 'Use the enterprise brand and product assets as the primary visual system.',
          ...(activeTask.repairInstructions || []).filter(item => item.status === 'pending').map(item => `Targeted repair (${item.targetLayer}): ${item.instruction}`),
        ].join(' '),
      };
      let rendered = await studioApi.fbPosterRender(renderRequest, { signal: controller.signal });
      if (!rendered.ok && /产品.*(?:主图|资产|图片).*(?:不可读取|可读取)|(?:主图|资产|图片).*不可读取|PRODUCT_REFERENCE|ENTERPRISE_PRODUCT_IMAGE/i.test(String(rendered.error || ''))) {
        rendered = await studioApi.fbPosterRender({ ...renderRequest, productIds: [] }, { signal: controller.signal });
      }
      if (!rendered.ok || !rendered.url) throw new Error(rendered.error || '图片生成失败');
      setImageUrl(rendered.url);
      if (rendered.task) {
        const preflight = await socialImageApi.runPreflight(rendered.task);
        setTask(preflight.task); setStep('review'); setNotice('图片已在后台持久化并完成自动视觉质检。');
        return;
      }
      const nextVersion = Math.max(0, ...activeTask.outputs.map(item => item.version)) + 1;
      const itemRole = imageType === 'carousel' ? 'carousel_page' as const : imageType === 'gif_poster' ? 'gif_plate' as const : 'single' as const;
      const renderItems = rendered.items?.length ? rendered.items : [{ index: 0, url: rendered.url, material: rendered.material }];
      const outputs: SocialImageOutputNode[] = renderItems.map((item, index) => ({ id: crypto.randomUUID(), role: itemRole, label: imageType === 'carousel' ? `轮播第 ${index + 1} 张` : imageType === 'gif_poster' ? `GIF 画面 ${index + 1}` : '主视觉', state: 'quality_checking' as const, mediaUrl: item.url, materialId: item.material?.id, version: nextVersion, qualityChecks: hardChecks.map(key => ({ key, verdict: 'uncertain' as const, severity: 'hard' as const, note: '等待人工复核' })) }));
      if (imageType === 'gif_poster') outputs.push({ id: crypto.randomUUID(), role: 'gif_output', label: 'GIF 成片', state: 'quality_checking', mediaUrl: rendered.url, materialId: rendered.material?.id, version: nextVersion, qualityChecks: hardChecks.map(key => ({ key, verdict: 'uncertain' as const, severity: 'hard' as const, note: '等待人工复核' })) });
      const saved = await socialImageApi.updateTask(activeTask, {
        status: 'review_required', step: 'review', outputs: [...activeTask.outputs.map(item => item.state === 'superseded' ? item : { ...item, state: 'superseded' as const }), ...outputs],
        deliverySpec: { ...activeTask.deliverySpec, imageGeneration: { provider: 'openai', model: 'gpt-image-2', quality: imageQuality } },
        repairInstructions: (activeTask.repairInstructions || []).map(item => item.status === 'pending' ? { ...item, status: 'completed' as const, toVersion: nextVersion } : item),
        generationJobs: activeTask.generationJobs.map(job => job.id === jobId ? { ...job, status: 'quality_checking' as const, provider: rendered.source, outputNodeIds: outputs.map(output => output.id), updatedAt: new Date().toISOString() } : job),
      });
      const preflight = await socialImageApi.runPreflight(saved.task);
      setTask(preflight.task); setStep('review'); setNotice('图片已生成并完成确定性预检；不确定的视觉项目仍需人工确认。');
    } catch (reason) {
      setNotice('');
      if (activeTask.generationJobs?.some(job => job.id === jobId)) {
        const outcomeUnknown = controller.signal.aborted || /outcome_unknown|submission_unknown/i.test(String(reason));
        void socialImageApi.updateTask(activeTask, {
          status: 'blocked',
          generationJobs: activeTask.generationJobs.map(job => job.id === jobId ? {
            ...job, status: outcomeUnknown ? 'outcome_unknown' as const : 'failed' as const,
            error: reason instanceof Error ? reason.message : '图片生成失败', updatedAt: new Date().toISOString(),
          } : job),
        }).then(result => setTask(result.task)).catch(() => undefined);
      }
      if (controller.signal.aborted) {
        setError(generationAbortReasonRef.current === 'manual'
          ? '已停止等待。供应商可能仍在处理本次请求，请不要立即重复提交。'
          : '等待超过 390 秒，已退出当前等待。供应商结果尚未确认，请不要立即重复提交。');
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
    let queuedRepairTask: SocialImageCreationTask | null = null;
    setBusy(true); setError(''); setNotice('正在理解修改要求并只调整对应图层…');
    try {
      if (task.layerGraph) {
        const repaired = await socialImageApi.repairLayered(task, repairRequest.trim());
        const rendered = await socialImageApi.renderLayered(repaired.task);
        const preflight = await socialImageApi.runPreflight(rendered.task);
        setTask(preflight.task); setImageUrl(rendered.url); setStep('review'); setRepairRequest('');
        setNotice(`已修改${repaired.targetLayer}图层并生成新版本，其他图层保持不变。`);
        return;
      }
      if (!poster) throw new Error('当前任务缺少首版图文合同，请先重新生成首版。');
      const currentUnits = task.outputs.filter(output => output.state !== 'superseded' && output.mediaUrl && output.role !== 'gif_output').slice(0, 4);
      if (!currentUnits.length) throw new Error('当前成片不可读取，请先重新生成首版。');
      const repairId = crypto.randomUUID();
      const repairJobId = crypto.randomUUID();
      const repairTarget = 'full_composite' as const;
      const queuedRepair = await socialImageApi.updateTask(task, {
        status: 'generating', step: 'generate',
        repairInstructions: [...task.repairInstructions, { id: repairId, outputNodeId: currentUnits[0]!.id, failedChecks: [], targetLayer: repairTarget, instruction: repairRequest.trim(), status: 'pending', fromVersion: Math.max(1, ...currentUnits.map(item => item.version)) }],
        generationJobs: [...task.generationJobs, { id: repairJobId, idempotencyKey: `${task.id}:repair:${repairId}:v${task.version}`, status: 'running', outputNodeIds: [], attempt: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
      });
      const repairTask = queuedRepair.task;
      queuedRepairTask = repairTask;
      setTask(repairTask);
      const rendered = await studioApi.fbPosterRender({
        poster, caption, ratio, materialIds, productIds, imageModel: 'gpt-image-2', imageQuality, imageType,
        referenceImageUrls: creationPath === 'viral_replication' ? referenceAssets.slice(0, 4) : [],
        currentImageUrls: currentUnits.map(output => output.mediaUrl!), repairInstruction: repairRequest.trim(),
        replicationRecipe: repairTask.replicationRecipe,
        idempotencyKey: `${task.id}:repair:${repairId}:v${task.version}`, confirmedFields: confirmationValues,
        imagePrompt: resolvedCoreClaim,
        socialImageTaskId: repairTask.id, socialImageJobId: repairJobId, socialImageTaskVersion: repairTask.version,
      });
      if (!rendered.ok || !rendered.url) throw new Error(rendered.error || '局部精修失败');
      if (rendered.task) {
        const preflight = await socialImageApi.runPreflight(rendered.task);
        setTask(preflight.task); setImageUrl(rendered.url); setStep('review'); setRepairRequest('');
        setNotice(`已在后台对比原对标和当前成片，并完成${rendered.revisionTarget || '目标'}图层精修；其他区域保持原版本。`);
        return;
      }
      const nextVersion = Math.max(0, ...repairTask.outputs.map(output => output.version)) + 1;
      const itemRole = imageType === 'carousel' ? 'carousel_page' as const : imageType === 'gif_poster' ? 'gif_plate' as const : 'single' as const;
      const renderItems = rendered.items?.length ? rendered.items : [{ index: 0, url: rendered.url, material: rendered.material }];
      const outputs: SocialImageOutputNode[] = renderItems.map((item, index) => ({
        id: crypto.randomUUID(), role: itemRole,
        label: imageType === 'carousel' ? `轮播第 ${index + 1} 张` : imageType === 'gif_poster' ? `GIF 画面 ${index + 1}` : '主视觉',
        state: 'quality_checking', mediaUrl: item.url, materialId: item.material?.id, version: nextVersion,
        qualityChecks: hardChecks.map(key => ({ key, verdict: 'uncertain', severity: 'hard', note: '局部精修后等待复核' })),
      }));
      if (imageType === 'gif_poster') outputs.push({ id: crypto.randomUUID(), role: 'gif_output', label: 'GIF 成片', state: 'quality_checking', mediaUrl: rendered.url, materialId: rendered.material?.id, version: nextVersion, qualityChecks: hardChecks.map(key => ({ key, verdict: 'uncertain', severity: 'hard', note: '局部精修后等待复核' })) });
      const repair = { id: repairId, outputNodeId: currentUnits[0]!.id, failedChecks: [], targetLayer: rendered.revisionTarget || 'full_composite', instruction: repairRequest.trim(), status: 'completed' as const, fromVersion: nextVersion - 1, toVersion: nextVersion };
      const saved = await socialImageApi.updateTask(repairTask, {
        status: 'review_required', step: 'review', outputs: [...repairTask.outputs.map(output => output.state === 'superseded' ? output : { ...output, state: 'superseded' as const }), ...outputs],
        repairInstructions: repairTask.repairInstructions.map(item => item.id === repairId ? repair : item),
      });
      const preflight = await socialImageApi.runPreflight(saved.task);
      setTask(preflight.task); setImageUrl(rendered.url); setStep('review'); setRepairRequest('');
      setNotice(`已在后台对比原对标和当前成片，并完成${rendered.revisionTarget || '目标'}图层精修；其他区域保持原版本。`);
    } catch (reason) {
      if (queuedRepairTask) {
        const failedTask = queuedRepairTask;
        void socialImageApi.updateTask(failedTask, {
          status: 'blocked',
          generationJobs: failedTask.generationJobs.map(job => job.status === 'running' ? { ...job, status: 'failed' as const, error: reason instanceof Error ? reason.message : '局部精修失败', updatedAt: new Date().toISOString() } : job),
          repairInstructions: failedTask.repairInstructions.map(item => item.status === 'pending' ? { ...item, status: 'failed' as const } : item),
        }).then(result => setTask(result.task)).catch(() => undefined);
      }
      setNotice(''); setError(reason instanceof Error ? reason.message : '图层修改失败');
    }
    finally { setBusy(false); }
  };

  const stopWaitingForImage = () => {
    if (!generationAbortRef.current) return;
    generationAbortReasonRef.current = 'manual';
    generationAbortRef.current.abort();
  };

  const renderLeft = () => {
    if (step === 'type') return <div className="space-y-2 p-3"><p className="text-sm font-semibold">成片模式</p>{PRODUCTION_MODES.map(item => <button key={item.id} type="button" onClick={() => changeProductionMode(item.id)} className={`w-full rounded-lg border p-3 text-left ${productionMode === item.id ? 'border-blue-500 bg-blue-50' : 'border-border bg-white hover:bg-zinc-50'}`}><span className="flex items-center justify-between gap-2 text-sm font-semibold text-text-primary"><span>{item.label}</span>{referenceImageMode === item.id && creationPath === 'viral_replication' && <Tag color="blue">自动识别</Tag>}</span><span className="mt-1 block text-xs leading-5 text-text-secondary">{item.description}</span></button>)}</div>;
    if (step === 'inputs') return <div className="space-y-3 p-3"><div><p className="text-sm font-semibold">成片模式</p><p className="mt-1 text-xs leading-5 text-text-muted">{creationPath === 'viral_replication' ? '已按爬取内容自动选择；识别有误时可手动切换。' : '选择最终交付形态，题材与版式由系统判断。'}</p></div><div className="space-y-2">{PRODUCTION_MODES.map(item => <button key={item.id} type="button" onClick={() => changeProductionMode(item.id)} className={`w-full rounded-lg border p-3 text-left ${productionMode === item.id ? 'border-blue-500 bg-blue-50' : 'border-border bg-white hover:bg-zinc-50'}`}><span className="flex items-center justify-between gap-2 text-sm font-semibold text-text-primary"><span>{item.label}</span>{referenceImageMode === item.id && creationPath === 'viral_replication' && <Tag color="blue">自动识别</Tag>}</span><span className="mt-1 block text-xs leading-5 text-text-secondary">{item.description}</span></button>)}</div><p className="pt-2 text-sm font-semibold">内容节点</p>{['核心主张', '企业产品', '图片素材', '受众与平台', '事实真实性'].map((label, index) => <div key={label} className="flex items-center justify-between rounded-lg border border-border bg-white px-3 py-2 text-xs"><span>{label}</span><Tag color={(index === 0 ? coreClaim : index === 1 ? productIds.length : index === 2 ? materialIds.length : true) ? 'success' : 'warning'}>{(index === 0 ? coreClaim : index === 1 ? productIds.length : index === 2 ? materialIds.length : true) ? '已填写' : '待补充'}</Tag></div>)}</div>;
    if (step === 'plan') return <div className="space-y-2 p-3"><p className="text-sm font-semibold">图文合同</p>{['核心主张', '画面标题', '帖子配文', 'CTA', '事实边界'].map(label => <div key={label} className="rounded-lg border border-border bg-white p-3 text-xs">{label}<span className="float-right text-text-muted">{poster ? '已生成' : '待生成'}</span></div>)}</div>;
    if (step === 'generate') return <div className="space-y-2 p-3"><p className="text-sm font-semibold">候选版本</p><div className="rounded-lg border border-blue-300 bg-blue-50 p-3 text-xs">候选 1<span className="float-right">{imageUrl ? '已生成' : '待生成'}</span></div></div>;
    return <div className="space-y-2 p-3"><p className="text-sm font-semibold">交付物</p><div className="rounded-lg border border-border bg-white p-3 text-xs">主视觉 <Tag color={task?.publishable ? 'success' : 'warning'}>{task?.publishable ? '可发布' : '待审核'}</Tag></div><div className="rounded-lg border border-border bg-white p-3 text-xs">帖子配文 <Tag color={caption ? 'success' : 'default'}>{caption ? '已生成' : '待生成'}</Tag></div></div>;
  };

  return <div className="flex h-full min-h-0 flex-col bg-white">
    <LsPageHeader title="图片内容制作工作台" extra={<Button onClick={onShowCreations}>我的创作</Button>}>
      <Steps size="small" current={currentStepIndex} onChange={navigateToStage} items={STEP_ITEMS.map(item => ({ title: item.title }))} className="px-4 pb-3" />
    </LsPageHeader>
    <div className="social-creation-workbench-layout grid min-h-0 flex-1 overflow-y-auto md:overflow-hidden">
      <aside className="min-h-0 border-b border-border bg-white md:overflow-y-auto md:border-b-0 md:border-r">{renderLeft()}</aside>
      <main className="flex min-h-[460px] min-w-0 flex-col bg-[#f5f5f5] md:min-h-0">
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-lg border border-border bg-white">
            {hasReferencePreview && <div className="absolute right-3 top-3 z-10 flex items-center rounded-lg border border-border bg-white/95 p-1 shadow-sm backdrop-blur"><button type="button" onClick={() => setPreviewSource('generated')} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${previewSource === 'generated' ? 'bg-blue-600 text-white' : 'text-text-secondary hover:bg-zinc-100'}`}>生成结果</button><button type="button" onClick={() => setPreviewSource('reference')} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${previewSource === 'reference' ? 'bg-blue-600 text-white' : 'text-text-secondary hover:bg-zinc-100'}`}>原对标</button></div>}
            {previewSource === 'reference' && currentReferenceAsset ? <><img key={currentReferenceAsset} src={currentReferenceAsset} alt={`原对标${isReferenceCarousel ? `第 ${referenceIndex + 1} 张` : productionMode === 'gif' ? ' GIF' : '图片'}`} className="h-full w-full object-contain" />{isReferenceCarousel && <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-white/95 px-2 py-1.5 shadow-sm backdrop-blur"><button type="button" aria-label="上一张对标图" onClick={() => setReferenceIndex(index => (index - 1 + referenceAssets.length) % referenceAssets.length)} className="rounded-full p-1 text-text-secondary hover:bg-zinc-100"><ChevronLeft size={15} /></button><button type="button" aria-label={referencePlaying ? '暂停播放轮播图' : '播放轮播图'} onClick={() => setReferencePlaying(value => !value)} className="rounded-full p-1 text-blue-600 hover:bg-blue-50">{referencePlaying ? <Pause size={14} /> : <Play size={14} />}</button><span className="min-w-12 text-center text-[11px] font-medium text-text-secondary">{referenceIndex + 1} / {referenceAssets.length}</span><button type="button" aria-label="下一张对标图" onClick={() => setReferenceIndex(index => (index + 1) % referenceAssets.length)} className="rounded-full p-1 text-text-secondary hover:bg-zinc-100"><ChevronRight size={15} /></button></div>}</>
              : currentGeneratedAsset ? <><img src={productionMode === 'gif' ? imageUrl : currentGeneratedAsset} alt="生成图片预览" className="h-full w-full object-contain" />{productionMode === 'carousel' && generatedAssets.length > 1 && <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-white/95 px-2 py-1.5 shadow-sm backdrop-blur"><button type="button" aria-label="上一张生成图" onClick={() => setGeneratedIndex(index => (index - 1 + generatedAssets.length) % generatedAssets.length)} className="rounded-full p-1 text-text-secondary hover:bg-zinc-100"><ChevronLeft size={15} /></button><span className="min-w-12 text-center text-[11px] font-medium text-text-secondary">{generatedIndex + 1} / {generatedAssets.length}</span><button type="button" aria-label="下一张生成图" onClick={() => setGeneratedIndex(index => (index + 1) % generatedAssets.length)} className="rounded-full p-1 text-text-secondary hover:bg-zinc-100"><ChevronRight size={15} /></button></div>}</>
              : referenceThumbnail && creationPath === 'viral_replication' ? <img src={referenceThumbnail} alt="对标作品" className="h-full w-full object-contain" />
              : poster ? <div className="max-w-xl p-8 text-center"><Layers3 className="mx-auto text-blue-600" /><h2 className="mt-4 text-xl font-semibold">{poster.headline}</h2><p className="mt-2 text-sm text-text-secondary">{poster.subheadline}</p><p className="mt-6 text-xs text-text-muted">已完成图文策划，下一步生成正式图片</p></div>
              : <div className="max-w-md px-8 text-center"><FileImage size={40} className="mx-auto text-zinc-400" /><p className="mt-4 text-base font-semibold">图片内容制作</p><p className="mt-2 text-sm leading-6 text-text-secondary">确认成片模式、绑定企业产品和事实，再联合生成画面与帖子配文。</p></div>}
          </div>
        </div>
        {(caption || hashtags.length > 0) && <div className="border-t border-border bg-white p-4"><p className="text-xs font-semibold">帖子配文</p><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-text-secondary">{caption}</p><p className="mt-2 text-xs text-blue-600">{hashtags.map(tag => `#${tag.replace(/^#/, '')}`).join(' ')}</p></div>}
      </main>
      <aside className="flex min-h-0 flex-col border-t border-border bg-white md:border-l md:border-t-0">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {step === 'type' && <><p className="text-sm font-semibold">交付规格</p><label className="block text-xs font-medium">平台<Select className="mt-1 w-full" value={platform} onChange={setPlatform} options={[{value:'facebook',label:'Facebook'},{value:'instagram',label:'Instagram'},{value:'linkedin',label:'LinkedIn'}]} /></label><label className="block text-xs font-medium">比例<Select className="mt-1 w-full" value={ratio} onChange={setRatio} options={['1:1','4:5','9:16'].map(value => ({value,label:value}))} /></label><label className="block text-xs font-medium">语言<Select className="mt-1 w-full" value={language} onChange={setLanguage} options={[{value:'en',label:'English'},{value:'zh',label:'中文'}]} /></label></>}
          {step === 'inputs' && <><p className="text-sm font-semibold">内容与资产</p><div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-blue-800"><span className="font-semibold">当前成片：{PRODUCTION_MODES.find(item => item.id === productionMode)?.label}</span><br />{creationPath === 'viral_replication' ? '来自爬取内容的自动判断，可在左侧纠正。' : '内容题材和版式将在策划阶段自动推导。'}</div><label className="block text-xs font-medium">任务名称<Input className="mt-1" value={title} onChange={event => setTitle(event.target.value)} /></label><label className="block text-xs font-medium">企业产品<Select mode="multiple" className="mt-1 w-full" value={productIds} onChange={setProductIds} options={products.map(item => ({value:item.id,label:item.name}))} placeholder="至少选择一个产品" /></label><label className="block text-xs font-medium">核心主张<Input.TextArea className="mt-1" rows={4} value={coreClaim} onChange={event => setCoreClaim(event.target.value)} placeholder="这条内容只讲清的一件事" /></label><label className="block text-xs font-medium">目标受众<Input className="mt-1" value={audience} onChange={event => setAudience(event.target.value)} /></label><label className="block text-xs font-medium">事实状态<Select className="mt-1 w-full" value={factuality} onChange={setFactuality} options={[{value:'verified',label:'企业资料已验证'},{value:'user_supplied',label:'用户提供，待核验'},{value:'mock',label:'模拟内容，不可直接发布'}]} /></label><div><div className="flex items-center justify-between gap-2"><p className="text-xs font-medium">企业图片素材</p><Button size="small" icon={<Upload size={13} />} loading={busy} onClick={() => uploadRef.current?.click()}>上传图片</Button><input ref={uploadRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple className="hidden" onChange={event => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ''; void uploadImages(files); }} /></div><div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-2">{materials.length ? materials.map(item => <Checkbox key={item.id} checked={materialIds.includes(item.id)} onChange={event => setMaterialIds(current => event.target.checked ? [...current,item.id] : current.filter(id => id !== item.id))} className="flex text-xs"><span className="line-clamp-1">{item.name}</span></Checkbox>) : <p className="p-2 text-xs text-text-muted">素材库暂无企业图片，可以在这里直接上传。</p>}</div></div></>}
          {step === 'plan' && <><p className="text-sm font-semibold">策划依据</p><p className="rounded-lg bg-zinc-50 p-3 text-xs leading-5">成片：{PRODUCTION_MODES.find(item => item.id === productionMode)?.label}<br />后台题材：{CONTENT_ARCHETYPES.find(item => item.id === imageType)?.label}<br />图文关系：图片证明或解释核心主张<br />配色：从企业产品与品牌素材推导</p></>}
          {step === 'generate' && <><p className="text-sm font-semibold">生成设置</p><div className="rounded-lg border border-border bg-zinc-50 p-3"><p className="text-xs font-medium">模型</p><p className="mt-1 text-sm font-semibold">GPT Image 2</p></div><label className="block text-xs font-medium">出图质量<Select className="mt-1 w-full" value={imageQuality} disabled={busy} onChange={setImageQuality} options={[{value:'low',label:'Low · 成本优先（默认）'},{value:'medium',label:'Medium · 质量升级'},{value:'high',label:'High · 最高质量'}]} /></label><p className="text-xs leading-5 text-text-secondary">Low 适合批量初稿；Medium 约为 Low 的 8 倍输出成本；High 约为 Low 的 33 倍。升级只影响本次及后续重试。</p><p className="text-xs leading-5 text-text-secondary">系统将自动完成资产匹配、首版渲染与预检。</p></>}
          {step === 'review' && <><p className="text-sm font-semibold">自然语言修改</p><Input.TextArea rows={3} value={repairRequest} onChange={event => setRepairRequest(event.target.value)} placeholder="例如：产品缩小一点并下移；遮罩淡一点；标题改成 Golden Hair Ritual；删除认证信息" /><p className="text-xs leading-5 text-text-secondary">系统在后台完成检查；这里只需要描述希望修改的结果。</p>{fieldsToConfirm.length > 0 && <Alert type="warning" showIcon message={`待处理信息 · ${fieldsToConfirm.length} 项`} description={<Button size="small" className="mt-2" onClick={() => setConfirmationOpen(true)}>统一查看与补充</Button>} />}{factuality === 'mock' && <Alert type="warning" showIcon message="当前为模拟内容，请在发布前自行确认事实" />}</>}
          {error && <Alert type="error" showIcon message={error} />}{notice && <Alert type="info" showIcon message={notice} />}
        </div>
        <div className="border-t border-border px-4 pb-24 pt-4">
          {step === 'type' && <Button type="primary" block onClick={() => setStep('inputs')} icon={<ImagePlus size={15} />}>进入内容与资产</Button>}
          {step === 'inputs' && <Button type="primary" block loading={busy} onClick={() => void saveInputs()}>{busy ? '正在生成首版' : '一次生成首版'}</Button>}
          {step === 'plan' && <><Button type="primary" block loading={busy} disabled={busy} onClick={() => void generatePlan()}>{busy ? '正在自动策划并生成首版' : '重试一键生成'}</Button><Button block className="mt-2" disabled={busy} onClick={() => setStep('inputs')}>返回修改输入</Button></>}
          {step === 'generate' && <><Button type="primary" block loading={busy} disabled={busy || !poster} onClick={() => void generateImage()} icon={busy ? <Spin size="small" /> : <RefreshCw size={15} />}>{busy ? `正在生成首版 · ${generationElapsed} 秒` : '重试生成首版'}</Button>{busy ? <Button block danger className="mt-2" onClick={stopWaitingForImage}>停止等待</Button> : <Button block className="mt-2" onClick={() => setStep('inputs')}>返回修改输入</Button>}</>}
          {step === 'review' && <><Button type="primary" block loading={busy} disabled={!repairRequest.trim()} onClick={() => void applyNaturalLanguageRepair()}>按描述修改</Button>{fieldsToConfirm.length > 0 && <Button block className="mt-2" onClick={() => setConfirmationOpen(true)}>统一处理待补充信息</Button>}{imageUrl && <Button block className="mt-2" href={imageUrl} target="_blank" icon={<CheckCircle2 size={15} />}>下载成片</Button>}</>}
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
