import { getScrollBehavior } from "../../lib/usePrefersReducedMotion";
import { StoryboardFirstFrame } from '../studio/StoryboardFirstFrame';
export { StoryboardFirstFrame } from '../studio/StoryboardFirstFrame';
import ReplicationWorkbenchHeader from './ReplicationWorkbenchHeader';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Modal } from 'antd';
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Film,
  FolderOpen,
  GripVertical,
  Loader2,
  Megaphone,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import type { SocialContentCreationPath } from '../../lib/socialContentModel';
import { studioApi, type Material, type StudioScriptResult } from '../../lib/studioApi';
import { socialContentApi } from '../../lib/socialContentApi';
import type { SocialContentStageProfile } from '../../lib/socialContentStage';
import { resolveInspirationPlaybackUrl } from '../../lib/inspirationVideoPlayback';
import { authHeader } from '../../lib/auth';
import { referenceBrandTerm, referenceProductMentions, referenceProductTerms, replaceReferenceIdentities, spokenIdentityLabel } from '../../lib/referenceIdentityMapping';
import { referenceSpeechLines, type ReferenceSpeechLine } from './referenceSpeechLines';
import { groupSpeechShots, type SpeechGroup, timeRange } from './speechShotGroups';
import { normalizeFreeCreationState, type FreeCreationState, type FreeCreationShotType } from '../../../shared/contracts/freeCreationProject';

interface EnterpriseProductOption {
  id: string;
  name: string;
}

export function resolveReplicationProductMappings(
  slots: Array<{ shotId: string; sourceLabel: string }>,
  products: EnterpriseProductOption[],
  primaryProductId: string,
  assignments: Record<string, string>,
) {
  return slots.map(slot => {
    const selectedId = Object.prototype.hasOwnProperty.call(assignments, slot.shotId)
      ? assignments[slot.shotId] : primaryProductId;
    const product = products.find(item => item.id === selectedId);
    return { sourceTerm: slot.sourceLabel, productId: product?.id || '', productName: product?.name || '' };
  });
}

export function assignReplicationDefaultProduct(
  slots: Array<{ shotId: string }>,
  productId: string,
): Record<string, string> {
  return Object.fromEntries(slots.map(slot => [slot.shotId, productId]));
}

export interface FreeCreationLine {
  id: string;
  time: string;
  speech: string;
  visual: string;
  shotType: '真人口播' | '工厂' | '产品' | 'D to C';
  silent: boolean;
  hook: boolean;
}

export function parseFreeCreationScript(script: string): FreeCreationLine[] {
  const normalized = String(script || '').replace(/\r/g, '').trim();
  if (!normalized) return [];
  const timestampLine = /^\s*\[?(?:\d+:)?\d+(?:\.\d+)?\s*[–—-]\s*(?:\d+:)?\d+(?:\.\d+)?s?\]?/;
  const grouped: string[] = [];
  for (const line of normalized.split('\n')) {
    if (timestampLine.test(line) && grouped.length && grouped[grouped.length - 1]!.trim()) grouped.push(line);
    else if (!grouped.length) grouped.push(line);
    else grouped[grouped.length - 1] += `\n${line}`;
  }
  const blocks = grouped.length > 1 ? grouped.map(item => item.trim()).filter(Boolean) : normalized.split(/\n\s*\n/).map(item => item.trim()).filter(Boolean);
  return blocks.map((block, index) => {
    const time = block.match(/\[?((?:\d+:)?\d+(?:\.\d+)?\s*[–—-]\s*(?:\d+:)?\d+(?:\.\d+)?s?)\]?/)?.[1] || `${index * 4}–${(index + 1) * 4}s`;
    const speechMatch = block.match(/(?:台词|口播|旁白|Dialogue|Voiceover)\s*[：:]\s*([^\n]+)/i);
    const visualMatch = block.match(/(?:画面|镜头|Visual)\s*[：:]\s*([^\n]+)/i);
    const speech = (speechMatch?.[1] || (!visualMatch ? block.replace(/^\[?[^\]\n]+\]?\s*/, '').trim() : '')).trim();
    const visual = (visualMatch?.[1] || '根据口播生成对应画面').trim();
    // Classify visible content only. Field names such as “口播” and the value
    // “无口播” must not turn every generated line into a talking-head shot.
    const explicitShotType = block.match(/镜头类型\s*[：:]\s*([^\n]+)/)?.[1] || '';
    const hinted = `${explicitShotType} ${visual}`;
    const shotType: FreeCreationLine['shotType'] = /工厂|车间|生产线|实验室/.test(hinted) ? '工厂'
      : /真人|口播|主播|人物对镜/.test(hinted) ? '真人口播'
        : /消费者|顾客|用户|模特|达人|使用场景|使用效果|效果展示|效果演示|使用前后|涂抹|上脸|试用|开箱|种草|D\s*(?:to|2)\s*C/i.test(hinted) ? 'D to C' : '产品';
    return { id: `free-line-${Date.now()}-${index}`, time, speech, visual, shotType, silent: !speech || /无口播|纯画面/.test(block), hook: index === 0 };
  });
}

export function serializeFreeCreationLines(lines: FreeCreationLine[]): string {
  return lines.map(line => `[${line.time}]\n画面：${line.visual.trim() || '待补充画面'}\n镜头类型：${line.shotType}\n台词：${line.silent ? '（无口播）' : line.speech.trim()}`).join('\n\n');
}

export interface SocialCreationWorkbenchSeed {
  continueTaskId?: string;
  referenceTitle?: string;
  referenceThumbnail?: string;
  referenceMediaUrl?: string;
  referenceContentType?: 'video' | 'image';
  referenceShots?: Array<{ time: string; dialogue?: string; subtitle?: string; visual?: string; firstFrameRef?: string; firstFrameSeconds?: number; startSeconds?: number; endSeconds?: number }>;
  referenceLinks?: string[];
  productId?: string;
  productName?: string;
  selectedProductIds?: string[];
  selectedProductNames?: string[];
  productMappings?: Array<{ sourceTerm: string; productId: string; productName: string }>;
  confirmedSpeech?: Array<{ source: string; draft: string; time: string }>;
}

export interface SocialCreationWorkbenchSubmit {
  replicationStep?: 1 | 2 | 3;
  confirmedSpeech?: Array<{ source: string; draft: string; time: string }>;
  initialScript?: string;
  initialGeneration?: StudioScriptResult;
  draftProjectId?: string;
  requestId: number;
  creationPath: SocialContentCreationPath;
  title: string;
  productId: string;
  productName: string;
  productMappings: Array<{ sourceTerm: string; productId: string; productName: string }>;
  brandMapping?: { sourceTerm: string; brandName: string };
  presenterAssetId: string;
  files: File[];
  uploadedMaterials: Material[];
  referenceLinks: string[];
  callToAction: string;
  specialRequirements: string;
  stageProfileId: SocialContentStageProfile['id'];
  stageLabel: string;
  strategyPresetId: SocialContentStageProfile['presetId'];
}

function shotStart(time: string): number {
  const start = String(time || '').split(/[–—-]/)[0];
  const clock = start.match(/(\d+):(\d+(?:\.\d+)?)/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const match = start.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

export function WorkbenchVideoPreview({ source, poster, title, seekSeconds, seekRequestId, onResolved, onPlaybackTime }: { source: string; poster?: string; title: string; seekSeconds?: number; seekRequestId?: number; onResolved?: (url: string) => void; onPlaybackTime?: (seconds: number) => void }) {
  const [attempt, setAttempt] = useState(0);
  const [playbackUrl, setPlaybackUrl] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const playbackCallback = useRef(onPlaybackTime);
  playbackCallback.current = onPlaybackTime;
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const video = videoRef.current;
      if (video && !video.paused) playbackCallback.current?.(video.currentTime);
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [playbackUrl]);


  useEffect(() => {
    if (videoRef.current && Number.isFinite(seekSeconds)) {
      try { videoRef.current.currentTime = Math.max(0, seekSeconds || 0); } catch { /* metadata pending */ }
    }
  }, [seekSeconds, seekRequestId, playbackUrl]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15_000);
    setPlaybackUrl('');
    setStatus('loading');
    setMessage('');
    void resolveInspirationPlaybackUrl(source, { signal: controller.signal, headers: authHeader() })
      .then(url => {
        if (controller.signal.aborted) return;
        setPlaybackUrl(url);
        onResolved?.(url);
      })
      .catch(error => {
        if (controller.signal.aborted) {
          setMessage('视频地址获取超时，请重试');
        } else {
          setMessage(error instanceof Error ? error.message : '视频地址获取失败');
        }
        setStatus('error');
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [attempt, source]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative h-full w-full overflow-hidden bg-zinc-100">
      {poster && status !== 'ready' && <img src={poster} alt={`${title}封面`} className="absolute inset-0 h-full w-full object-contain" />}
      {playbackUrl && <video
        ref={videoRef}
        src={playbackUrl}
        poster={poster}
        controls
        playsInline
        preload="metadata"
        onTimeUpdate={event => onPlaybackTime?.(event.currentTarget.currentTime)}
        onSeeking={event => onPlaybackTime?.(event.currentTarget.currentTime)}
        onSeeked={event => onPlaybackTime?.(event.currentTarget.currentTime)}
        onLoadedMetadata={event => { if (seekSeconds) event.currentTarget.currentTime = seekSeconds; }}
        aria-label={title}
        className={`h-full w-full object-contain transition-opacity ${status === 'ready' ? 'opacity-100' : 'opacity-0'}`}
        onLoadedData={() => setStatus('ready')}
        onCanPlay={() => setStatus('ready')}
        onError={() => {
          setMessage('视频文件加载或解码失败，请重新获取播放地址');
          setStatus('error');
        }}
      />}
      {status === 'loading' && <div className="absolute inset-0 flex items-center justify-center bg-white/35 -[1px]"><span className="inline-flex items-center gap-2 rounded-full bg-white/90 px-3 py-2 text-xs font-bold text-[#38594d] shadow-none"><Loader2 size={14} className="animate-spin" />正在加载视频</span></div>}
      {status === 'error' && <div className="absolute inset-0 flex items-center justify-center bg-white/88 p-6 text-center "><div><CircleAlert size={24} className="mx-auto text-amber-700" /><p className="mt-2 text-sm font-semibold text-text-primary">视频暂时无法预览</p><p className="mt-1 max-w-sm text-[11px] leading-5 text-text-muted">{message}</p><button type="button" onClick={() => setAttempt(value => value + 1)} className="mt-3 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white">重新加载</button></div></div>}
    </div>
  );
}

export default function SocialCreationWorkbench({
  mode,
  seed,
  stageProfile,
  onOpenChooser,
  onShowCreations,
  onGenerate,
}: {
  mode: SocialContentCreationPath;
  seed?: SocialCreationWorkbenchSeed;
  stageProfile?: SocialContentStageProfile;
  onOpenChooser: () => void;
  onShowCreations: () => void;
  onGenerate: (request: SocialCreationWorkbenchSubmit) => void;
}) {
  const [products, setProducts] = useState<EnterpriseProductOption[]>([]);
  const [productId, setProductId] = useState('');
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [productAssignments, setProductAssignments] = useState<Record<string, string>>({});
  const [productSelectionChanged, setProductSelectionChanged] = useState(false);
  const [productSelectorOpen, setProductSelectorOpen] = useState(false);
  const [manualProductTerms, setManualProductTerms] = useState<string[]>([]);
  const [newProductTerm, setNewProductTerm] = useState('');
  const [brandSourceTerm, setBrandSourceTerm] = useState('');
  const [enterpriseBrandName, setEnterpriseBrandName] = useState('');
  const [enterpriseCtas, setEnterpriseCtas] = useState<string[]>([]);
  const [enterpriseProfileState, setEnterpriseProfileState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsUnavailable, setProductsUnavailable] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [generatingSpeech, setGeneratingSpeech] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [freeScriptText, setFreeScriptText] = useState('');
  const [freeGeneration, setFreeGeneration] = useState<StudioScriptResult | null>(null);
  const [freeHookMaterial, setFreeHookMaterial] = useState<Material | null>(null);
  const [aiHookCandidate, setAiHookCandidate] = useState<Material | null>(null);
  const [aiHookFrame, setAiHookFrame] = useState<Material | null>(null);
  const [aiHookPhase, setAiHookPhase] = useState<'idle' | 'saving' | 'frame' | 'video' | 'ready' | 'failed'>('idle');
  const [aiHookError, setAiHookError] = useState('');
  const [aiHookEstimatedCost, setAiHookEstimatedCost] = useState(0);
  const aiHookRequestRef = useRef<{ frame: string; video: string } | null>(null);
  const [freeLines, setFreeLines] = useState<FreeCreationLine[]>([]);
  const [hookMode, setHookMode] = useState<'none' | 'upload' | 'library' | 'ai'>('none');
  const [hookChooserOpen, setHookChooserOpen] = useState(mode !== 'viral_replication');
  const [libraryHooks, setLibraryHooks] = useState<Material[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [draftProjectId, setDraftProjectId] = useState('');
  const draftSaveTimer = useRef<number>(0);
  const draftCreationRef = useRef<Promise<string> | null>(null);
  const draggedFreeLineIndex = useRef<number | null>(null);
  const [contentGoal, setContentGoal] = useState('种草');
  const [targetAudience, setTargetAudience] = useState('海外目标客户');
  const [platform, setPlatform] = useState('TikTok');
  const [contentLanguage, setContentLanguage] = useState('zh');
  const [sellingPoints, setSellingPoints] = useState('');
  const [desiredDuration, setDesiredDuration] = useState(20);
  const [tone, setTone] = useState('专业、自然');
  const [callToAction, setCallToAction] = useState('');
  const [prohibitedClaims, setProhibitedClaims] = useState('');
  const [briefNotes, setBriefNotes] = useState('');
  const [activeLine, setActiveLine] = useState(0);
  const [expandedSpeechLines, setExpandedSpeechLines] = useState<Set<number>>(() => new Set());
  const [requestedSeek, setRequestedSeek] = useState(0);
  const [seekRequestId, setSeekRequestId] = useState(0);
  const cardsRef = useRef<Array<HTMLLIElement | null>>([]);
  const cardListRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const card = cardsRef.current[activeLine];
    const panel = cardListRef.current?.parentElement;
    if (!card || !panel) return;
    const cardBox = card.getBoundingClientRect();
    const panelBox = panel.getBoundingClientRect();
    // Scroll only the storyboard panel; preserve the video and page position.
    if (cardBox.top < panelBox.top + 85 || cardBox.bottom > panelBox.bottom) {
      panel.scrollTo({ top: panel.scrollTop + cardBox.top - panelBox.top - 90, behavior: getScrollBehavior() });
    }
  }, [activeLine]);
  const [resolvedReferenceUrl, setResolvedReferenceUrl] = useState('');
  const [taskProductTerms, setTaskProductTerms] = useState<string[] | undefined>();
  const [taskReferenceShots, setTaskReferenceShots] = useState<SocialCreationWorkbenchSeed['referenceShots']>(undefined);
  const [taskSpeechLines, setTaskSpeechLines] = useState<SpeechGroup[]>([]);
  const [generationNotice, setGenerationNotice] = useState('');
  const [speechEdits, setSpeechEdits] = useState<Record<number, string>>({});
  const [generatedSpeech, setGeneratedSpeech] = useState<string[] | null>(null);
  const [generatedMappingKey, setGeneratedMappingKey] = useState<string | null>(null);
  const restoredSpeechRef = useRef<string>('');
  const [spokenNames, setSpokenNames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!seed?.confirmedSpeech?.length) return;
    setSpeechEdits(Object.fromEntries(seed.confirmedSpeech.map((line, index) => [index, line.draft])));
  }, [seed?.confirmedSpeech]);
  const uploadRef = useRef<HTMLInputElement>(null);
  const isReplication = mode === 'viral_replication';
  useEffect(() => {
    if (!isReplication) setHookChooserOpen(true);
  }, [isReplication]);
  const selectedFreeProducts = useMemo(() => products.filter(item => selectedProductIds.includes(item.id)), [products, selectedProductIds]);
  const freeDraftCreatedAt = useRef(new Date().toISOString());
  const freeCreationState = useMemo<FreeCreationState>(() => ({
    schemaVersion: 1,
    manualWorkflow: true,
    currentStep: 1,
    hookSource: hookMode,
    hookMaterialId: freeHookMaterial?.id || '',
    brief: {
      productIds: selectedProductIds,
      goal: contentGoal,
      audience: targetAudience,
      platform,
      language: contentLanguage,
      sellingPoints,
      durationSeconds: desiredDuration,
      tone,
      cta: callToAction,
      prohibitedClaims,
      notes: briefNotes,
    },
    script: {
      version: 1,
      status: freeLines.length ? 'draft' : 'draft',
      createdAt: freeDraftCreatedAt.current,
      invalidatedReasons: [],
      lines: freeLines.map((line, index) => {
        const range = timeRange(line.time);
        const shotType: FreeCreationShotType = line.shotType === '真人口播' ? 'presenter' : line.shotType === '工厂' ? 'factory' : line.shotType === 'D to C' ? 'consumer_demo' : 'product';
        return { id: line.id, start: range?.start ?? index * 4, end: range?.end ?? (index + 1) * 4, narration: line.speech, silent: line.silent, visualIntent: line.visual, shotType, factReferences: selectedFreeProducts.map(item => `enterprise-product:${item.id}`), primaryHook: line.hook };
      }),
    },
  }), [briefNotes, callToAction, contentGoal, contentLanguage, desiredDuration, freeHookMaterial?.id, freeLines, hookMode, platform, prohibitedClaims, selectedFreeProducts, selectedProductIds, sellingPoints, targetAudience, tone]);

  useEffect(() => {
    if (isReplication || draftCreationRef.current) return;
    draftCreationRef.current = (async () => {
      const storedId = (() => { try { return localStorage.getItem('lingshu:free-creation-draft-id') || ''; } catch { return ''; } })();
      if (storedId) {
        const existing = (await studioApi.listProjects()).find(item => item.id === storedId && item.status === 'draft' && item.spec?.freeCreation);
        if (existing) {
          const restored = normalizeFreeCreationState(existing.spec.freeCreation);
          setSelectedProductIds(restored.brief.productIds); setContentGoal(restored.brief.goal || '种草'); setTargetAudience(restored.brief.audience || '海外目标客户');
          setPlatform(restored.brief.platform || 'TikTok'); setContentLanguage(restored.brief.language || 'zh'); setSellingPoints(restored.brief.sellingPoints);
          setDesiredDuration(restored.brief.durationSeconds); setTone(restored.brief.tone || '专业、自然'); setCallToAction(restored.brief.cta);
          setProhibitedClaims(restored.brief.prohibitedClaims); setBriefNotes(restored.brief.notes); setHookMode(restored.hookSource);
          const restoredLines: FreeCreationLine[] = restored.script.lines.map(line => ({ id: line.id, time: `${line.start}–${line.end}s`, speech: line.narration, visual: line.visualIntent, shotType: line.shotType === 'presenter' ? '真人口播' : line.shotType === 'factory' ? '工厂' : line.shotType === 'consumer_demo' ? 'D to C' : '产品', silent: line.silent, hook: line.primaryHook }));
          setFreeLines(restoredLines); setFreeScriptText(String(existing.spec.script || serializeFreeCreationLines(restoredLines)));
          const kickoff = existing.spec.videoKickoff as { initialGeneration?: StudioScriptResult; generatedVideo?: { material?: Material } } | undefined;
          setFreeGeneration(kickoff?.initialGeneration || null);
          setFreeHookMaterial(kickoff?.generatedVideo?.material || null);
          setDraftProjectId(existing.id);
          return existing.id;
        }
      }
      const result = await studioApi.saveProject({
        title: '自由创作 · 未命名草稿', status: 'draft',
        spec: { creationPath: 'free_creation', mode: 'material', contentMode: 'video', manualWorkflow: true, freeCreation: freeCreationState },
      });
      const id = result.ok ? result.project?.id || '' : '';
      if (id) { setDraftProjectId(id); try { localStorage.setItem('lingshu:free-creation-draft-id', id); } catch { /* navigation hint only */ } }
      return id;
    })().catch(() => '');
  }, [isReplication]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isReplication) return;
    window.clearTimeout(draftSaveTimer.current);
    draftSaveTimer.current = window.setTimeout(() => {
      void (async () => {
        const id = draftProjectId || await draftCreationRef.current || '';
        if (!id) return;
        const title = selectedFreeProducts.length ? `${selectedFreeProducts.map(item => item.name).join('、')} · 自由创作` : '自由创作 · 未命名草稿';
        const productName = selectedFreeProducts.map(item => item.name).join('、');
        await studioApi.saveProject({ id, title, status: 'draft', spec: {
          creationPath: 'free_creation', mode: 'material', contentMode: 'video', manualWorkflow: true,
          freeCreation: freeCreationState, script: freeScriptText, duration: desiredDuration,
          selectedProductIds, productId: selectedFreeProducts[0]?.id || '', productInfo: productName,
          videoKickoff: {
            source: hookMode === 'ai' ? 'ai_generated_hook' : 'material_library', productInfo: productName, script: freeScriptText,
            initialGeneration: freeGeneration || undefined,
            generatedVideo: freeHookMaterial ? {
              id: freeHookMaterial.id, title: freeHookMaterial.name, url: freeHookMaterial.url,
              poster: freeHookMaterial.poster, duration: freeHookMaterial.duration, material: freeHookMaterial,
            } : undefined,
            materialRole: freeHookMaterial ? 'hook' : undefined,
          },
        } });
      })();
    }, 600);
    return () => window.clearTimeout(draftSaveTimer.current);
  }, [desiredDuration, draftProjectId, freeCreationState, freeGeneration, freeHookMaterial, freeScriptText, isReplication, selectedFreeProducts, selectedProductIds]);
  const referenceShots = isReplication ? taskReferenceShots || seed?.referenceShots || [] : [];
  const referenceLines: ReferenceSpeechLine[] = taskSpeechLines.length
    ? groupSpeechShots(taskSpeechLines, referenceShots).map(group => {
      const range = timeRange(group.time);
      return {
        time: group.time, text: group.source, dialogue: group.source,
        startSeconds: range?.start, endSeconds: range?.end,
        firstFrameRef: group.shots[0]?.firstFrameRef,
        firstFrameSeconds: group.shots[0]?.firstFrameSeconds,
        visual: group.shots[0]?.visual,
        visuals: group.shots.map(shot => shot.visual || '').filter(Boolean),
        visualShotCount: group.shots.length,
        shots: group.shots.map(shot => ({ ...shot, startSeconds: shot.start, endSeconds: shot.end })),
      };
    })
    : referenceSpeechLines(referenceShots);
  useEffect(() => {
    const detected = referenceBrandTerm(referenceLines.map(line => line.text));
    if (detected) setBrandSourceTerm(current => current || detected);
  }, [taskReferenceShots, seed?.referenceShots]); // eslint-disable-line react-hooks/exhaustive-deps
  const script = isReplication ? referenceLines.map(line => line.text) : [];
  const detectedProductSlots = referenceProductTerms(referenceLines.map(line => ({ text: line.text, time: line.time, visual: line.visual })), taskProductTerms);
  const productSlots = [...detectedProductSlots, ...manualProductTerms.filter(term => !detectedProductSlots.some(slot => slot.sourceLabel.toLocaleLowerCase() === term.toLocaleLowerCase()))
    .map((term, index) => ({ shotId: `manual-product-${index}`, sourceLabel: term, time: '', visual: '' }))];
  const productMentions = referenceProductMentions(referenceLines, productSlots.map(slot => slot.sourceLabel));
  useEffect(() => {
    if (productSelectionChanged || !seed?.productMappings?.length || !products.length) return;
    setProductAssignments(current => {
      const next = { ...current };
      for (const slot of productSlots) {
        if (Object.prototype.hasOwnProperty.call(next, slot.shotId)) continue;
        const mapping = seed.productMappings!.find(item => (item.sourceTerm.toLocaleLowerCase() === slot.sourceLabel.toLocaleLowerCase() || slot.sourceLabel.toLocaleLowerCase().endsWith(item.sourceTerm.toLocaleLowerCase())));
        const product = products.find(item => item.id === mapping?.productId || item.name === mapping?.productName);
        if (product) next[slot.shotId] = product.id;
      }
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
  }, [seed?.productMappings, products, productSelectionChanged, JSON.stringify(productSlots)]);
  useEffect(() => {
    if (!seed?.productMappings?.length || !products.length) return;
    const mapped = seed.productMappings.map(mapping => products.find(item => item.id === mapping.productId || item.name === mapping.productName)?.id).filter((id): id is string => Boolean(id));
    setSelectedProductIds(current => [...new Set([...current, ...mapped])]);
  }, [seed?.productMappings, products]);
  const primaryProductId = productId || selectedProductIds[0] || '';
  const primaryProduct = products.find(item => item.id === primaryProductId);
  const productMappings = resolveReplicationProductMappings(productSlots, products, primaryProductId, productAssignments);
  const productsReady = productMappings.every(mapping => mapping.productId && mapping.sourceTerm.trim());
  const productSelectionLoading = productsLoading && (!isReplication || productSlots.length > 0);
  const chooseDefaultProduct = (id: string) => {
    setProductSelectionChanged(true);
    setProductAssignments(assignReplicationDefaultProduct(productSlots, id));
    setProductId(id);
    setProductSelectorOpen(false);
  };
  const spokenLabel = (sourceTerm: string, catalogName: string, line: string, names = spokenNames) =>
    names[catalogName] || spokenIdentityLabel(sourceTerm, catalogName, line);
  const mappingKey = JSON.stringify({ products: productMappings, brandSourceTerm, enterpriseBrandName, lines: referenceLines.map(line => line.text) });
  useEffect(() => {
    const saved = seed?.confirmedSpeech;
    if (!isReplication || productSelectionChanged || !saved?.length || enterpriseProfileState === 'loading' || !productsReady || !referenceLines.length) return;
    const restoreKey = JSON.stringify([saved, mappingKey]);
    if (restoredSpeechRef.current === restoreKey) return;
    if (saved.length !== referenceLines.length || saved.some((line, index) => line.source.trim() !== referenceLines[index]?.text.trim())) return;
    restoredSpeechRef.current = restoreKey;
    setGeneratedSpeech(saved.map(line => line.draft));
    setGeneratedMappingKey(mappingKey);
  }, [isReplication, productSelectionChanged, seed?.confirmedSpeech, enterpriseProfileState, productsReady, mappingKey, referenceLines]);
  const speechGenerated = productsReady && generatedSpeech !== null && generatedMappingKey === mappingKey;
  const confirmedSpeech = referenceLines.map((line, index) => ({ source: line.text, time: line.time, draft: speechEdits[index] ?? generatedSpeech?.[index] ?? '' })).filter(line => line.source.trim());
  const generateSpeech = async () => {
    if (!productsReady || !referenceLines.some(line => line.text.trim())) return;
    setGeneratingSpeech(true);
    setGenerationNotice('');
    try {
      const englishSpeech = referenceLines.some(line => /[A-Za-z]/.test(line.text))
        && !referenceLines.some(line => /[\p{Script=Han}]/u.test(line.text));
      const namesToTranslate = englishSpeech ? [...new Set([...productMappings.map(mapping => mapping.productName), enterpriseBrandName]
        .filter(name => /[\p{Script=Han}]/u.test(name)))] : [];
      const result = namesToTranslate.length ? await studioApi.speechNames({ language: 'en', names: namesToTranslate }) : { ok: true, names: {} };
      if (!result.ok || namesToTranslate.some(name => !result.names[name] || /[\p{Script=Han}]/u.test(result.names[name]))) {
        throw new Error('产品英文口播名生成失败，请重试。');
      }
      const names = result.names;
      const drafts = referenceLines.map(line => replaceReferenceIdentities(line.text,
        productMappings.map(mapping => ({ sourceTerm: mapping.sourceTerm, productLabel: spokenLabel(mapping.sourceTerm, mapping.productName, line.text, names) })),
        brandSourceTerm && enterpriseBrandName ? { sourceTerm: brandSourceTerm, brandLabel: spokenLabel(brandSourceTerm, enterpriseBrandName, line.text, names) } : undefined));
      setSpokenNames(names);
      setSpeechEdits({});
      setGeneratedSpeech(drafts);
      setGeneratedMappingKey(mappingKey);
      setGenerationNotice('口播已生成，请检查左侧高亮的产品词，必要时修改后再确认。');
      const firstChanged = referenceLines.findIndex((line, index) => line.text !== drafts[index]);
      if (firstChanged >= 0) setActiveLine(firstChanged);
    } catch (error) {
      setGenerationNotice(error instanceof Error ? error.message : '口播生成失败，请重试。');
    } finally {
      setGeneratingSpeech(false);
    }
  };
  const highlightSpeech = (speech: string, line: string) => {
    const labels = productMappings.map(mapping => spokenLabel(mapping.sourceTerm, mapping.productName, line))
      .filter(Boolean).sort((a, b) => b.length - a.length);
    if (!labels.length) return speech;
    const escaped = labels.map(label => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const parts = speech.split(new RegExp(`(${escaped.join('|')})`, 'gi'));
    return parts.map((part, index) => labels.some(label => label.toLocaleLowerCase() === part.toLocaleLowerCase())
      ? <mark key={index} className="rounded bg-yellow-200 px-0.5 text-emerald-950">{part}</mark> : part);
  };
  const syncPlaybackCard = (seconds: number) => {
    let next = -1;
    let latestStart = -Infinity;
    referenceLines.forEach((line, index) => {
      const start = line.startSeconds ?? shotStart(line.time);
      const end = line.endSeconds ?? Infinity;
      if (seconds >= start && seconds < end && start > latestStart) {
        next = index;
        latestStart = start;
      }
    });
    if (next >= 0) setActiveLine(current => current === next ? current : next);
  };
  const previewUrl = useMemo(() => files[0] ? URL.createObjectURL(files[0]) : '', [files]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  useEffect(() => {
    if (!isReplication || !seed?.continueTaskId) return;
    let active = true;
    let timer = 0;
    let refreshed = false;
    const load = () => void socialContentApi.getTask(seed.continueTaskId!).then(async initial => {
      let task = initial;
      if (!refreshed) { refreshed = true; task = await socialContentApi.refreshReference(initial.taskId, initial.version).catch(() => initial); }
      if (!active || task.referenceVideoAnalysis?.status !== 'ready') return;
      window.clearInterval(timer);
      setTaskProductTerms(task.referenceVideoAnalysis.narrationProducts);
      setTaskReferenceShots(task.referenceVideoAnalysis.shots.map(shot => {
        const base = { startSeconds: shot.startSeconds, endSeconds: shot.endSeconds, visual: shot.visualDescription, firstFrameRef: shot.materialEvidence?.firstFrameRef || undefined,
          firstFrameSeconds: shot.materialEvidence?.firstFrameSeconds ?? shot.startSeconds };
        return { ...base, shotId: shot.shotId, time: `${shot.startSeconds.toFixed(2)}–${shot.endSeconds.toFixed(2)}s`,
          dialogue: shot.spokenText || '', subtitle: shot.captionText || '' };
      }));
      const uniqueLines = new Map<string, SpeechGroup>();
      for (const shot of task.referenceVideoAnalysis.shots) {
        for (const line of shot.spokenLines || []) {
          const text = line.text.trim();
          if (!text) continue;
          const key = `${line.startSeconds.toFixed(2)}:${line.endSeconds.toFixed(2)}:${text}`;
          if (!uniqueLines.has(key)) uniqueLines.set(key, {
            id: key, source: text, draft: text,
            time: `${line.startSeconds.toFixed(2)}–${line.endSeconds.toFixed(2)}s`,
            sourcePrecision: line.precision,
          });
        }
      }
      setTaskSpeechLines([...uniqueLines.values()].sort((a, b) => shotStart(a.time) - shotStart(b.time)));
    }).catch(() => undefined);
    load();
    timer = window.setInterval(load, 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [isReplication, seed?.continueTaskId]);

  useEffect(() => {
    let active = true;
    const load = () => {
      setProductsLoading(true);
      setProductsUnavailable(false);
      void fetch('/api/overseas/enterprise/profile', { headers: authHeader(), credentials: 'same-origin' })
        .then(response => { if (!response.ok) throw new Error(`enterprise_products_${response.status}`); return response.json(); })
        .then(async result => {
          const profile = result.profile || result;
          const items = await Promise.all((profile.products?.items || []).map(async (item: { id?: string; productId?: string; sku?: string; name?: string }, index: number) => {
            const name = String(item.name || '').trim().slice(0, 200);
            let id = [item.id, item.productId].map(value => String(value || '').trim().slice(0, 200)).find(Boolean) || String(item.sku || '').trim().slice(0, 160);
            if (!id) {
              const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(name || `legacy-empty-row:${index}`));
              id = `product-${Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, '0')).join('').slice(0, 16)}`;
            }
            return { id, name };
          }));
          return { items };
        }).then(result => {
        if (!active) return;
        const items = (Array.isArray(result.items) ? result.items : [])
          .filter(item => item && typeof item.id === 'string' && typeof item.name === 'string');
        setProducts(items);
        const seeded = items.find(item => item.id === seed?.productId || item.name === seed?.productName);
        setProductId(current => items.some(item => item.id === current) ? current : seeded?.id || '');
        setSelectedProductIds(current => {
          const retained = current.filter(id => items.some(item => item.id === id));
          const mapped = [...items.filter(item => seed?.selectedProductIds?.includes(item.id) || seed?.selectedProductNames?.includes(item.name)).map(item => item.id), ...(seed?.productMappings || []).map(mapping => items.find(item => item.id === mapping.productId || item.name === mapping.productName)?.id || '').filter(Boolean)];
          return retained.length ? retained : mapped.length ? [...new Set(mapped)] : seeded ? [seeded.id] : [];
        });
      }).catch(() => { if (active) setProductsUnavailable(true); })
        .finally(() => { if (active) setProductsLoading(false); });
    };
    load();
    window.addEventListener('focus', load);
    return () => { active = false; window.removeEventListener('focus', load); };
  }, [seed?.productId, seed?.productName, productSelectorOpen]);

  useEffect(() => {
    let active = true;
    const load = () => {
      setEnterpriseProfileState('loading');
      void fetch('/api/overseas/enterprise/profile', { headers: authHeader(), credentials: 'same-origin' })
        .then(response => { if (!response.ok) throw new Error('enterprise_profile_unavailable'); return response.json(); })
        .then(result => {
          if (!active) return;
          const profile = result.profile || result;
          setEnterpriseBrandName(String(profile.brand?.name || '').trim());
          const strategy = profile.socialStrategy;
          const routes: string[] = Array.isArray(strategy?.enabledRoutes) ? strategy.enabledRoutes : [];
          const strategies = strategy?.routeStrategies || {};
          const ctas = (routes.length ? routes : Object.keys(strategies))
            .map(route => String(strategies[route]?.primaryCta || '').trim()).filter(Boolean);
          setEnterpriseCtas([...new Set<string>(ctas)]);
          setEnterpriseProfileState('ready');
        }).catch(() => { if (active) setEnterpriseProfileState('error'); });
    };
    load();
    window.addEventListener('focus', load);
    return () => { active = false; window.removeEventListener('focus', load); };
  }, []);

  const startGeneration = async (replicationStep: 1 | 2 | 3 = 1, navigationOnly = false) => {
    if (submitting || productSelectionLoading || (!isReplication && !selectedProductIds.length) || (!navigationOnly && isReplication && (!productsReady || !speechGenerated || confirmedSpeech.some(line => !line.draft.trim())))) return;
    setSubmitting(true); setGenerationNotice('');
    try {
      const presenterAssetId = '';
      const uploadedMaterials: Material[] = freeHookMaterial && !isReplication ? [freeHookMaterial] : [];
      for (const file of navigationOnly || (freeHookMaterial && !isReplication) ? [] : files) {
        const type: Material['type'] = file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'image';
        const result = await studioApi.uploadMaterialFile(file, { folder: 'upload', type, sourceType: 'content-workbench' });
        if (!result.ok || !result.material?.id) throw new Error(result.error || `「${file.name}」上传失败`);
        uploadedMaterials.push(result.material);
      }
      const selected = selectedFreeProducts[0] || products.find(item => item.id === productId);
      if (!isReplication && !freeScriptText.trim()) {
        const hook = uploadedMaterials[0];
        if (!selected) throw new Error('请至少选择一个企业产品。');
        setGenerationNotice(hook ? '正在分析开场画面并由 Gemini 生成逐句口播…' : '正在由 Gemini 生成逐句口播与画面建议…');
        let analyzed = hook;
        let observations: string[] = [];
        let hookDuration = 0;
        if (hook) {
          const analysis = await studioApi.analyzeMaterialSegments(hook.id);
          if (!analysis.ok || !analysis.material) throw new Error(analysis.error || '开场钩子画面分析失败，请重试。');
          analyzed = analysis.material;
          observations = [
            ...(analyzed.visualObservations || []),
            ...(analyzed.segments || []).filter(segment => !segment.needsReview).map(segment => [segment.action, segment.shot, segment.environment].filter(Boolean).join('；')),
          ].filter(Boolean);
          if (!observations.length) throw new Error('尚未识别出开场钩子的画面内容，请更换清晰素材或选择“暂不指定”。');
          hookDuration = Math.min(3, Math.max(0.5, analyzed.duration || 3));
          setFreeHookMaterial(analyzed);
        }
        const productInfo = selectedFreeProducts.map(item => item.name).join('、');
        const result = await studioApi.script({
          materials: analyzed ? [analyzed.name] : [],
          materialInfos: analyzed ? [{ name: analyzed.name, type: analyzed.type, folder: analyzed.folder, duration: analyzed.duration, effectiveDuration: hookDuration, role: '用户指定开场钩子', targetStart: 0, targetEnd: hookDuration, observations }] : [],
          selectedProductId: selected.id, selectedProductIds, productInfo: [productInfo, `目标：${contentGoal}`, `受众：${targetAudience}`, sellingPoints && `卖点：${sellingPoints}`, tone && `语气：${tone}`, callToAction && `CTA：${callToAction}`, prohibitedClaims && `禁止表达：${prohibitedClaims}`, briefNotes].filter(Boolean).join('；'), language: contentLanguage, platform: platform.toLowerCase(), duration: desiredDuration,
          scriptType: 'storyboard', generationMode: 'material', voiceoverMode: 'ai', provider: 'gemini',
        }, '');
        if (!result.ok || !result.script?.trim() || result.publishable !== true || result.qualityStatus !== 'passed') throw new Error(result.error || 'Gemini 未生成通过质量核验的逐句口播，请重试。');
        setFreeHookMaterial(analyzed);
        setFreeScriptText(result.script);
        setFreeLines(parseFreeCreationScript(result.script));
        setFreeGeneration(result);
        setGenerationNotice('逐句口播与分镜已生成，请在左侧检查，确认后进入分镜制作。');
        setSubmitting(false);
        return;
      }
      const productName = isReplication ? productMappings[0]?.productName || '' : selectedFreeProducts.map(item => item.name).join('、');
      let resolvedDraftProjectId = draftProjectId;
      if (!isReplication) {
        resolvedDraftProjectId = resolvedDraftProjectId || await draftCreationRef.current || '';
        const confirmedFreeState: FreeCreationState = { ...freeCreationState, currentStep: 2, script: { ...freeCreationState.script, status: 'confirmed', invalidatedReasons: [] } };
        if (resolvedDraftProjectId) {
          const saved = await studioApi.saveProject({
            id: resolvedDraftProjectId,
            title: `${productName || '自由创作'} · 新内容`, status: 'draft',
            spec: {
              creationPath: 'free_creation', mode: 'material', contentMode: 'video', manualWorkflow: true,
              freeCreation: confirmedFreeState, script: freeScriptText, duration: desiredDuration,
              selectedProductIds, productId: selectedFreeProducts[0]?.id || '', productInfo: productName,
              videoKickoff: { source: hookMode === 'ai' ? 'ai_generated_hook' : 'material_library', productInfo: productName, script: freeScriptText, initialGeneration: freeGeneration || undefined, generatedVideo: freeHookMaterial ? { id: freeHookMaterial.id, title: freeHookMaterial.name, url: freeHookMaterial.url, poster: freeHookMaterial.poster, duration: freeHookMaterial.duration, material: freeHookMaterial } : undefined, materialRole: freeHookMaterial ? 'hook' : undefined },
            },
          });
          if (!saved.ok) throw new Error(saved.error || '自由创作草稿保存失败，请重试');
          setDraftProjectId(resolvedDraftProjectId);
        }
      }
      // GENERATION_INTEGRATION_GAP: the current task contract accepts shared files plus
      // selected sentence indexes, but not a durable sentence-to-asset mapping yet.
      onGenerate({
        replicationStep: isReplication ? replicationStep : undefined,
        confirmedSpeech: isReplication && !navigationOnly ? confirmedSpeech : undefined,
        initialScript: !isReplication ? freeScriptText : undefined,
        initialGeneration: !isReplication ? freeGeneration || undefined : undefined,
        draftProjectId: !isReplication ? resolvedDraftProjectId : undefined,
        requestId: Date.now(),
        creationPath: mode,
        title: isReplication
          ? productName ? `${productName} · 爆款复刻` : '爆款复刻'
          : `${productName || '自由创作'} · 新内容`,
        productId: isReplication ? productMappings[0]?.productId || '' : selected?.id || '',
        productName,
        productMappings: isReplication ? productMappings : selectedFreeProducts.map(item => ({ sourceTerm: item.name, productId: item.id, productName: item.name })),
        brandMapping: enterpriseBrandName ? { sourceTerm: brandSourceTerm.trim(), brandName: enterpriseBrandName } : undefined,
        presenterAssetId,
        files,
        uploadedMaterials,
        referenceLinks: [...new Set([...(seed?.referenceLinks || []), ...uploadedMaterials.map(item => item.url).filter(Boolean)])],
        callToAction: '',
        specialRequirements: isReplication ? '已确认口播文本；分镜匹配时制作数字人口播镜头，成片渲染时生成统一配音。' : `人工自由创作；钩子来源：${hookMode}；允许无口播分镜；由 Gemini 依据企业产品资料生成逐句口播及后续分镜。`,
        stageProfileId: stageProfile?.id || 'b2b_launch',
        stageLabel: stageProfile?.name || 'B2B 起步验证',
        strategyPresetId: stageProfile?.presetId || 'b2b_starting',
      });
    } catch (error) {
      setGenerationNotice(error instanceof Error ? error.message : '创建任务失败');
      setSubmitting(false);
    }
  };

  const commitFreeLines = (next: FreeCreationLine[]) => {
    const normalized = next.map((line, index) => ({ ...line, hook: line.hook || (!next.some(item => item.hook) && index === 0) }));
    let hookSeen = false;
    normalized.forEach(line => { if (line.hook && hookSeen) line.hook = false; else if (line.hook) hookSeen = true; });
    const scriptText = serializeFreeCreationLines(normalized);
    setFreeLines(normalized);
    setFreeScriptText(scriptText);
    setFreeGeneration(current => current ? { ...current, script: scriptText } : current);
  };
  const regenerateFreeLine = async (index: number) => {
    const line = freeLines[index];
    if (!line || generatingSpeech) return;
    setGeneratingSpeech(true); setGenerationNotice('正在重新生成当前分镜…');
    try {
      const result = await studioApi.script({
        materials: freeHookMaterial ? [freeHookMaterial.name] : [], materialInfos: [],
        selectedProductId: selectedFreeProducts[0]?.id || '', selectedProductIds,
        productInfo: `${selectedFreeProducts.map(item => item.name).join('、')}；仅重写第 ${index + 1} 个分镜。前文：${freeLines.slice(0, index).map(item => item.speech).join(' ')}；当前画面意图：${line.visual}`,
        language: contentLanguage, platform: platform.toLowerCase(), duration: Math.max(4, (timeRange(line.time)?.end || 4) - (timeRange(line.time)?.start || 0)),
        scriptType: 'storyboard', generationMode: 'material', voiceoverMode: line.silent ? 'none' : 'ai', provider: 'gemini',
      }, '');
      if (!result.ok || !result.script?.trim()) throw new Error(result.error || '当前分镜重新生成失败');
      const generated = parseFreeCreationScript(result.script)[0];
      if (!generated) throw new Error('未得到可编辑分镜');
      commitFreeLines(freeLines.map((item, itemIndex) => itemIndex === index ? { ...generated, id: item.id, time: item.time, hook: item.hook, silent: item.silent } : item));
      setGenerationNotice('当前分镜已重新生成，修改已自动保存。');
    } catch (error) { setGenerationNotice(error instanceof Error ? error.message : '当前分镜重新生成失败'); }
    finally { setGeneratingSpeech(false); }
  };
  const generateAiHook = async () => {
    if (isReplication || aiHookPhase === 'saving' || aiHookPhase === 'frame' || aiHookPhase === 'video') return;
    if (!selectedProductIds.length || !contentGoal.trim() || !targetAudience.trim()) {
      setAiHookError('请先选择产品并填写内容目标和目标受众。'); return;
    }
    setAiHookError(''); setAiHookCandidate(null); setAiHookFrame(null); setAiHookEstimatedCost(0); setAiHookPhase('saving');
    try {
      const id = draftProjectId || await draftCreationRef.current || '';
      if (!id) throw new Error('自由创作草稿尚未建立，请重试。');
      const productName = selectedFreeProducts.map(item => item.name).join('、');
      const saved = await studioApi.saveProject({ id, title: `${productName || '自由创作'} · AI 钩子草稿`, status: 'draft', spec: {
        creationPath: 'free_creation', mode: 'material', contentMode: 'video', manualWorkflow: true,
        freeCreation: { ...freeCreationState, hookSource: 'ai', hookMaterialId: '' }, script: freeScriptText, duration: desiredDuration,
        selectedProductIds, productId: selectedFreeProducts[0]?.id || '', productInfo: productName,
      } });
      if (!saved.ok) throw new Error(saved.error || 'AI 钩子草稿保存失败');
      if (!aiHookRequestRef.current) {
        const suffix = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        aiHookRequestRef.current = { frame: `free-hook-frame:${suffix}`, video: `free-hook-video:${suffix}` };
      }
      const visualIntent = freeLines.find(line => line.hook)?.visual || briefNotes || sellingPoints || '产品优先、前三秒抓住目标用户注意力';
      setAiHookPhase('frame');
      const frame = await studioApi.freeCreationHookFirstFrame({ projectId: id, requestId: aiHookRequestRef.current.frame,
        productIds: selectedProductIds, goal: contentGoal, audience: targetAudience, visualIntent, ratio: '9:16' });
      if (!frame.ok || !frame.material?.id || !frame.material.url) throw new Error(frame.error || 'AI 钩子首帧生成失败');
      setAiHookFrame(frame.material); setAiHookEstimatedCost(Number(frame.estimatedCostCny || 0));
      setAiHookPhase('video');
      const video = await studioApi.seedanceVideo({ requestId: aiHookRequestRef.current.video,
        script: [visualIntent, `内容目标：${contentGoal}`, `目标受众：${targetAudience}`].join('；'), productInfo: productName,
        language: contentLanguage, ratio: '9:16', duration: 4, resolution: '480p', title: `自由创作 AI 钩子 · ${productName}`,
        referenceImageUrl: frame.material.url, generationGroupKey: `free-hook:${id}`,
        generationContext: { freeCreationHook: true, projectId: id, firstFrameMaterialId: frame.material.id, productIds: selectedProductIds },
      });
      if (!video.ok || !video.material?.id || !video.material.url) throw new Error(video.error || 'Seedance 未返回可预览的 AI 钩子视频');
      setAiHookCandidate(video.material); setAiHookEstimatedCost(current => current + 0.96); setAiHookPhase('ready');
    } catch (error) {
      setAiHookError(error instanceof Error ? error.message : 'AI 钩子生成失败'); setAiHookPhase('failed');
    }
  };
  const adoptAiHook = () => {
    if (!aiHookCandidate) return;
    setFreeHookMaterial(aiHookCandidate); setHookMode('ai'); setFiles([]);
    setGenerationNotice('AI 钩子已采纳并写入素材库，草稿正在自动保存。');
  };
  const chooseHookMode = (value: 'none' | 'upload' | 'library' | 'ai') => {
    setHookMode(value);
    setHookChooserOpen(false);
    if (value === 'upload') window.setTimeout(() => uploadRef.current?.click(), 0);
    if (value === 'library' && !libraryHooks.length) {
      setLibraryLoading(true);
      void studioApi.listMaterials('library')
        .then(items => setLibraryHooks(items.filter(item => item.type === 'video' || item.type === 'image')))
        .finally(() => setLibraryLoading(false));
    }
    if (value === 'none' || value === 'ai') {
      setFiles([]);
      setFreeHookMaterial(null);
    }
  };
  const freeReady = selectedProductIds.length > 0 && Boolean(contentGoal.trim()) && Boolean(targetAudience.trim()) && freeLines.length > 0
    && freeLines.every(line => line.visual.trim() && (line.silent || line.speech.trim())) && freeLines.filter(line => line.hook).length === 1;

  return (
    <section className="flex h-full min-h-0 flex-col bg-white">
      <ReplicationWorkbenchHeader activeStep={0} compact={!isReplication} showTaskIdentity={isReplication} stepLabels={isReplication ? undefined : ['创意与口播确认', '分镜匹配与制作', '成片渲染和导出']} onStepChange={index => { if (index > 0 && (isReplication ? speechGenerated : Boolean(freeScriptText))) void startGeneration(); }} navigationDisabled={submitting || productSelectionLoading || (isReplication ? !speechGenerated : !freeScriptText)} title={isReplication ? seed?.referenceTitle : undefined} actions={<><Button htmlType="button" onClick={onShowCreations} className="whitespace-nowrap font-semibold">我的创作</Button><Button type="primary" htmlType="button" onClick={onOpenChooser} className="whitespace-nowrap font-semibold">切换制作方式</Button></>} />

      <Modal
        open={!isReplication && hookChooserOpen}
        centered
        getContainer={false}
        width={760}
        footer={null}
        title="选择开场方式"
        onCancel={() => setHookChooserOpen(false)}
      >
        <p className="mb-5 text-sm text-text-secondary">选择本次内容如何开始；稍后仍可在画面预览区更换。</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {([
            ['ai', 'AI 生成', '根据产品与受众生成钩子', Sparkles],
            ['upload', '上传素材', '使用本地图片或视频', Upload],
            ['library', '素材库', '从已有素材中选择', FolderOpen],
            ['none', '暂不指定', '进入分镜后再补充', Film],
          ] as const).map(([value, label, description, Icon]) => (
            <button
              key={value}
              type="button"
              onClick={() => chooseHookMode(value)}
              className="group flex min-h-40 flex-col rounded-lg border border-border bg-white p-4 text-left transition hover:border-accent hover:bg-accent-glow focus:outline-none focus:ring-2 focus:ring-accent/30"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-2 text-text-primary group-hover:bg-white group-hover:text-accent"><Icon size={20} /></span>
              <span className="mt-auto whitespace-nowrap text-sm font-semibold text-text-primary">{label}</span>
              <span className="mt-1 text-xs leading-5 text-text-secondary">{description}</span>
            </button>
          ))}
        </div>
      </Modal>


      <div className="social-creation-workbench-layout grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:overflow-hidden">
        <aside className="min-h-0 border-b border-border bg-white lg:overflow-y-auto lg:border-b-0 lg:border-r">
          {isReplication && <div className="sticky top-0 z-10 border-b border-border bg-white px-4 py-4">
            <p className="text-sm font-semibold text-text-primary">口播替换与确认</p>
            <p className="mt-1 text-[11px] leading-5 text-text-muted">先在右侧完成产品映射并生成口播，再检查高亮产品词、修改并确认。</p>
          </div>}
          <ol ref={cardListRef} className="space-y-2 p-3">
            {!isReplication && !freeLines.length && <li className="rounded-lg border border-dashed border-blue-200 bg-blue-50/40 p-4 text-xs leading-5 text-zinc-700">填写右侧创作简报即可生成分镜。钩子素材为可选项，也可以在第二页再完成首镜。</li>}
            {!isReplication && freeLines.map((freeLine, index) => <li key={freeLine.id} draggable onDragStart={event => { draggedFreeLineIndex.current = index; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', freeLine.id); }} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }} onDrop={event => { event.preventDefault(); const from = draggedFreeLineIndex.current; draggedFreeLineIndex.current = null; if (from == null || from === index) return; const next = [...freeLines]; const [moved] = next.splice(from, 1); next.splice(index, 0, moved); commitFreeLines(next); }} onDragEnd={() => { draggedFreeLineIndex.current = null; }} className={`rounded-lg border p-3 ${freeLine.hook ? 'border-blue-400 bg-blue-50/50' : 'border-border bg-white'}`}>
              <div className="flex items-center gap-2"><span title="拖动调整分镜顺序" aria-label={`拖动第 ${index + 1} 个分镜排序`} className="cursor-grab text-text-muted active:cursor-grabbing"><GripVertical size={14} /></span><span className="text-xs font-semibold">{index + 1}</span><input aria-label={`第 ${index + 1} 个分镜时间`} value={freeLine.time} onChange={event => commitFreeLines(freeLines.map((item, i) => i === index ? { ...item, time: event.target.value } : item))} className="min-w-0 flex-1 rounded border border-border px-2 py-1 text-[10px]" /><button type="button" onClick={() => commitFreeLines(freeLines.map((item, i) => ({ ...item, hook: i === index })))} className={`rounded px-2 py-1 text-[10px] font-bold ${freeLine.hook ? 'bg-blue-600 text-white' : 'bg-surface-2 text-text-secondary'}`}>{freeLine.hook ? '首要钩子' : '设为钩子'}</button></div>
              <textarea aria-label={`第 ${index + 1} 个分镜口播`} disabled={freeLine.silent} value={freeLine.speech} onChange={event => commitFreeLines(freeLines.map((item, i) => i === index ? { ...item, speech: event.target.value } : item))} rows={3} placeholder="填写口播" className="mt-2 w-full resize-y rounded-lg border border-border p-2 text-xs leading-5 disabled:bg-slate-100" />
              <label className="mt-2 flex items-center gap-2 text-[10px] font-bold"><input type="checkbox" checked={freeLine.silent} onChange={event => commitFreeLines(freeLines.map((item, i) => i === index ? { ...item, silent: event.target.checked } : item))} />无口播画面</label>
              <textarea aria-label={`第 ${index + 1} 个分镜画面意图`} value={freeLine.visual} onChange={event => commitFreeLines(freeLines.map((item, i) => i === index ? { ...item, visual: event.target.value } : item))} rows={2} placeholder="画面意图" className="mt-2 w-full resize-y rounded-lg border border-border p-2 text-xs leading-5" />
              <select aria-label={`第 ${index + 1} 个分镜类型`} value={freeLine.shotType} onChange={event => commitFreeLines(freeLines.map((item, i) => i === index ? { ...item, shotType: event.target.value as FreeCreationLine['shotType'] } : item))} className="mt-2 w-full rounded-lg border border-border bg-white p-2 text-xs"><option>真人口播</option><option>工厂</option><option>产品</option><option>D to C</option></select>
              <p className="mt-2 rounded-md bg-slate-50 px-2 py-1.5 text-[10px] leading-4 text-text-muted">事实来源：{selectedFreeProducts.length ? selectedFreeProducts.map(item => item.name).join('、') : '尚未选择企业产品'}</p>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-bold"><button type="button" onClick={() => void regenerateFreeLine(index)} className="rounded border border-border px-2 py-1"><RefreshCw size={11} className="mr-1 inline" />重生成</button><button type="button" onClick={() => { const midpoint = Math.max(1, Math.floor(freeLine.speech.length / 2)); commitFreeLines([...freeLines.slice(0, index), { ...freeLine, id: `${freeLine.id}-a`, speech: freeLine.speech.slice(0, midpoint), hook: freeLine.hook }, { ...freeLine, id: `${freeLine.id}-b`, speech: freeLine.speech.slice(midpoint), hook: false }, ...freeLines.slice(index + 1)]); }} className="rounded border border-border px-2 py-1">拆分</button><button type="button" disabled={index === 0} onClick={() => { const previous = freeLines[index - 1]; commitFreeLines([...freeLines.slice(0, index - 1), { ...previous, speech: [previous.speech, freeLine.speech].filter(Boolean).join(' '), visual: [previous.visual, freeLine.visual].filter(Boolean).join('；'), hook: previous.hook || freeLine.hook }, ...freeLines.slice(index + 1)]); }} className="rounded border border-border px-2 py-1 disabled:opacity-40">与上条合并</button><button type="button" disabled={index === 0} onClick={() => { const next = [...freeLines]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; commitFreeLines(next); }} className="rounded border border-border px-2 py-1 disabled:opacity-40">上移</button><button type="button" disabled={index === freeLines.length - 1} onClick={() => { const next = [...freeLines]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; commitFreeLines(next); }} className="rounded border border-border px-2 py-1 disabled:opacity-40">下移</button><button type="button" disabled={freeLines.length === 1} onClick={() => commitFreeLines(freeLines.filter((_, i) => i !== index))} className="rounded border border-red-200 px-2 py-1 text-red-700 disabled:opacity-40"><Trash2 size={11} className="inline" />删除</button></div>
            </li>)}
            {!isReplication && freeLines.length > 0 && <li><button type="button" onClick={() => commitFreeLines([...freeLines, { id: `free-line-${Date.now()}`, time: `${freeLines.length * 4}–${(freeLines.length + 1) * 4}s`, speech: '', visual: '', shotType: '产品', silent: true, hook: false }])} className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-emerald-300 py-2 text-xs font-bold text-emerald-800"><Plus size={13} />新增分镜</button><button type="button" onClick={() => { setFreeScriptText(''); setFreeLines([]); setFreeGeneration(null); setGenerationNotice(''); }} className="mt-2 text-xs font-bold text-emerald-800 underline">重新生成整版</button></li>}
            {isReplication && !referenceShots.length && <li className="rounded-lg border border-dashed border-border p-4 text-xs leading-5 text-text-muted">原片分镜和口播尚未完成分析。完成后会在这里逐句显示真实口播与素材首帧。</li>}
            {script.map((line, index) => {
              const active = activeLine === index;
              return <li ref={element => { cardsRef.current[index] = element; }} key={`${index}:${line}`}>
                <button type="button" aria-current={active ? 'step' : undefined} onClick={() => { setActiveLine(index); setSeekRequestId(current => current + 1); setRequestedSeek((referenceLines[index]?.startSeconds ?? shotStart(referenceLines[index]?.time || '')) + 0.05); }} className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition ${active ? 'border-blue-400 bg-blue-50/40 shadow-none' : 'border-border bg-white hover:border-blue-200'}`}>
                  {isReplication && <StoryboardFirstFrame source={resolvedReferenceUrl || seed?.referenceMediaUrl} firstFrameRef={referenceLines[index]?.firstFrameRef} time={referenceLines[index]?.firstFrameSeconds ?? shotStart(referenceLines[index]?.time || '')} label={`口播 ${index + 1}`} />}
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[10px] font-semibold ${active ? 'border-blue-600 bg-blue-600 text-white' : 'border-border text-text-muted'}`}>{index + 1}</span>
                  <span className="min-w-0 flex-1"><span className="block text-xs font-bold leading-5 text-text-primary">{line || '该分镜暂无可识别口播'}</span><span className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-text-muted">{isReplication ? referenceLines[index]?.time : `00:${String(index * 4).padStart(2, '0')}–00:${String((index + 1) * 4).padStart(2, '0')}`}<ChevronRight size={11} /></span>{isReplication && referenceLines[index]?.visuals.length > 0 && <span className="mt-1 line-clamp-2 text-[10px] leading-4 text-text-muted">画面：{referenceLines[index].visuals[0]}</span>}</span>
                </button>
                {isReplication && referenceLines[index]?.visualShotCount > 0 && <>
                  <button type="button" aria-expanded={expandedSpeechLines.has(index)} aria-controls={`speech-visual-shots-${index}`} onClick={() => setExpandedSpeechLines(current => {
                    const next = new Set(current);
                    if (next.has(index)) next.delete(index); else next.add(index);
                    return next;
                  })} className="mt-1 flex w-full items-center justify-between rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left text-[11px] font-bold text-blue-600">
                    覆盖 {referenceLines[index].visualShotCount} 个分镜
                    <ChevronDown size={14} className={`transition-transform ${expandedSpeechLines.has(index) ? 'rotate-180' : ''}`} />
                  </button>
                  {expandedSpeechLines.has(index) && <ol id={`speech-visual-shots-${index}`} className="mt-1 space-y-1.5 border-l-2 border-emerald-100 pl-3">
                    {referenceLines[index].shots.map((shot, shotIndex) => {
                      const shotTime = Number.isFinite(shot.startSeconds) && Number.isFinite(shot.endSeconds)
                        ? `${shot.startSeconds!.toFixed(2)}–${shot.endSeconds!.toFixed(2)}s` : shot.time;
                      return <li key={`${shotIndex}:${shot.firstFrameRef || shot.visual || ''}`}>
                        <button type="button" onClick={() => { setActiveLine(index); setSeekRequestId(current => current + 1); setRequestedSeek((shot.startSeconds ?? shot.firstFrameSeconds ?? shotStart(shot.time)) + 0.05); }} className="flex w-full items-start gap-2 rounded-lg border border-border bg-white p-2 text-left hover:border-emerald-300">
                          <StoryboardFirstFrame source={resolvedReferenceUrl || seed?.referenceMediaUrl} firstFrameRef={shot.firstFrameRef} time={shot.firstFrameSeconds ?? shot.startSeconds ?? shotStart(shot.time)} label={`分镜 ${shotIndex + 1}`} />
                          <span className="min-w-0 flex-1"><span className="block text-[10px] font-bold text-zinc-700">分镜 {shotIndex + 1} · {shotTime}</span><span className="mt-1 line-clamp-3 text-[10px] leading-4 text-text-secondary">{shot.visual || '画面待分析'}</span></span>
                        </button>
                      </li>;
                    })}
                  </ol>}
                </>}
                {isReplication && line.trim() && speechGenerated && <div className={`mt-2 rounded-lg border p-2 ${productMappings.some(mapping => mapping.sourceTerm && line.toLocaleLowerCase().includes(mapping.sourceTerm.toLocaleLowerCase())) ? 'border-amber-400 bg-amber-50 ring-1 ring-amber-200' : 'border-zinc-200 bg-zinc-50'}`}><p className="text-[10px] font-bold text-zinc-700">替换后口播 · 请检查</p><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-text-primary">{highlightSpeech(speechEdits[index] ?? generatedSpeech?.[index] ?? '', line)}</p><label className="mt-2 block text-[10px] font-bold text-zinc-700">编辑口播<textarea aria-label={`第 ${index + 1} 句新口播`} value={speechEdits[index] ?? generatedSpeech?.[index] ?? ''} onChange={event => setSpeechEdits(current => ({ ...current, [index]: event.target.value }))} rows={3} className="mt-1 w-full resize-y rounded-md border border-border bg-white p-2 text-xs font-normal leading-5 text-text-primary" /></label></div>}
              </li>;
            })}
          </ol>
        </aside>

        <main className="flex min-h-[560px] min-w-0 flex-col bg-[#f5f8f5] lg:min-h-0">
          <div className="flex items-center justify-between border-b border-black/5 px-5 py-3">
            <div><p className="text-xs font-semibold text-text-primary">画面预览</p>{isReplication && <p className="mt-0.5 text-[10px] text-text-muted">当前对应第 {activeLine + 1} 句口播</p>}</div>
            {!isReplication && <Button size="small" htmlType="button" onClick={() => setHookChooserOpen(true)} className="whitespace-nowrap">更换开场方式</Button>}
          </div>
          <input ref={uploadRef} type="file" accept="video/*,image/*" className="hidden" onChange={event => { setFiles(Array.from(event.currentTarget.files || []).slice(0, 1)); setHookMode('upload'); setFreeScriptText(''); setFreeLines([]); setFreeGeneration(null); setFreeHookMaterial(null); }} />
          {!isReplication && hookMode === 'library' && <div className="max-h-36 overflow-y-auto border-b border-border p-3">{libraryLoading ? <p className="text-xs text-text-muted">正在读取素材库…</p> : libraryHooks.length ? <div className="grid grid-cols-2 gap-2">{libraryHooks.map(item => <button type="button" key={item.id} onClick={() => { setFreeHookMaterial(item); setFiles([]); }} className={`rounded-lg border p-2 text-left text-[10px] ${freeHookMaterial?.id === item.id ? 'border-blue-500 bg-blue-50' : 'border-border'}`}><span className="line-clamp-2 font-bold">{item.name}</span></button>)}</div> : <p className="text-xs text-text-muted">素材库暂无可用图片或视频，可改用上传或暂不指定。</p>}</div>}
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4 sm:p-5">
            <div className="relative flex h-full min-h-0 max-h-full w-full items-center justify-center overflow-hidden rounded-lg border border-[#dfe5e1] bg-[#eef0f3] ">
              {previewUrl && files[0]?.type.startsWith('video/') ? <video src={previewUrl} controls playsInline preload="metadata" className="h-full w-full object-contain" />
                : previewUrl ? <img src={previewUrl} alt="用户上传素材预览" className="h-full w-full object-contain" />
                : !isReplication && (aiHookCandidate?.url || freeHookMaterial?.url) && (aiHookCandidate || freeHookMaterial)?.type === 'video' ? <video src={(aiHookCandidate || freeHookMaterial)?.url} poster={(aiHookCandidate || freeHookMaterial)?.poster} controls playsInline className="h-full w-full object-contain" />
                : !isReplication && freeHookMaterial?.url ? <img src={freeHookMaterial.url} alt="素材库钩子预览" className="h-full w-full object-contain" />
                : seed?.referenceContentType === 'video' && seed.referenceMediaUrl ? <WorkbenchVideoPreview source={seed.referenceMediaUrl} poster={seed.referenceThumbnail} title={seed.referenceTitle || '爆款视频预览'} seekSeconds={requestedSeek} seekRequestId={seekRequestId} onPlaybackTime={syncPlaybackCard} onResolved={setResolvedReferenceUrl} />
                : seed?.referenceThumbnail ? <img src={seed.referenceThumbnail} alt={isReplication ? '爆款视频预览' : '已选素材预览'} className="h-full w-full object-contain" />
                : <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-8 text-center text-[#294c40]">
                    <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-[#607b71] shadow-none"><Film size={27} /></span>
                    <div><p className="text-base font-semibold">{isReplication ? '等待爆款视频' : hookMode === 'ai' ? aiHookPhase === 'frame' ? '正在生成钩子首帧…' : aiHookPhase === 'video' ? '正在生成 4 秒钩子视频…' : '生成 AI 开场画面' : '尚未指定钩子素材'}</p>{(isReplication || hookMode === 'ai') && <p className="mt-2 text-xs leading-5 text-[#789087]">{isReplication ? '从灵感中心选择爆款后，会在这里显示原视频。' : '将按已选产品、内容目标和目标受众生成，预览满意后再采纳。'}</p>}</div>
                  </div>}
            </div>
          </div>
          {!isReplication && hookMode === 'ai' && <div className="border-t border-black/5 px-5 py-3 text-[11px]">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-text-muted">预计费用：Seedream 首帧约 ¥0.30 + Seedance 4 秒 480p 约 ¥0.96；以服务端预算核算为准。</span>
              <div className="flex gap-2">{aiHookCandidate && freeHookMaterial?.id !== aiHookCandidate.id && <button type="button" onClick={adoptAiHook} className="rounded-lg bg-blue-600 px-3 py-1.5 font-semibold text-white">采纳此钩子</button>}<button type="button" disabled={['saving','frame','video'].includes(aiHookPhase)} onClick={() => void generateAiHook()} className="rounded-lg border border-blue-200 px-3 py-1.5 font-semibold text-blue-700 disabled:opacity-50">{aiHookPhase === 'failed' ? '重试生成' : aiHookCandidate ? '重新生成' : '确认费用并生成'}</button></div></div>
            {aiHookFrame && !aiHookCandidate && <p className="mt-1 text-text-muted">首帧已生成并入库，正在继续生成视频。</p>}{aiHookEstimatedCost > 0 && <p className="mt-1 text-text-muted">本次已核算预计费用约 ¥{aiHookEstimatedCost.toFixed(2)}</p>}{aiHookError && <p role="alert" className="mt-1 text-red-600">{aiHookError}</p>}{freeHookMaterial && freeHookMaterial.id === aiHookCandidate?.id && <p className="mt-1 font-bold text-emerald-700">已采纳并保存到素材库；刷新后可从当前草稿恢复。</p>}
          </div>}
          {(files.length > 0 || freeHookMaterial || isReplication || hookMode === 'ai') && <div className="flex items-center justify-between border-t border-black/5 px-5 py-3 text-[11px] text-text-muted"><span>{files.length ? `已选择开场钩子：${files[0]?.name}` : freeHookMaterial ? `已选择开场钩子：${freeHookMaterial.name}` : isReplication ? '原片仅供分析' : '请生成、预览并采纳 AI 钩子'}</span>{!isReplication && hookMode === 'upload' && <button type="button" onClick={()=>uploadRef.current?.click()} className="whitespace-nowrap font-semibold text-emerald-700">更换钩子</button>}</div>}
        </main>

        <aside className="flex min-h-0 flex-col border-t border-border bg-white lg:border-l lg:border-t-0">
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-text-primary">{isReplication ? productSlots.length ? '产品与品牌替换' : '品牌替换' : '生成设置'}</p>{isReplication && <p className="mt-1 text-[11px] leading-5 text-text-muted">在左侧逐句检查新口播。</p>}</div></div>

            {isReplication && <div className="mt-4">
              {productSlots.length > 0 && <>
              <p className="text-xs font-semibold text-text-primary">默认企业产品</p>
              <p className="mt-1 text-[10px] leading-4 text-text-muted">原口播产品词出现 {productMentions.length} 次，去重后有 {productSlots.length} 个替换对象。选择默认产品会将所有对象设为同一款；之后可在下方逐项调整。</p>
              <details className="mt-2 text-[10px] text-text-secondary"><summary className="cursor-pointer font-bold">查看识别依据与出现次数</summary><div className="mt-1 space-y-1">{productMentions.map((mention, index) => <p key={`${mention.time}:${index}`}>{index + 1}. {mention.time} · 「{mention.sourceLabel}」：{mention.text}</p>)}<p className="text-text-muted">按口播文本统计；画面中的瓶数、配方数量、重复分镜不计为不同口播产品。产品类别词不能证明具体 SKU 数量。</p></div></details>
              <button type="button" aria-expanded={productSelectorOpen} aria-label="选择企业知识库产品" disabled={productsLoading || submitting} onClick={() => setProductSelectorOpen(value => !value)} className="mt-2 flex h-11 w-full items-center justify-between rounded-lg border border-border bg-white px-3 text-left text-xs font-bold text-text-primary disabled:bg-slate-100">
                <span>{productsLoading ? '正在读取企业产品目录…' : primaryProduct ? `默认产品：${primaryProduct.name}` : '请选择默认企业产品'}</span><ChevronRight size={15} className={productSelectorOpen ? 'rotate-90' : ''} />
              </button>
              {productSelectorOpen && <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border bg-white p-2 shadow-none">
                {products.map(item => <label key={item.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-xs hover:bg-zinc-50">
                  <input type="radio" name="replication-primary-product" checked={primaryProductId === item.id} disabled={submitting} onChange={() => chooseDefaultProduct(item.id)} className="accent-emerald-700" />
                  <span className="min-w-0 truncate">{item.name}</span>
                </label>)}
                {!products.length && <div className="px-2 py-3 text-xs text-text-muted">企业知识库暂无产品。<button type="button" onClick={() => { try { sessionStorage.setItem('lingshu:enterprise-focus', 'products'); } catch { /* optional storage */ } window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'enterprise' } })); }} className="ml-1 font-bold text-emerald-700 underline">前往录入产品</button></div>}
              </div>}
              {productsUnavailable && <p className="mt-2 flex items-center gap-1 text-[10px] text-amber-700"><CircleAlert size={11} />企业产品目录暂时无法读取</p>}
              <section className="mt-3" aria-label="产品映射设置">
                <div className="mb-2 flex items-center justify-between text-[10px] text-text-muted"><span className="font-bold">产品映射 · {productSlots.length} 项</span>{primaryProduct && productMappings.some(mapping => mapping.productId !== primaryProductId) ? <button type="button" disabled={submitting} onClick={() => chooseDefaultProduct(primaryProductId)} className="font-bold text-emerald-700 disabled:opacity-50">全部使用默认产品</button> : productSlots.length > 2 && <span>上下滚动查看全部</span>}</div>
                <div role="region" aria-label="产品映射列表" tabIndex={0} style={{ maxHeight: 160, overflowY: 'auto', flexShrink: 0 }} className="space-y-2 overscroll-contain pr-1 [scrollbar-gutter:stable]">
              {productSlots.map((slot, index) => <label key={slot.shotId} className="block min-h-[76px] rounded-lg border border-border bg-surface-2 p-2 text-[10px] font-bold text-text-secondary">
                {index + 1}. 原口播「{slot.sourceLabel}」→ 企业产品
                <select aria-label={`原口播产品 ${slot.sourceLabel} 对应企业产品`} value={productMappings[index]?.productId || ''} onChange={event => {
                  const id = event.target.value;
                  setProductSelectionChanged(true);
                  setProductAssignments(current => ({ ...current, [slot.shotId]: id }));
                  if (!primaryProductId && id) setProductId(id);
                }} className="mt-1 w-full rounded-md border border-border bg-white px-2 py-2 text-xs text-text-primary">
                  <option value="">请选择对应产品</option>{products.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>)}
                </div>
              </section>
              {!productsReady && <p role="status" className="mt-2 text-[10px] font-bold text-amber-700">请选择默认企业产品，或为每个原口播产品词指定对应产品。</p>}
              </>}
              {!productSlots.length && referenceLines.length > 0 && <p className="text-[10px] leading-4 text-text-muted">原口播未识别到产品词，无需选择企业产品。若识别有遗漏，可补充原词。</p>}
              {referenceLines.length > 0 && <div className="mt-2 flex gap-1.5"><input aria-label="补充原口播产品词" value={newProductTerm} onChange={event => setNewProductTerm(event.target.value)} placeholder="补充未识别的原产品词" className="min-w-0 flex-1 rounded-md border border-border px-2 py-1.5 text-[10px]" /><button type="button" disabled={!newProductTerm.trim()} onClick={() => { const term = newProductTerm.trim(); if (!script.join(' ').toLocaleLowerCase().includes(term.toLocaleLowerCase())) { setGenerationNotice('补充的产品词必须出现在原片口播中。'); return; } if (!productSlots.some(slot => slot.sourceLabel.toLocaleLowerCase() === term.toLocaleLowerCase())) setManualProductTerms(current => [...current, term]); setNewProductTerm(''); setGenerationNotice(''); }} className="rounded-md border border-border bg-white px-2 text-[10px] font-bold disabled:opacity-40">添加</button></div>}
              <div className="mt-3 rounded-lg border border-border bg-surface-2 p-2.5"><p className="text-[10px] font-bold text-text-secondary">企业品牌 · 自动读取</p><p className="mt-1 text-xs text-text-primary">{enterpriseBrandName || '企业知识库尚未填写品牌名称'}</p><p className="mt-1 text-[10px] text-text-muted">新口播使用企业知识库中的品牌信息，无需填写原片品牌名。</p></div>
            </div>}

            {!isReplication && <div className="mt-4 space-y-3">
              <div><p className="text-xs font-semibold text-text-primary">主推产品 · 多选</p><button type="button" aria-expanded={productSelectorOpen} onClick={() => setProductSelectorOpen(value => !value)} disabled={productsLoading || submitting} className="mt-2 flex h-11 w-full items-center justify-between rounded-lg border border-border bg-white px-3 text-left text-xs font-bold"><span>{productsLoading ? '正在读取企业产品…' : selectedFreeProducts.length ? `已选 ${selectedFreeProducts.length} 款：${selectedFreeProducts.map(item => item.name).join('、')}` : '请选择一个或多个产品'}</span><ChevronDown size={14} /></button>{productSelectorOpen && <div className="mt-1 max-h-44 overflow-y-auto rounded-lg border border-border p-2">{products.map(item => <label key={item.id} className="flex items-center gap-2 rounded-lg p-2 text-xs hover:bg-zinc-50"><input type="checkbox" checked={selectedProductIds.includes(item.id)} onChange={event => { setSelectedProductIds(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id)); setProductId(current => event.target.checked && !current ? item.id : current === item.id && !event.target.checked ? '' : current); setFreeScriptText(''); setFreeLines([]); setFreeGeneration(null); }} /><span>{item.name}</span></label>)}</div>}{!productsLoading && !products.length && <span className="mt-2 block text-[10px] font-normal text-amber-700">请先在企业中心录入产品。</span>}</div>
              <label className="block text-[10px] font-bold">内容目标<select value={contentGoal} onChange={event => setContentGoal(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-white p-2 text-xs"><option>种草</option><option>询盘</option><option>品牌认知</option><option>活动推广</option></select></label>
              <label className="block text-[10px] font-bold">目标受众<input value={targetAudience} onChange={event => setTargetAudience(event.target.value)} className="mt-1 w-full rounded-lg border border-border p-2 text-xs" /></label>
              <div className="grid grid-cols-2 gap-2"><label className="text-[10px] font-bold">发布平台<select value={platform} onChange={event => setPlatform(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-white p-2 text-xs"><option>TikTok</option><option>Instagram</option><option>YouTube</option><option>Facebook</option></select></label><label className="text-[10px] font-bold">内容语言<select value={contentLanguage} onChange={event => setContentLanguage(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-white p-2 text-xs"><option value="zh">中文</option><option value="en">English</option></select></label></div>
              <label className="block text-[10px] font-bold">强调卖点<textarea value={sellingPoints} onChange={event => setSellingPoints(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-border p-2 text-xs" /></label>
              <div className="grid grid-cols-2 gap-2"><label className="text-[10px] font-bold">期望时长<input type="number" min={5} max={300} value={desiredDuration} onChange={event => setDesiredDuration(Number(event.target.value) || 20)} className="mt-1 w-full rounded-lg border border-border p-2 text-xs" /></label><label className="text-[10px] font-bold">表达语气<input value={tone} onChange={event => setTone(event.target.value)} className="mt-1 w-full rounded-lg border border-border p-2 text-xs" /></label></div>
              <label className="block text-[10px] font-bold">CTA<input value={callToAction} onChange={event => setCallToAction(event.target.value)} placeholder={enterpriseCtas[0] || '例如：私信获取产品目录'} className="mt-1 w-full rounded-lg border border-border p-2 text-xs" /></label>
              <label className="block text-[10px] font-bold">禁止表达<input value={prohibitedClaims} onChange={event => setProhibitedClaims(event.target.value)} className="mt-1 w-full rounded-lg border border-border p-2 text-xs" /></label>
              <label className="block text-[10px] font-bold">补充说明<textarea value={briefNotes} onChange={event => setBriefNotes(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-border p-2 text-xs" /></label>
            </div>}
            {enterpriseProfileState === 'ready' && enterpriseCtas.length > 0 && <div className="mt-4 rounded-lg border border-border bg-surface-2 p-3">
              <div className="flex items-center gap-2"><Megaphone size={14} /><p className="text-xs font-semibold text-text-primary">CTA · 已从企业知识库读取</p></div>
              {enterpriseCtas.map(cta => <p key={cta} className="mt-1 text-[10px] leading-5 text-text-secondary">{cta}</p>)}
            </div>}
            {enterpriseProfileState === 'ready' && !enterpriseCtas.length && <div className="mt-4 rounded-lg border border-dashed border-amber-200 bg-amber-50/60 p-3">
              <div className="flex items-center gap-2"><Megaphone size={14} className="text-amber-700" /><p className="text-xs font-semibold text-amber-950">尚未设置 CTA</p></div>
              <p className="mt-1 text-[10px] leading-5 text-amber-800">企业社媒策略尚未保存 CTA，填写后后续内容自动复用。</p>
              <button type="button" onClick={() => { try { sessionStorage.setItem('lingshu:enterprise-focus', 'social-strategy'); } catch { /* optional storage */ } window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'enterprise' } })); }} className="mt-2 text-[10px] font-semibold text-amber-800 underline underline-offset-2">前往企业中心填写</button>
            </div>}
            {enterpriseProfileState !== 'ready' && <p className="mt-4 text-[10px] text-text-muted">{enterpriseProfileState === 'loading' ? '正在读取企业 CTA…' : '企业 CTA 暂时无法读取，请稍后重试。'}</p>}

          </div>

        </aside>
      </div>
      <footer className="min-h-[76px] shrink-0 border-t border-border bg-white px-5 py-3"><div className="flex w-full items-center justify-end gap-6">
            {generationNotice && <p role="alert" className="mb-3 text-xs text-amber-700">{generationNotice}</p>}
            {/* GENERATION_INTEGRATION_GAP: the server calculates estimatedCostCny only
                after a task plan exists; there is no preflight quote endpoint yet. */}
            {isReplication && <div className="flex items-center gap-3 text-[11px]"><span className="text-text-muted">预计消耗</span><span className="font-semibold text-text-primary" title="生成任务建立后由服务端返回真实预估">待生成服务核算</span></div>}
            <button type="button" disabled={submitting || generatingSpeech || productSelectionLoading || (!isReplication && (!selectedProductIds.length || (freeLines.length > 0 && !freeReady))) || (isReplication && (!productsReady || !confirmedSpeech.length || (speechGenerated && confirmedSpeech.some(line => !line.draft.trim()))))} onClick={() => { if (isReplication && !speechGenerated) void generateSpeech(); else void startGeneration(); }} className="flex min-w-[220px] items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-none hover:bg-[#245644] disabled:cursor-not-allowed disabled:bg-slate-300">
              {submitting || generatingSpeech ? <Loader2 size={16} className="animate-spin" /> : <Film size={16} />}{submitting ? '正在处理…' : generatingSpeech ? '正在生成英文口播' : isReplication ? speechGenerated ? '确认口播，进入分镜匹配' : '生成口播' : freeScriptText ? '确认口播，进入分镜制作' : 'Gemini 生成逐句口播与分镜'}
            </button>
          </div></footer>
    </section>
  );
}
