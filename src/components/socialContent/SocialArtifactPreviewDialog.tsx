import { Button, Drawer } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, ExternalLink, FileText, Loader2 } from 'lucide-react';
import type { SocialContentArtifact } from '../../../shared/contracts/socialContentWorkflow';
import { socialContentApi } from '../../lib/socialContentApi';
import { socialArtifactGenerationDisclosure } from '../../lib/socialArtifactGeneration';
export { socialArtifactGenerationDisclosure } from '../../lib/socialArtifactGeneration';
import {
  PLATFORM_OPTIONS,
  artifactKindLabel,
  contentLanguageLabel,
  optionLabel,
  packageVersionLabel,
} from './socialContentUi';
import { SocialPlatformIcon } from '../SocialPlatformIcon';

const ARCHIVED_MEDIA_REF = /^socialfile:socialfile_[a-f0-9]{24}$/;
const CONTENT_FIELDS = ['body', 'caption', 'copy', 'text', 'summary', 'script'] as const;

function readableText(value: unknown, maximum: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function automatedQualityChecks(artifact: SocialContentArtifact): string[] {
  const content = artifact.content || {};
  if (content.workflowSchema !== 'social-content.auto-production.v3') return [];
  const render = record(content.render);
  const narration = record(content.narration);
  if (!render || render.qualityPassed !== true) return [];
  const checks = ['成片画面与时长检查通过'];
  if (Number(render.sourceClipSeconds || 0) > 0) checks.push('客户素材已用于剪辑');
  if (Number(render.checkedScenes || 0) > 0) checks.push(`逐镜检查通过（${Number(render.checkedScenes)} 个镜头）`);
  if (render.audioDecoded === true) checks.push('口播音轨可正常播放');
  if (Number(narration?.cueCount || 0) > 0) checks.push('字幕已按口播时间轴生成');
  return checks;
}

const EVALUATION_LABELS: Record<string, string> = {
  viralFactorFidelity: '爆款结构还原不足',
  identityReplacement: '产品或人物替换未验证',
  originalityDifference: '原创差异仍需复核',
  unauthorizedReuseRisk: '素材复用风险仍需复核',
  accountAndFactFit: '账号与事实适配未确认',
};

export function socialArtifactReleaseSummary(artifact: SocialContentArtifact): {
  tone: 'ready' | 'warning' | 'blocked';
  title: string;
  description: string;
  issues: string[];
} {
  const content = artifact.content || {};
  const delivery = record(content.delivery);
  const evaluation = record(content.replicationEvaluation);
  const productionResult = record(content.productionResult);
  const creativeReview = record(productionResult?.creativeReview);
  const deliveryStatus = readableText(delivery?.status, 40);
  const evaluationStatus = readableText(evaluation?.status, 40);
  const dimensions = Object.entries(EVALUATION_LABELS).flatMap(([key, label]) => {
    const result = record(evaluation?.[key]);
    return result && result.status !== 'passed' && result.status !== 'not_applicable' ? [label] : [];
  });
  const issues = [...new Set(dimensions)].slice(0, 3);
  if (deliveryStatus === 'concept_preview') {
    return {
      tone: 'warning',
      title: '概念样片 · 不可直接发布',
      description: '这版只用于确认方向；补充正式产品素材后再生成发布版。',
      issues: issues.length ? issues : ['正式产品素材不足'],
    };
  }
  if (deliveryStatus === 'requires_revision' || evaluationStatus === 'failed' || creativeReview?.approved === false) {
    return {
      tone: 'blocked',
      title: '不可发布 · 需要修改',
      description: '视频文件可以播放，但内容或权利检查没有放行。',
      issues: issues.length ? issues : ['内容验收未通过'],
    };
  }
  if (evaluationStatus === 'review_required') {
    return {
      tone: 'warning',
      title: '建议修改后再发布',
      description: '技术检查通过，但仍有内容项需要人工确认。',
      issues: issues.length ? issues : ['内容适配仍需复核'],
    };
  }
  return {
    tone: 'ready',
    title: '可以进入人工发布确认',
    description: '技术与内容检查已通过，请最后核对产品、字幕和品牌信息。',
    issues: [],
  };
}

function artifactCostSummary(artifact: SocialContentArtifact): string | null {
  const cost = record(artifact.content?.costSummary);
  if (!cost) return null;
  const estimate = Number(cost.estimatedBeforeGenerationCny);
  const actual = Number(cost.recordedProviderCostCny);
  if (!Number.isFinite(estimate) || !Number.isFinite(actual)) return null;
  return `预计 ¥${Math.max(0, estimate).toFixed(2)} · 本次已记录 ¥${Math.max(0, actual).toFixed(2)}`;
}

function artifactProductionWarnings(artifact: SocialContentArtifact): string[] {
  const render = record(artifact.content?.render);
  const warnings = Array.isArray(render?.degradation)
    ? render.degradation.map(item => readableText(item, 160)).filter(Boolean)
    : [];
  if (Number(render?.sourceClipSeconds || 0) <= 0 && Array.isArray(render?.materialSourceIds)) {
    warnings.unshift('本版没有使用客户视频片段；请确认画面不是系统示意内容。');
  }
  return [...new Set(warnings)].slice(0, 3);
}

const MATERIAL_REASON_LABELS: Record<string, string> = {
  association_only: '仅确认与当前产品关联，未确认具体画面语义',
  low_semantic_score: '画面和分镜意图的语义证据偏弱',
  small_score_margin: '首选与备选分数接近',
  low_analysis_confidence: '素材视觉分析置信度偏低',
  unsafe_video_boundary: '剪口缺少足够的低运动或镜头边界证据',
  source_marked_for_review: '素材分析本身要求人工复核',
};

export function socialArtifactMaterialReview(artifact: SocialContentArtifact) {
  const learning = record(artifact.content?.materialLearning);
  if (learning?.schemaVersion !== 'material-match-review.v1' || !Array.isArray(learning.scenes)) return [];
  return learning.scenes.flatMap(value => {
    const scene = record(value);
    if (!scene || scene.decision !== 'human_review_required') return [];
    const candidates = Array.isArray(scene.candidates) ? scene.candidates.map(record).filter(Boolean) : [];
    const selected = candidates.find(candidate => candidate?.clipId === scene.selectedClipId);
    return [{
      sceneId: readableText(scene.sceneId, 80) || '未知镜头',
      priority: scene.reviewPriority === 'high' ? 'high' as const : 'normal' as const,
      reasons: (Array.isArray(scene.reasonCodes) ? scene.reasonCodes : []).map(String)
        .map(reason => MATERIAL_REASON_LABELS[reason] || reason).slice(0, 6),
      sourceRange: selected && Number.isFinite(Number(selected.sourceStart)) && Number.isFinite(Number(selected.sourceEnd))
        ? `${Number(selected.sourceStart).toFixed(2)}–${Number(selected.sourceEnd).toFixed(2)}s` : '',
    }];
  });
}

export function socialArtifactReadableCopy(artifact: SocialContentArtifact): { title: string; body: string } {
  const content = artifact.content;
  const title = readableText(content?.title, 300)
    || readableText(content?.headline, 300)
    || artifactKindLabel(artifact.kind);
  const body = CONTENT_FIELDS.map(field => readableText(content?.[field], 12_000)).find(Boolean) || '';
  return { title, body };
}

export function socialArtifactHasArchivedMedia(artifact: SocialContentArtifact): boolean {
  return ARCHIVED_MEDIA_REF.test(artifact.resourceRef || '');
}

export default function SocialArtifactPreviewDialog({ artifact, onClose }: {
  artifact: SocialContentArtifact;
  onClose: () => void;
}) {
  const [media, setMedia] = useState<{ url: string; filename: string; type: string } | null>(null);
  const [loading, setLoading] = useState(socialArtifactHasArchivedMedia(artifact));
  const [error, setError] = useState('');
  const copy = useMemo(() => socialArtifactReadableCopy(artifact), [artifact]);
  const generation = useMemo(() => socialArtifactGenerationDisclosure(artifact), [artifact]);
  const qualityChecks = useMemo(() => automatedQualityChecks(artifact), [artifact]);
  const materialReviews = useMemo(() => socialArtifactMaterialReview(artifact), [artifact]);
  const release = useMemo(() => socialArtifactReleaseSummary(artifact), [artifact]);
  const costSummary = useMemo(() => artifactCostSummary(artifact), [artifact]);
  const productionWarnings = useMemo(() => artifactProductionWarnings(artifact), [artifact]);

  useEffect(() => {
    if (!socialArtifactHasArchivedMedia(artifact)) return;
    const controller = new AbortController();
    let objectUrl = '';
    void socialContentApi.fetchArtifactMedia(artifact.taskId, artifact.artifactId, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(result.blob);
        setMedia({ url: objectUrl, filename: result.filename, type: result.blob.type });
      })
      .catch(loadError => {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : '成品暂时无法预览');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [artifact]);

  const details = [
    contentLanguageLabel(artifact.language),
    packageVersionLabel(artifact.version),
    generation.sourceLabel,
    generation.verificationLabel,
  ].filter(Boolean).join(' · ');
  const isVideo = media?.type.startsWith('video/');

  return (
    <Drawer open onClose={onClose} title={copy.title} size={800}
      styles={{ body: { padding: 20 } }}
      footer={<div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose}>关闭</Button>
        {media && <><Button href={media.url} target="_blank" rel="noreferrer" icon={<ExternalLink size={14} />}>单独打开</Button><Button type="primary" href={media.url} download={media.filename} icon={<Download size={14} />}>下载成品</Button></>}
      </div>}>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
        {artifact.platform && <SocialPlatformIcon platform={artifact.platform} size={15}/>}
        <span>{artifactKindLabel(artifact.kind)}</span>
        {artifact.platform && <span>{optionLabel(PLATFORM_OPTIONS, artifact.platform)}</span>}
        <span>{details}</span>
      </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-[#f8faf9] p-5">
          <section className={`mb-4 rounded-lg border p-4 ${release.tone === 'ready' ? 'border-emerald-200 bg-emerald-50' : release.tone === 'blocked' ? 'border-rose-200 bg-rose-50' : 'border-amber-200 bg-amber-50'}`} aria-label="成片发布结论">
            <div className="flex items-start gap-2.5">{release.tone === 'ready' ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-700" /> : <AlertTriangle size={18} className={`mt-0.5 shrink-0 ${release.tone === 'blocked' ? 'text-rose-700' : 'text-amber-700'}`} />}<div><p className="text-sm font-semibold text-text-primary">{release.title}</p><p className="mt-1 text-[11px] leading-5 text-text-secondary">{release.description}</p>{release.issues.length > 0 && <p className="mt-1.5 text-[10px] font-bold text-text-secondary">先处理：{release.issues.join('；')}</p>}{costSummary && <p className="mt-1.5 text-[10px] font-semibold text-text-primary">费用：{costSummary}</p>}</div></div>
          </section>
          {loading && <div role="status" className="flex min-h-64 items-center justify-center gap-2 rounded-lg border border-border bg-white text-sm font-semibold text-text-muted"><Loader2 size={18} className="animate-spin text-emerald-600" />正在打开成品</div>}
          {!loading && media && (isVideo
            ? <video controls preload="metadata" src={media.url} className="mx-auto max-h-[68vh] w-full rounded-lg bg-black shadow-none">您的浏览器暂不支持视频预览。</video>
            : <img src={media.url} alt={copy.title} className="mx-auto max-h-[68vh] max-w-full rounded-lg bg-white object-contain shadow-none" />)}
          {!loading && materialReviews.length > 0 && <section className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4" aria-label="需要重点复核的素材镜头"><div className="flex items-center gap-2 text-xs font-semibold text-amber-950"><AlertTriangle size={15} />请重点核对 {materialReviews.length} 个素材镜头</div><ul className="mt-3 grid gap-2">{materialReviews.map(item => <li key={item.sceneId} className="rounded-lg border border-amber-100 bg-white/80 px-3 py-2 text-[11px] leading-5 text-amber-950"><span className="font-semibold">{item.sceneId}{item.sourceRange ? ` · 原片 ${item.sourceRange}` : ''}</span><span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 font-bold">{item.priority === 'high' ? '高优先级' : '建议复核'}</span><p>{item.reasons.join('；')}</p></li>)}</ul></section>}
          {!loading && productionWarnings.length > 0 && <section className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4" aria-label="生成方式提醒"><div className="flex items-center gap-2 text-xs font-semibold text-amber-950"><AlertTriangle size={15} />生成方式提醒</div><ul className="mt-2 space-y-1 text-[11px] leading-5 text-amber-900">{productionWarnings.map(item => <li key={item}>• {item}</li>)}</ul></section>}
          {!loading && qualityChecks.length > 0 && <details className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50/75 p-4" aria-label="成片技术质检结果"><summary className="cursor-pointer text-xs font-semibold text-emerald-900"><span className="inline-flex items-center gap-2"><CheckCircle2 size={15} />技术质检已通过</span></summary><ul className="mt-3 grid gap-2 sm:grid-cols-2">{qualityChecks.map(item => <li key={item} className="flex items-start gap-2 text-[11px] font-semibold leading-5 text-emerald-900"><CheckCircle2 size={13} className="mt-1 shrink-0 text-emerald-700" />{item}</li>)}</ul></details>}
          {!loading && !media && copy.body && <article className="rounded-lg border border-border bg-white p-5"><div className="flex items-center gap-2 text-xs font-bold text-text-muted"><FileText size={14} />内容预览</div><p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-text-primary">{copy.body}</p></article>}
          {!loading && !media && !copy.body && !error && <div className="flex min-h-48 items-center justify-center rounded-lg border border-border bg-white px-6 text-center text-sm font-semibold text-text-muted">此成品暂无可预览内容</div>}
          {error && <p role="alert" className="rounded-lg border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</p>}
        </div>
    </Drawer>
  );
}
