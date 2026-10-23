import { useState, type Dispatch, type SetStateAction } from 'react';
import { studioApi, type FbPosterResult, type LeadContentPackageResult } from '../../lib/studioApi';
import { IMAGE_DELIVERABLE_LABELS, planImageProduction, type ImageDeliverable } from '../../../shared/imageCreativePlanning';
import { cloneReferenceAnalysisText } from './studioCloneReference';
import { materialRoleLabel } from './studioMaterialScriptEvidence';
import type { VideoKickoff } from './studioVideoKickoff';
import type { Clip } from './studioSourceMaterial';

export interface StudioPosterGenerationInput {
  product: { info: string; label: string };
  output: { imageDeliverable: ImageDeliverable; platform: string; lang: string; ratio: string;
    posterStyle: string; provider?: 'gemini' | 'qwen' };
  videoKickoff: VideoKickoff | null;
  materials: Clip[];
  selectedClips: Clip[];
  materialById: Map<string, Clip>;
  selectedProductIds: string[];
  onSelect: Dispatch<SetStateAction<string[]>>;
  onCaption(caption: string): void;
  onNotice(message: string): void;
  refreshMaterials(): Promise<Clip[]>;
}

export function studioPosterEligibility(input: {
  posterDraft: FbPosterResult | null; posterImageUrl: string;
  posterImageReviewStatus: 'none' | 'needs_review' | 'accepted';
}) {
  const { posterDraft, posterImageUrl, posterImageReviewStatus } = input;
  const posterBriefIsVerified = Boolean(
    posterDraft?.ok
    && posterDraft.source === 'ai'
    && posterDraft.provenance === 'ai'
    && posterDraft.qualityStatus === 'passed'
    && posterDraft.publishable === true
    && !posterDraft.fieldsToConfirm?.length,
  );
  const posterGenerationIsVerified = posterBriefIsVerified
    && Boolean(posterImageUrl)
    && posterImageReviewStatus === 'accepted';
  return { posterBriefIsVerified, posterGenerationIsVerified };
}

function useStudioPosterState() {
  const [posterLoading, setPosterLoading] = useState(false);
  const [posterDraft, setPosterDraft] = useState<FbPosterResult | null>(null);
  const [leadContentPackage, setLeadContentPackage] = useState<LeadContentPackageResult | null>(null);
  const [posterJsonText, setPosterJsonText] = useState('');
  const [posterImageUrl, setPosterImageUrl] = useState('');
  const [posterImageMaterialId, setPosterImageMaterialId] = useState('');
  const [posterImageReviewStatus, setPosterImageReviewStatus] = useState<'none' | 'needs_review' | 'accepted'>('none');
  const [posterImageReviewing, setPosterImageReviewing] = useState(false);
  const { posterBriefIsVerified, posterGenerationIsVerified } = studioPosterEligibility({
    posterDraft, posterImageUrl, posterImageReviewStatus,
  });
  return {
    posterLoading, setPosterLoading, posterDraft, setPosterDraft,
    leadContentPackage, setLeadContentPackage, posterJsonText, setPosterJsonText,
    posterImageUrl, setPosterImageUrl, posterImageMaterialId, setPosterImageMaterialId,
    posterImageReviewStatus, setPosterImageReviewStatus, posterImageReviewing, setPosterImageReviewing,
    posterBriefIsVerified, posterGenerationIsVerified,
  };
}

/** Keeps generation, partial failures, manual invalidation and image review together. */
export function createStudioPosterActions(state: ReturnType<typeof useStudioPosterState>) {
  const {
    setPosterLoading, setPosterDraft, setLeadContentPackage, setPosterJsonText,
    setPosterImageUrl, setPosterImageMaterialId, setPosterImageReviewStatus,
    posterImageMaterialId, setPosterImageReviewing,
  } = state;
  const markPosterJsonAsManualDraft = (value: string, setModeNotice: (message: string) => void) => {
    setPosterJsonText(value);
    setPosterImageUrl('');
    setPosterImageMaterialId('');
    setPosterImageReviewStatus('none');
    setLeadContentPackage(null);
    setPosterDraft(current => ({
      ...(current || {
        caption: '', hashtags: [], commentCta: '', dmOpening: '', imagePrompt: '',
      }),
      ok: false,
      source: undefined,
      provenance: 'manual_draft',
      qualityStatus: 'unreviewed',
      publishable: false,
      fieldsToConfirm: [...new Set([...(current?.fieldsToConfirm || []), '手动修改后的图文内容'])],
    }));
    setModeNotice('图文 JSON 已手动修改，原图片已失效。当前内容仅为待复核草稿，需按企业中心资料重新生成并通过校验后才能提交。');
  };
  const confirmPosterImage = async (input: Pick<StudioPosterGenerationInput, 'onNotice' | 'refreshMaterials'>) => {
    const { onNotice: setModeNotice, refreshMaterials } = input;
    if (!posterImageMaterialId) {
      setModeNotice('当前图片缺少可追溯的素材记录，请重新生成后再确认。');
      return;
    }
    setPosterImageReviewing(true);
    try {
      const result = await studioApi.reviewGeneratedImage(posterImageMaterialId);
      if (!result.ok) throw new Error(result.error || '图片复核结果保存失败');
      setPosterImageReviewStatus('accepted');
      setModeNotice('图片人工复核已写入统一素材记录，可以作为当前成品继续交付。');
      await refreshMaterials();
    } catch (error) {
      setModeNotice(error instanceof Error ? error.message : '图片复核结果保存失败');
    } finally {
      setPosterImageReviewing(false);
    }
  };

  const generatePosterBrief = async (input: StudioPosterGenerationInput) => {
    const { product: { info: activeProductInfo, label: activeProductLabel },
      output: { imageDeliverable, platform, lang, ratio, posterStyle, provider },
      videoKickoff, materials, selectedClips, materialById, selectedProductIds,
      onSelect: setSelected, onCaption: setCaption, onNotice: setModeNotice, refreshMaterials } = input;
    const imageEvidence = videoKickoff?.video?.aiAnalysis?.imageEvidence;
    const isEvidenceLedPackage = Boolean(
      videoKickoff?.source === 'inspiration_image_post'
      && imageEvidence?.observedFacts?.length,
    );
    const isImageReferenceWithoutEvidence = Boolean(
      videoKickoff?.source === 'inspiration_image_post'
      && !imageEvidence?.observedFacts?.length,
    );
    if (isImageReferenceWithoutEvidence) {
      setModeNotice('当前记录只有标题或首图，没有完整轮播证据。请返回灵感中心重新分析后再生成，避免凭空总结爆点。');
      return;
    }
    if (!activeProductInfo.trim() || !activeProductLabel) {
      setModeNotice('生成商业图文前必须先选择企业中心已确认的产品资料；缺少资料时不会创建本地营销话术。');
      return;
    }
    const includeStyleReference = selectedClips.some(item => item.folder === 'hot' || item.usage === 'reference_only');
    const imagePlan = planImageProduction(materials, {
      deliverable: imageDeliverable,
      productIds: selectedProductIds,
      includeStyleReference,
      limit: 3,
    });
    if (imagePlan.blockers.length) {
      setModeNotice(`图片制作还不能开始：${imagePlan.blockers.join('；')}。请先在素材库完成产品绑定、编导分析和使用授权。`);
      return;
    }
    const plannedClips = imagePlan.selectedIds
      .map(id => materialById.get(id))
      .filter((item): item is Clip => Boolean(item));
    setSelected(current => [...new Set([...current.filter(id => materialById.get(id)?.type !== 'image'), ...imagePlan.selectedIds])]);
    setPosterLoading(true);
    setModeNotice(`内容 Agent 已选择“${imagePlan.strategyReason}”，正在制作${IMAGE_DELIVERABLE_LABELS[imageDeliverable]}…`);
    try {
      if (isEvidenceLedPackage) {
        const result = await studioApi.leadContentPackage({
          productInfo: activeProductInfo,
          platform,
          language: lang,
          ratio,
          referenceTitle: videoKickoff?.video?.title || '',
          referenceEvidence: imageEvidence,
        });
        if (!result.ok || result.source !== 'ai' || result.items.length < 3) throw new Error(result.error || '获客内容包生成失败');
        const first = result.items[0]!;
        const firstSlide = first.slides[0];
        const poster = {
          headline: firstSlide?.headline || first.title,
          subheadline: firstSlide?.body || first.objective,
          originBadge: '',
          trustBadges: [],
          sellingPoints: first.slides.slice(1, 4).map(slide => [slide.headline, slide.body].filter(Boolean).join('：')),
          process: [],
          categories: [],
          bottomBar: [],
          cta: first.cta,
        };
        const posterResult: FbPosterResult = {
          ok: true,
          source: 'ai',
          provenance: result.provenance || 'ai',
          qualityStatus: result.qualityStatus || 'needs_confirmation',
          publishable: result.publishable === true && result.qualityStatus === 'passed' && result.fieldsToConfirm.length === 0,
          poster,
          caption: first.caption,
          hashtags: first.hashtags,
          commentCta: first.cta,
          dmOpening: first.dmOpening,
          fieldsToConfirm: result.fieldsToConfirm,
          imagePrompt: first.imagePrompt,
          layoutModules: result.referenceModulesUsed.map(module => ({
            module: module.module,
            referencePattern: module.evidence,
            localAssetRole: '企业中心对应产品/工厂/证书/包装素材',
            replacementInstruction: module.application,
          })),
        };
        setLeadContentPackage(result);
        setPosterDraft(posterResult);
        setPosterJsonText(JSON.stringify(result, null, 2));
        const tags = first.hashtags.map(tag => `#${String(tag).replace(/^#/, '')}`).join(' ');
        setCaption([first.caption, tags].filter(Boolean).join(' '));
        setPosterImageUrl('');
        setPosterImageMaterialId('');
        setPosterImageReviewStatus('none');

        const ownReferenceIds = imagePlan.inputRoles
          .filter(item => item.role !== 'style')
          .map(item => item.materialId);
        if (ownReferenceIds.length > 0) {
          setModeNotice('三组内容方案已生成，正在用企业素材生成第 1 组首图预览…');
          try {
            const rendered = await studioApi.fbPosterRender({
              poster,
              caption: first.caption,
              imagePrompt: [
                first.imagePrompt,
                'Generate only the first cover slide of this carousel.',
                firstSlide ? `Cover role: ${firstSlide.role}; headline: ${firstSlide.headline}; body: ${firstSlide.body}; required enterprise asset role: ${firstSlide.assetRole}.` : '',
                'The supplied reference images are owned enterprise assets. Do not reproduce any competitor product, logo, packaging, contact details, or text.',
              ].filter(Boolean).join('\n'),
              ratio,
              materialIds: ownReferenceIds,
              productIds: selectedProductIds,
              deliverableType: imageDeliverable,
              productionStrategy: imagePlan.strategy,
              referencePlan: imagePlan.inputRoles,
            });
            if (!rendered.ok || !rendered.url) throw new Error(rendered.error || '首图生成失败');
            setPosterImageUrl(rendered.url);
            setPosterImageMaterialId(rendered.material?.id || '');
            setPosterImageReviewStatus('needs_review');
            if (rendered.material?.id) setSelected(prev => [...new Set([...prev, rendered.material!.id])]);
            await refreshMaterials();
            setModeNotice(result.fieldsToConfirm.length
              ? `已生成三组获客内容和第 1 组首图；还需确认图片和这些字段：${result.fieldsToConfirm.join('、')}`
              : '已生成三组连续获客内容和第 1 组首图，请核对产品外观与文字后确认图片。');
          } catch (imageErr: any) {
            setModeNotice(`三组获客内容已生成，但首图生成失败：${imageErr?.message || '请稍后重试'}`);
          }
        } else {
          setModeNotice(result.fieldsToConfirm.length
            ? `三组获客内容已生成。请先选择企业产品/工厂素材再生成图片；发布前还需确认：${result.fieldsToConfirm.join('、')}`
            : '三组获客内容已生成。为避免把竞品产品带入成图，请先选择企业中心产品/工厂素材，再生成图片。');
        }
        return;
      }
      setLeadContentPackage(null);
      const selectedMaterials = plannedClips.slice(0, 8).map(item => ({
        id: item.id,
        name: item.name,
        type: item.type,
        folder: item.folder,
        role: materialRoleLabel(item),
      }));
      const hotPosterRefs = plannedClips
        .filter(item => item.folder === 'hot')
        .map(item => [
          `爆款图文参考：${item.name}`,
          '需要模块化拆解：标题区、产品主视觉、背景氛围、工厂/证明区、徽章区、流程图、产品分类卡、CTA/底栏、配文框架。',
          '复用方式：只复用通用版式、构图、背景氛围和信息层级；用本地产品图替换竞品产品，用本地工厂图/证书图/包装图/场景图匹配对应模块。',
          '禁止复制：竞品品牌、Logo、认证、价格、MOQ、交期、出口国家、工厂资质和任何未验证商业承诺。',
        ].join('。'))
        .join('\n');
      const result = await studioApi.fbPoster({
        deliverableType: imageDeliverable,
        productionStrategy: imagePlan.strategy,
        productInfo: activeProductInfo,
        platform,
        ratio,
        posterStyle,
        language: lang,
        provider,
        materials: selectedMaterials,
        referenceNotes: [hotPosterRefs, videoKickoff ? cloneReferenceAnalysisText(videoKickoff) : ''].filter(Boolean).join('\n\n'),
      });
      if (!result.ok || result.source !== 'ai' || !result.poster?.headline) throw new Error(result.error || '海报文案生成失败');
      const generatedPoster = result.poster;
      setPosterDraft(result);
      setPosterJsonText(JSON.stringify(generatedPoster, null, 2));
      const tags = (result.hashtags || []).map(tag => `#${String(tag).replace(/^#/, '')}`).join(' ');
      setCaption([result.caption, tags].filter(Boolean).join(' '));
      setModeNotice('正在生成海报图...');
      try {
        const rendered = await studioApi.fbPosterRender({
          poster: generatedPoster,
          caption: result.caption,
          imagePrompt: result.imagePrompt,
          ratio,
          materialIds: imagePlan.selectedIds,
          productIds: selectedProductIds,
          deliverableType: imageDeliverable,
          productionStrategy: imagePlan.strategy,
          referencePlan: imagePlan.inputRoles,
        });
        if (!rendered.ok || !rendered.url) throw new Error(rendered.error || '图片生成失败');
        setPosterImageUrl(rendered.url);
        setPosterImageMaterialId(rendered.material?.id || '');
        setPosterImageReviewStatus('needs_review');
        if (rendered.material?.id) setSelected(prev => [...new Set([...prev, rendered.material!.id])]);
        await refreshMaterials();
        setModeNotice(result.fieldsToConfirm?.length
          ? `已生成图片和文案；还需确认图片和这些字段：${result.fieldsToConfirm.join('、')}`
          : `已按“${imagePlan.strategyReason}”生成图片和文案，请核对产品外观与文字后确认图片。`);
      } catch (imageErr: any) {
        setPosterImageUrl('');
        setPosterImageMaterialId('');
        setPosterImageReviewStatus('none');
        setModeNotice(result.fieldsToConfirm?.length
          ? `已生成海报文案 JSON，但图片生成失败：${imageErr?.message || '请检查图像模型 Key 或稍后重试'}；请确认：${result.fieldsToConfirm.join('、')}`
          : `已生成海报文案 JSON，但图片生成失败：${imageErr?.message || '请检查图像模型 Key 或稍后重试'}`);
      }
    } catch (err: any) {
      setModeNotice(err?.message || '海报文案生成失败，请稍后重试。');
    } finally {
      setPosterLoading(false);
    }
  };
  return { markPosterJsonAsManualDraft, confirmPosterImage, generatePosterBrief };
}

export function useStudioPosterWorkspace() {
  const state = useStudioPosterState();
  return { ...state, ...createStudioPosterActions(state) };
}
