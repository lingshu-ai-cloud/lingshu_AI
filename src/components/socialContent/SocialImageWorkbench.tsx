import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Input, Modal, Select, Spin, Steps, Tag } from 'antd';
import { CheckCircle2, FileImage, ImagePlus, Layers3, RefreshCw, Upload } from 'lucide-react';
import LsPageHeader from '../ui/LsPageHeader';
import { authHeader } from '../../lib/auth';
import { socialImageApi } from '../../lib/socialImageApi';
import { studioApi, type FbPosterBrief, type Material } from '../../lib/studioApi';
import {
  SOCIAL_IMAGE_HARD_CHECKS,
  type SocialImageContentType,
  type SocialImageCreationPath,
  type SocialImageCreationTask,
  type SocialImageQualityCheckKey,
  type SocialImageRepairInstruction,
} from '../../../shared/contracts/socialImageCreation';

type ProductOption = { id: string; name: string };
type WorkbenchStep = 'type' | 'inputs' | 'plan' | 'generate' | 'review';

const IMAGE_TYPES: Array<{ id: SocialImageContentType; label: string; description: string; available: boolean }> = [
  { id: 'light_packaging', label: '单图/轻包装', description: '产品实拍或场景图加少量文字包装', available: true },
  { id: 'product_poster', label: '产品海报', description: '突出产品、卖点和询盘动作', available: true },
  { id: 'brand_news', label: '品牌新闻', description: '合作、发布、展会或企业事件', available: true },
  { id: 'experiment_comparison', label: '实验对比', description: '用前后差异或实验过程证明价值', available: true },
  { id: 'trend', label: '趋势内容', description: '趋势洞察连接企业产品机会', available: true },
  { id: 'infographic', label: '信息图', description: '结构化解释技术、流程或数据', available: true },
  { id: 'carousel', label: '轮播图', description: '连续多页讲清问题、证据和方案', available: false },
  { id: 'gif_poster', label: 'GIF 动态海报', description: '底图切换、打字或状态出现', available: false },
];

const STEP_ITEMS = [
  { key: 'inputs', title: '内容与资产' }, { key: 'production', title: '生成首版' }, { key: 'review', title: '审阅交付' },
] as const;

type PlannedRun = { task: SocialImageCreationTask; poster: FbPosterBrief; caption: string };

function actionableConfirmationFields(fields: string[] = []) {
  return [...new Set(fields.map(String).map(item => item.trim()).filter(item => item && item !== '图文策划需人工审阅'))];
}

const CHECK_LABELS: Record<SocialImageQualityCheckKey, string> = {
  product_identity: '产品身份正确', packaging_visibility: '包装关键部位可见', subject_visibility: '主体未被内容模块遮挡',
  label_ocr: '图片文字正确', fact_consistency: '图片与已确认事实一致', copy_visual_consistency: '图片与帖子配文一致',
  brand_consistency: '品牌与配色一致', text_overflow: '文字没有溢出或裁切', safe_zone: '主体位于安全区',
  reference_structure_similarity: '参考结构还原度', motion_mechanism_similarity: '动效机制还原度',
};

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
  creationPath, referenceTitle, referenceThumbnail, referenceMediaUrl, referenceCaption, initialTask, onShowCreations,
}: {
  creationPath: SocialImageCreationPath;
  referenceTitle?: string;
  referenceThumbnail?: string;
  referenceMediaUrl?: string;
  referenceCaption?: string;
  initialTask?: SocialImageCreationTask;
  onShowCreations: () => void;
}) {
  const restoredStep: WorkbenchStep = initialTask?.step === 'motion' ? 'review' : initialTask?.step === 'type' ? 'inputs' : initialTask?.step || 'inputs';
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
  const [ratio, setRatio] = useState<'1:1' | '4:5' | '9:16'>((initialTask?.deliverySpec.aspectRatio === '1:1' || initialTask?.deliverySpec.aspectRatio === '9:16') ? initialTask.deliverySpec.aspectRatio : '4:5');
  const [language, setLanguage] = useState<'en' | 'zh'>(initialTask?.deliverySpec.language === 'zh' ? 'zh' : 'en');
  const [imageQuality, setImageQuality] = useState<'low' | 'medium' | 'high'>(initialTask?.deliverySpec.imageGeneration?.quality || 'low');
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
  const [qualityPasses, setQualityPasses] = useState<SocialImageQualityCheckKey[]>(initialTask?.outputs.flatMap(output => output.qualityChecks.filter(check => check.verdict === 'pass').map(check => check.key)) || []);
  const [busy, setBusy] = useState(false);
  const [generationElapsed, setGenerationElapsed] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [repairRequest, setRepairRequest] = useState('');
  const uploadRef = useRef<HTMLInputElement>(null);
  const generationAbortRef = useRef<AbortController | null>(null);
  const generationAbortReasonRef = useRef<'manual' | 'deadline' | null>(null);

  useEffect(() => () => generationAbortRef.current?.abort(), []);

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
        sourceUrl: referenceTitle, title: referenceTitle, caption: referenceCaption, imageUrls: benchmarkImage ? [benchmarkImage] : [], collectedAt: new Date().toISOString(),
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
        deliverySpec: { ...current.deliverySpec, platform, aspectRatio: ratio, language, imageGeneration: { provider: 'openai', model: 'gpt-image-2', quality: imageQuality }, format: imageType === 'gif_poster' ? 'gif' : imageType === 'carousel' ? 'carousel' : 'jpg', outputCount: imageType === 'carousel' ? 4 : imageType === 'gif_poster' ? 4 : 1 },
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
      setQualityPasses([...new Set(preflight.task.outputs.flatMap(item => item.qualityChecks.filter(check => check.verdict === 'pass').map(check => check.key)))]);
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
          id: jobId, idempotencyKey, status: 'running', outputNodeIds: [], attempt: 1,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        }],
      });
      activeTask = queued.task; setTask(activeTask);
      const renderRequest = {
        poster: sourcePoster, caption: sourceCaption, ratio, materialIds, productIds, imageQuality,
        referenceImageUrls: creationPath === 'viral_replication' ? [referenceMediaUrl || referenceThumbnail || ''].filter(Boolean) : [],
        idempotencyKey,
        confirmedFields: confirmationValues,
        imagePrompt: [resolvedCoreClaim, `Content type: ${imageType}.`,
          creationPath === 'viral_replication'
            ? 'Treat the benchmark as a locked visual recipe: preserve its composition hierarchy, product-group rhythm, palette relationship, background lighting, overlay zones and typography mood. Replace only competitor identity, product, claims and contact content with verified enterprise assets and facts. Never invent a missing package, badge, certification or product view.'
            : 'Use the enterprise brand and product assets as the primary visual system.',
          'Preserve every supplied enterprise product identity and packaging anchor. Keep the main subject outside headline, translucent overlay, logo and CTA safe zones. Minor overlap is allowed, but never hide the complete cap, brand name or core label.',
          ...(activeTask.repairInstructions || []).filter(item => item.status === 'pending').map(item => `Targeted repair (${item.targetLayer}): ${item.instruction}`),
        ].join(' '),
      };
      let rendered = await studioApi.fbPosterRender(renderRequest, { signal: controller.signal });
      if (!rendered.ok && /产品.*(?:主图|资产|图片).*(?:不可读取|可读取)|(?:主图|资产|图片).*不可读取|PRODUCT_REFERENCE|ENTERPRISE_PRODUCT_IMAGE/i.test(String(rendered.error || ''))) {
        rendered = await studioApi.fbPosterRender({ ...renderRequest, productIds: [] }, { signal: controller.signal });
      }
      if (!rendered.ok || !rendered.url) throw new Error(rendered.error || '图片生成失败');
      setImageUrl(rendered.url); setQualityPasses([]);
      const nextVersion = Math.max(0, ...activeTask.outputs.filter(item => item.role === 'single' && item.label === '主视觉').map(item => item.version)) + 1;
      const output = { id: crypto.randomUUID(), role: 'single' as const, label: '主视觉', state: 'quality_checking' as const, mediaUrl: rendered.url, materialId: rendered.material?.id, version: nextVersion, qualityChecks: hardChecks.map(key => ({ key, verdict: 'uncertain' as const, severity: 'hard' as const, note: '等待人工复核' })) };
      const saved = await socialImageApi.updateTask(activeTask, {
        status: 'review_required', step: 'review', outputs: [...activeTask.outputs.map(item => item.role === output.role && item.label === output.label ? { ...item, state: 'superseded' as const } : item), output],
        repairInstructions: (activeTask.repairInstructions || []).map(item => item.status === 'pending' ? { ...item, status: 'completed' as const, toVersion: nextVersion } : item),
        generationJobs: activeTask.generationJobs.map(job => job.id === jobId ? { ...job, status: 'quality_checking' as const, provider: rendered.source, outputNodeIds: [output.id], updatedAt: new Date().toISOString() } : job),
      });
      const preflight = await socialImageApi.runPreflight(saved.task);
      const automaticPasses = preflight.task.outputs.flatMap(item => item.qualityChecks.filter(check => check.verdict === 'pass').map(check => check.key));
      setQualityPasses([...new Set(automaticPasses)]);
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
      setQualityPasses([...new Set(preflight.task.outputs.flatMap(item => item.qualityChecks.filter(check => check.verdict === 'pass').map(check => check.key)))]);
      setNotice(`已修改${repaired.targetLayer}图层并生成新版本，其他图层保持不变。`);
    } catch (reason) { setNotice(''); setError(reason instanceof Error ? reason.message : '图层修改失败'); }
    finally { setBusy(false); }
  };

  const stopWaitingForImage = () => {
    if (!generationAbortRef.current) return;
    generationAbortReasonRef.current = 'manual';
    generationAbortRef.current.abort();
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

  const renderLeft = () => {
    if (step === 'type') return <div className="space-y-2 p-3">{IMAGE_TYPES.map(item => <button key={item.id} type="button" disabled={!item.available} onClick={() => setImageType(item.id)} className={`w-full rounded-lg border p-3 text-left ${!item.available ? 'cursor-not-allowed border-border bg-zinc-50 opacity-60' : imageType === item.id ? 'border-blue-500 bg-blue-50' : 'border-border bg-white hover:bg-zinc-50'}`}><span className="flex items-center justify-between gap-2 text-sm font-semibold text-text-primary"><span>{item.label}</span>{!item.available && <Tag>后续阶段</Tag>}</span><span className="mt-1 block text-xs leading-5 text-text-secondary">{item.description}</span></button>)}</div>;
    if (step === 'inputs') return <div className="space-y-3 p-3"><p className="text-sm font-semibold">内容节点</p>{['内容类型', '核心主张', '企业产品', '图片素材', '受众与平台', '事实真实性'].map((label, index) => <div key={label} className="flex items-center justify-between rounded-lg border border-border bg-white px-3 py-2 text-xs"><span>{label}</span><Tag color={(index === 0 ? imageType : index === 1 ? coreClaim : index === 2 ? productIds.length : index === 3 ? materialIds.length : true) ? 'success' : 'warning'}>{(index === 0 ? imageType : index === 1 ? coreClaim : index === 2 ? productIds.length : index === 3 ? materialIds.length : true) ? '已填写' : '待补充'}</Tag></div>)}</div>;
    if (step === 'plan') return <div className="space-y-2 p-3"><p className="text-sm font-semibold">图文合同</p>{['核心主张', '画面标题', '帖子配文', 'CTA', '事实边界'].map(label => <div key={label} className="rounded-lg border border-border bg-white p-3 text-xs">{label}<span className="float-right text-text-muted">{poster ? '已生成' : '待生成'}</span></div>)}</div>;
    if (step === 'generate') return <div className="space-y-2 p-3"><p className="text-sm font-semibold">候选版本</p><div className="rounded-lg border border-blue-300 bg-blue-50 p-3 text-xs">候选 1<span className="float-right">{imageUrl ? '已生成' : '待生成'}</span></div></div>;
    return <div className="space-y-2 p-3"><p className="text-sm font-semibold">交付物</p><div className="rounded-lg border border-border bg-white p-3 text-xs">主视觉 <Tag color={task?.publishable ? 'success' : 'warning'}>{task?.publishable ? '可发布' : '待审核'}</Tag></div><div className="rounded-lg border border-border bg-white p-3 text-xs">帖子配文 <Tag color={caption ? 'success' : 'default'}>{caption ? '已生成' : '待生成'}</Tag></div></div>;
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
            {imageUrl ? <img src={imageUrl} alt="生成图片预览" className="h-full w-full object-contain" />
              : referenceThumbnail && creationPath === 'viral_replication' ? <img src={referenceThumbnail} alt="对标作品" className="h-full w-full object-contain" />
              : poster ? <div className="max-w-xl p-8 text-center"><Layers3 className="mx-auto text-blue-600" /><h2 className="mt-4 text-xl font-semibold">{poster.headline}</h2><p className="mt-2 text-sm text-text-secondary">{poster.subheadline}</p><p className="mt-6 text-xs text-text-muted">已完成图文策划，下一步生成正式图片</p></div>
              : <div className="max-w-md px-8 text-center"><FileImage size={40} className="mx-auto text-zinc-400" /><p className="mt-4 text-base font-semibold">图片内容制作</p><p className="mt-2 text-sm leading-6 text-text-secondary">选择内容类型、绑定企业产品和事实，再联合生成图片与帖子配文。</p></div>}
          </div>
        </div>
        {(caption || hashtags.length > 0) && <div className="border-t border-border bg-white p-4"><p className="text-xs font-semibold">帖子配文</p><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-text-secondary">{caption}</p><p className="mt-2 text-xs text-blue-600">{hashtags.map(tag => `#${tag.replace(/^#/, '')}`).join(' ')}</p></div>}
      </main>
      <aside className="flex min-h-0 flex-col border-t border-border bg-white md:border-l md:border-t-0">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {step === 'type' && <><p className="text-sm font-semibold">交付规格</p><label className="block text-xs font-medium">平台<Select className="mt-1 w-full" value={platform} onChange={setPlatform} options={[{value:'facebook',label:'Facebook'},{value:'instagram',label:'Instagram'},{value:'linkedin',label:'LinkedIn'}]} /></label><label className="block text-xs font-medium">比例<Select className="mt-1 w-full" value={ratio} onChange={setRatio} options={['1:1','4:5','9:16'].map(value => ({value,label:value}))} /></label><label className="block text-xs font-medium">语言<Select className="mt-1 w-full" value={language} onChange={setLanguage} options={[{value:'en',label:'English'},{value:'zh',label:'中文'}]} /></label></>}
          {step === 'inputs' && <><p className="text-sm font-semibold">内容与资产</p><label className="block text-xs font-medium">内容类型<Select className="mt-1 w-full" value={imageType} onChange={setImageType} options={IMAGE_TYPES.filter(item => item.available).map(item => ({value:item.id,label:item.label}))} /></label><label className="block text-xs font-medium">任务名称<Input className="mt-1" value={title} onChange={event => setTitle(event.target.value)} /></label><label className="block text-xs font-medium">企业产品<Select mode="multiple" className="mt-1 w-full" value={productIds} onChange={setProductIds} options={products.map(item => ({value:item.id,label:item.name}))} placeholder="至少选择一个产品" /></label><label className="block text-xs font-medium">核心主张<Input.TextArea className="mt-1" rows={4} value={coreClaim} onChange={event => setCoreClaim(event.target.value)} placeholder="这条内容只讲清的一件事" /></label><label className="block text-xs font-medium">目标受众<Input className="mt-1" value={audience} onChange={event => setAudience(event.target.value)} /></label><label className="block text-xs font-medium">事实状态<Select className="mt-1 w-full" value={factuality} onChange={setFactuality} options={[{value:'verified',label:'企业资料已验证'},{value:'user_supplied',label:'用户提供，待核验'},{value:'mock',label:'模拟内容，不可直接发布'}]} /></label><div><div className="flex items-center justify-between gap-2"><p className="text-xs font-medium">企业图片素材</p><Button size="small" icon={<Upload size={13} />} loading={busy} onClick={() => uploadRef.current?.click()}>上传图片</Button><input ref={uploadRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple className="hidden" onChange={event => { const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = ''; void uploadImages(files); }} /></div><div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-2">{materials.length ? materials.map(item => <Checkbox key={item.id} checked={materialIds.includes(item.id)} onChange={event => setMaterialIds(current => event.target.checked ? [...current,item.id] : current.filter(id => id !== item.id))} className="flex text-xs"><span className="line-clamp-1">{item.name}</span></Checkbox>) : <p className="p-2 text-xs text-text-muted">素材库暂无企业图片，可以在这里直接上传。</p>}</div></div></>}
          {step === 'plan' && <><p className="text-sm font-semibold">策划依据</p><p className="rounded-lg bg-zinc-50 p-3 text-xs leading-5">题材：{IMAGE_TYPES.find(item => item.id === imageType)?.label}<br />图文关系：图片证明或解释核心主张<br />配色：从企业产品与品牌素材推导</p></>}
          {step === 'generate' && <><p className="text-sm font-semibold">正在生成</p><p className="text-xs leading-5 text-text-secondary">系统将自动完成策划、资产匹配、首版渲染与预检，不再因补充信息中断。</p></>}
          {step === 'review' && <><p className="text-sm font-semibold">自然语言修改</p><Input.TextArea rows={3} value={repairRequest} onChange={event => setRepairRequest(event.target.value)} placeholder="例如：产品缩小一点并下移；遮罩淡一点；标题改成 Golden Hair Ritual；删除认证信息" /><p className="text-xs leading-5 text-text-secondary">系统只修改对应图层并保留其他图层。所有待处理信息统一汇总，不影响成片生成和下载。</p>{fieldsToConfirm.length > 0 && <Alert type="warning" showIcon message={`待处理信息 · ${fieldsToConfirm.length} 项`} description={<Button size="small" className="mt-2" onClick={() => setConfirmationOpen(true)}>统一查看与补充</Button>} />}<p className="pt-2 text-sm font-semibold">自动检查（不阻断）</p><div className="flex flex-wrap gap-2">{hardChecks.map(key => <Tag key={key} color={qualityPasses.includes(key) ? 'success' : 'default'}>{CHECK_LABELS[key]}</Tag>)}</div>{factuality === 'mock' && <Alert type="warning" showIcon message="当前为模拟内容，请在发布前自行确认事实" />}</>}
          {error && <Alert type="error" showIcon message={error} />}{notice && <Alert type="info" showIcon message={notice} />}
        </div>
        <div className="border-t border-border px-4 pb-24 pt-4">
          {step === 'inputs' && <label className="mb-3 block text-xs font-medium">GPT Image 2 质量<Select className="mt-1 w-full" value={imageQuality} onChange={setImageQuality} options={[{value:'low',label:'Low · 默认'},{value:'medium',label:'Medium'},{value:'high',label:'High'}]} /></label>}
          {step === 'type' && <Button type="primary" block onClick={() => setStep('inputs')} icon={<ImagePlus size={15} />}>进入内容与资产</Button>}
          {step === 'inputs' && <Button type="primary" block loading={busy} onClick={() => void saveInputs()}>{busy ? '正在生成首版' : '一次生成首版'}</Button>}
          {step === 'plan' && <><Button type="primary" block loading={busy} disabled={busy} onClick={() => void generatePlan()}>{busy ? '正在自动策划并生成首版' : '重试一键生成'}</Button><Button block className="mt-2" disabled={busy} onClick={() => setStep('inputs')}>返回修改输入</Button></>}
          {step === 'generate' && <><Button type="primary" block loading={busy} disabled={busy || !poster} onClick={() => void generateImage()} icon={busy ? <Spin size="small" /> : <RefreshCw size={15} />}>{busy ? `正在生成首版 · ${generationElapsed} 秒` : '重试生成首版'}</Button>{busy ? <Button block danger className="mt-2" onClick={stopWaitingForImage}>停止等待</Button> : <Button block className="mt-2" onClick={() => setStep('inputs')}>返回修改输入</Button>}</>}
          {step === 'review' && <><Button type="primary" block loading={busy} disabled={!repairRequest.trim()} onClick={() => void applyNaturalLanguageRepair()}>按描述修改对应图层</Button>{fieldsToConfirm.length > 0 && <Button block className="mt-2" onClick={() => setConfirmationOpen(true)}>统一处理待补充信息</Button>}{imageUrl && qualityPasses.length < hardChecks.length && <Button block className="mt-2" loading={busy} onClick={() => void startTargetedRepair()}>按检查结果优化一版</Button>}{imageUrl && <Button block className="mt-2" href={imageUrl} target="_blank" icon={<CheckCircle2 size={15} />}>下载成片</Button>}</>}
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
