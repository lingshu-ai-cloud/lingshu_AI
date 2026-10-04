import { StoryboardFirstFrame } from '../studio/StoryboardFirstFrame';
export { StoryboardFirstFrame } from '../studio/StoryboardFirstFrame';
import ReplicationWorkbenchHeader from './ReplicationWorkbenchHeader';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Captions,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Film,
  ImagePlus,
  Loader2,
  Megaphone,
  Music2,
  Sparkles,
  Upload,
  Volume2,
} from 'lucide-react';
import type { SocialContentCreationPath } from '../../lib/socialContentModel';
import { studioApi, type Material } from '../../lib/studioApi';
import { socialContentApi } from '../../lib/socialContentApi';
import type { SocialContentStageProfile } from '../../lib/socialContentStage';
import { resolveInspirationPlaybackUrl } from '../../lib/inspirationVideoPlayback';
import { authHeader } from '../../lib/auth';
import { referenceBrandTerm, referenceProductMentions, referenceProductTerms, replaceReferenceIdentities, spokenIdentityLabel } from '../../lib/referenceIdentityMapping';
import { referenceSpeechLines, type ReferenceSpeechLine } from './referenceSpeechLines';
import { groupSpeechShots, type SpeechGroup, timeRange } from './speechShotGroups';

interface EnterpriseProductOption {
  id: string;
  name: string;
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

const freeScript = [
  '还在为内容拍摄和剪辑反复返工吗？',
  '把你的产品素材放进来，我们会逐句匹配最合适的画面。',
  '你可以随时替换某一句对应的素材，也可以一次选择多句统一调整。',
  '确认口播、字幕和音乐后，就能生成一条完整内容。',
];

function shotStart(time: string): number {
  const start = String(time || '').split(/[–—-]/)[0];
  const clock = start.match(/(\d+):(\d+(?:\.\d+)?)/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const match = start.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

const creationOptions = [
  { id: 'voice', label: '口播', detail: '生成或沿用逐句口播', icon: Megaphone },
  { id: 'caption', label: '字幕', detail: '自动对齐口播字幕', icon: Captions },
  { id: 'sound', label: '音效', detail: '在转场和重点处补充音效', icon: Volume2 },
  { id: 'music', label: '音乐', detail: '匹配内容节奏与情绪', icon: Music2 },
  { id: 'effect', label: '画面特效', detail: '添加转场与重点强调', icon: Sparkles },
] as const;

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
    <div className="relative h-full w-full overflow-hidden bg-[#e9eeeb]">
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
      {status === 'loading' && <div className="absolute inset-0 flex items-center justify-center bg-white/35 backdrop-blur-[1px]"><span className="inline-flex items-center gap-2 rounded-full bg-white/90 px-3 py-2 text-xs font-bold text-[#38594d] shadow-sm"><Loader2 size={14} className="animate-spin" />正在加载视频</span></div>}
      {status === 'error' && <div className="absolute inset-0 flex items-center justify-center bg-white/88 p-6 text-center backdrop-blur-sm"><div><CircleAlert size={24} className="mx-auto text-amber-700" /><p className="mt-2 text-sm font-black text-text-primary">视频暂时无法预览</p><p className="mt-1 max-w-sm text-[11px] leading-5 text-text-muted">{message}</p><button type="button" onClick={() => setAttempt(value => value + 1)} className="mt-3 rounded-lg bg-[#173d31] px-3 py-2 text-xs font-black text-white">重新加载</button></div></div>}
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
      panel.scrollTo({ top: panel.scrollTop + cardBox.top - panelBox.top - 90, behavior: 'smooth' });
    }
  }, [activeLine]);
  const [enabledOptions, setEnabledOptions] = useState(() => new Set(creationOptions.map(item => item.id)));
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
  const script = isReplication ? referenceLines.map(line => line.text) : freeScript;
  const detectedProductSlots = referenceProductTerms(referenceLines.map(line => ({ text: line.text, time: line.time, visual: line.visual })), taskProductTerms);
  const productSlots = [...detectedProductSlots, ...manualProductTerms.filter(term => !detectedProductSlots.some(slot => slot.sourceLabel.toLocaleLowerCase() === term.toLocaleLowerCase()))
    .map((term, index) => ({ shotId: `manual-product-${index}`, sourceLabel: term, time: '', visual: '' }))];
  const productMentions = referenceProductMentions(referenceLines, productSlots.map(slot => slot.sourceLabel));
  useEffect(() => {
    if (!seed?.productMappings?.length || !products.length) return;
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
  }, [seed?.productMappings, products, JSON.stringify(productSlots)]);
  useEffect(() => {
    if (!seed?.productMappings?.length || !products.length) return;
    const mapped = seed.productMappings.map(mapping => products.find(item => item.id === mapping.productId || item.name === mapping.productName)?.id).filter((id): id is string => Boolean(id));
    setSelectedProductIds(current => [...new Set([...current, ...mapped])]);
  }, [seed?.productMappings, products]);
  const explicitlyAssignedIds = new Set(productSlots.map(slot => productAssignments[slot.shotId]).filter(Boolean));
  const availableSelectedIds = selectedProductIds.filter(id => !explicitlyAssignedIds.has(id));
  let nextSelectedIndex = 0;
  const productMappings = productSlots.map(slot => {
    const assigned = productAssignments[slot.shotId];
    const selectedId = Object.prototype.hasOwnProperty.call(productAssignments, slot.shotId)
      ? (selectedProductIds.includes(assigned) ? assigned : '')
      : availableSelectedIds[nextSelectedIndex++] || '';
    const product = products.find(item => item.id === selectedId);
    return { sourceTerm: slot.sourceLabel, productId: product?.id || '', productName: product?.name || '' };
  });
  const productsReady = productMappings.length === selectedProductIds.length
    && productMappings.every(mapping => mapping.productId && mapping.sourceTerm.trim())
    && new Set(productMappings.map(mapping => mapping.productId)).size === productMappings.length;
  const spokenLabel = (sourceTerm: string, catalogName: string, line: string, names = spokenNames) =>
    names[catalogName] || spokenIdentityLabel(sourceTerm, catalogName, line);
  const mappingKey = JSON.stringify({ products: productMappings, brandSourceTerm, enterpriseBrandName, lines: referenceLines.map(line => line.text) });
  useEffect(() => {
    const saved = seed?.confirmedSpeech;
    if (!isReplication || !saved?.length || enterpriseProfileState === 'loading' || !productsReady || !referenceLines.length) return;
    const restoreKey = JSON.stringify([saved, mappingKey]);
    if (restoredSpeechRef.current === restoreKey) return;
    if (saved.length !== referenceLines.length || saved.some((line, index) => line.source.trim() !== referenceLines[index]?.text.trim())) return;
    restoredSpeechRef.current = restoreKey;
    setGeneratedSpeech(saved.map(line => line.draft));
    setGeneratedMappingKey(mappingKey);
  }, [isReplication, seed?.confirmedSpeech, enterpriseProfileState, productsReady, mappingKey, referenceLines]);
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
    if (submitting || productsLoading || (!navigationOnly && isReplication && (!productsReady || !speechGenerated || confirmedSpeech.some(line => !line.draft.trim())))) return;
    setSubmitting(true); setGenerationNotice('');
    try {
      const presenterAssetId = '';
      const uploadedMaterials: Material[] = [];
      for (const file of navigationOnly ? [] : files) {
        const type: Material['type'] = file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'image';
        const result = await studioApi.uploadMaterialFile(file, { folder: 'upload', type, sourceType: 'content-workbench' });
        if (!result.ok || !result.material?.id) throw new Error(result.error || `「${file.name}」上传失败`);
        uploadedMaterials.push(result.material);
      }
      const selected = products.find(item => item.id === productId);
      const productName = isReplication ? productMappings[0]?.productName || (navigationOnly ? seed?.productName || '' : '') : selected?.name || '';
      // GENERATION_INTEGRATION_GAP: the current task contract accepts shared files plus
      // selected sentence indexes, but not a durable sentence-to-asset mapping yet.
      onGenerate({
        replicationStep: isReplication ? replicationStep : undefined,
        confirmedSpeech: isReplication && !navigationOnly ? confirmedSpeech : undefined,
        requestId: Date.now(),
        creationPath: mode,
        title: isReplication
          ? `${productName || seed?.productName || '自动选品'} · 爆款复刻`
          : `${productName || '自由创作'} · 新内容`,
        productId: isReplication ? productMappings[0]?.productId || '' : selected?.id || '',
        productName,
        productMappings: isReplication ? productMappings : [],
        brandMapping: enterpriseBrandName ? { sourceTerm: brandSourceTerm.trim(), brandName: enterpriseBrandName } : undefined,
        presenterAssetId,
        files,
        uploadedMaterials,
        referenceLinks: [...new Set([...(seed?.referenceLinks || []), ...uploadedMaterials.map(item => item.url).filter(Boolean)])],
        callToAction: '',
        specialRequirements: isReplication ? '已确认口播文本；分镜匹配时制作数字人口播镜头，成片渲染时生成统一配音。' : `生成项：${[...enabledOptions].join('、')}`,
        stageProfileId: stageProfile?.id || 'b2b_launch',
        stageLabel: stageProfile?.name || 'B2B 起步验证',
        strategyPresetId: stageProfile?.presetId || 'b2b_starting',
      });
    } catch (error) {
      setGenerationNotice(error instanceof Error ? error.message : '创建任务失败');
      setSubmitting(false);
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col bg-[#f2f7f4]">
      {isReplication ? <ReplicationWorkbenchHeader activeStep={0} onStepChange={index => { if (index > 0 && speechGenerated) void startGeneration(); }} navigationDisabled={submitting || productsLoading || !speechGenerated} title={seed?.referenceTitle} actions={<><button type="button" onClick={onShowCreations} className="rounded-lg border border-border px-3 py-2 text-xs font-bold">我的创作</button><button type="button" onClick={onOpenChooser} className="rounded-lg bg-[#173d31] px-3 py-2 text-xs font-bold text-white">切换制作方式</button></>} /> : (      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-white px-5 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${isReplication ? 'bg-orange-50 text-orange-700' : 'bg-emerald-50 text-emerald-700'}`}>{isReplication ? '爆款复刻' : '自由创作'}</span>
            <span className="text-[10px] font-bold text-text-muted">逐句口播与画面制作台</span>
            {stageProfile&&<span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-black text-slate-500">{stageProfile.name}</span>}
          </div>
          <h1 className="mt-1 truncate text-base font-black text-text-primary">{isReplication ? seed?.referenceTitle || '从爆款参考开始制作' : '创建一条新内容'}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onShowCreations} className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary hover:bg-surface-2">我的创作</button>
          <button type="button" onClick={onOpenChooser} className="inline-flex items-center gap-1.5 rounded-lg bg-[#173d31] px-3 py-2 text-xs font-black text-white hover:bg-[#245644]"><ImagePlus size={14} />切换制作方式</button>
        </div>
      </header>)}


      <div className="social-creation-workbench-layout grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:overflow-hidden">
        <aside className="min-h-0 border-b border-border bg-white lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <div className="sticky top-0 z-10 border-b border-border bg-white px-4 py-4">
            <p className="text-sm font-black text-text-primary">{isReplication ? '口播替换与确认' : '口播内容'}</p>
            <p className="mt-1 text-[11px] leading-5 text-text-muted">{isReplication ? '先在右侧完成产品映射并生成口播，再检查高亮产品词、修改并确认。' : '逐句对应原片分镜，点击定位主视频的对应画面。'}</p>
          </div>
          <ol ref={cardListRef} className="space-y-2 p-3">
            {isReplication && !referenceShots.length && <li className="rounded-xl border border-dashed border-border p-4 text-xs leading-5 text-text-muted">原片分镜和口播尚未完成分析。完成后会在这里逐句显示真实口播与素材首帧。</li>}
            {script.map((line, index) => {
              const active = activeLine === index;
              return <li ref={element => { cardsRef.current[index] = element; }} key={`${index}:${line}`}>
                <button type="button" aria-current={active ? 'step' : undefined} onClick={() => { setActiveLine(index); setSeekRequestId(current => current + 1); setRequestedSeek((referenceLines[index]?.startSeconds ?? shotStart(referenceLines[index]?.time || '')) + 0.05); }} className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition ${active ? 'border-emerald-400 bg-emerald-50 shadow-sm' : 'border-border bg-white hover:border-emerald-200'}`}>
                  {isReplication && <StoryboardFirstFrame source={resolvedReferenceUrl || seed?.referenceMediaUrl} firstFrameRef={referenceLines[index]?.firstFrameRef} time={referenceLines[index]?.firstFrameSeconds ?? shotStart(referenceLines[index]?.time || '')} label={`口播 ${index + 1}`} />}
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[10px] font-black ${active ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-border text-text-muted'}`}>{index + 1}</span>
                  <span className="min-w-0 flex-1"><span className="block text-xs font-bold leading-5 text-text-primary">{line || '该分镜暂无可识别口播'}</span><span className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-text-muted">{isReplication ? referenceLines[index]?.time : `00:${String(index * 4).padStart(2, '0')}–00:${String((index + 1) * 4).padStart(2, '0')}`}<ChevronRight size={11} /></span>{isReplication && referenceLines[index]?.visuals.length > 0 && <span className="mt-1 line-clamp-2 text-[10px] leading-4 text-text-muted">画面：{referenceLines[index].visuals[0]}</span>}</span>
                </button>
                {isReplication && referenceLines[index]?.visualShotCount > 0 && <>
                  <button type="button" aria-expanded={expandedSpeechLines.has(index)} aria-controls={`speech-visual-shots-${index}`} onClick={() => setExpandedSpeechLines(current => {
                    const next = new Set(current);
                    if (next.has(index)) next.delete(index); else next.add(index);
                    return next;
                  })} className="mt-1 flex w-full items-center justify-between rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-left text-[11px] font-bold text-emerald-800">
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
                          <span className="min-w-0 flex-1"><span className="block text-[10px] font-bold text-emerald-800">分镜 {shotIndex + 1} · {shotTime}</span><span className="mt-1 line-clamp-3 text-[10px] leading-4 text-text-secondary">{shot.visual || '画面待分析'}</span></span>
                        </button>
                      </li>;
                    })}
                  </ol>}
                </>}
                {isReplication && line.trim() && speechGenerated && <div className={`mt-2 rounded-lg border p-2 ${productMappings.some(mapping => mapping.sourceTerm && line.toLocaleLowerCase().includes(mapping.sourceTerm.toLocaleLowerCase())) ? 'border-amber-400 bg-amber-50 ring-1 ring-amber-200' : 'border-emerald-100 bg-emerald-50/40'}`}><p className="text-[10px] font-bold text-emerald-800">替换后口播 · 请检查</p><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-text-primary">{highlightSpeech(speechEdits[index] ?? generatedSpeech?.[index] ?? '', line)}</p><label className="mt-2 block text-[10px] font-bold text-emerald-800">编辑口播<textarea aria-label={`第 ${index + 1} 句新口播`} value={speechEdits[index] ?? generatedSpeech?.[index] ?? ''} onChange={event => setSpeechEdits(current => ({ ...current, [index]: event.target.value }))} rows={3} className="mt-1 w-full resize-y rounded-md border border-border bg-white p-2 text-xs font-normal leading-5 text-text-primary" /></label></div>}
              </li>;
            })}
          </ol>
        </aside>

        <main className="flex min-h-[560px] min-w-0 flex-col bg-[#f5f8f5] lg:min-h-0">
          <div className="flex items-center justify-between border-b border-black/5 px-5 py-3">
            <div><p className="text-xs font-black text-text-primary">画面预览</p><p className="mt-0.5 text-[10px] text-text-muted">{isReplication ? `当前对应第 ${activeLine + 1} 句口播` : `当前对应第 ${activeLine + 1} 个分镜`}</p></div>
            {!isReplication && <button type="button" onClick={() => uploadRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-black text-text-secondary shadow-sm"><Upload size={14} />上传素材</button>}
          </div>
          <input ref={uploadRef} type="file" multiple accept="video/*,image/*" className="hidden" onChange={event => setFiles(Array.from(event.currentTarget.files || []))} />
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4 sm:p-5">
            <div className="relative flex h-full min-h-0 max-h-full w-full items-center justify-center overflow-hidden rounded-xl border border-[#dfe5e1] bg-[#eef0f3] shadow-[0_2px_12px_rgba(23,61,49,0.06)]">
              {previewUrl && files[0]?.type.startsWith('video/') ? <video src={previewUrl} controls playsInline preload="metadata" className="h-full w-full object-contain" />
                : previewUrl ? <img src={previewUrl} alt="用户上传素材预览" className="h-full w-full object-contain" />
                : seed?.referenceContentType === 'video' && seed.referenceMediaUrl ? <WorkbenchVideoPreview source={seed.referenceMediaUrl} poster={seed.referenceThumbnail} title={seed.referenceTitle || '爆款视频预览'} seekSeconds={requestedSeek} seekRequestId={seekRequestId} onPlaybackTime={syncPlaybackCard} onResolved={setResolvedReferenceUrl} />
                : seed?.referenceThumbnail ? <img src={seed.referenceThumbnail} alt={isReplication ? '爆款视频预览' : '已选素材预览'} className="h-full w-full object-contain" />
                : <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-8 text-center text-[#294c40]">
                    <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-[#607b71] shadow-sm"><Film size={27} /></span>
                    <div><p className="text-base font-black">{isReplication ? '等待爆款视频' : '暂无预览'}</p><p className="mt-2 text-xs leading-5 text-[#789087]">{isReplication ? '从灵感中心选择爆款后，会在这里显示原视频。' : '先从素材库选择画面，或上传本地视频与图片。'}</p></div>
                    {!isReplication && <div className="flex items-center gap-3"><button type="button" onClick={() => window.dispatchEvent(new CustomEvent('lingshu:open-material-library'))} className="rounded-lg border border-white bg-white px-4 py-2.5 text-xs font-black text-[#38594d] shadow-sm">选择素材</button><button type="button" onClick={() => uploadRef.current?.click()} className="rounded-lg bg-[#173d31] px-4 py-2.5 text-xs font-black text-white shadow-sm">上传素材</button></div>}
                  </div>}
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-black/5 px-5 py-3 text-[11px] text-text-muted"><span>{files.length ? `已上传 ${files.length} 个素材` : isReplication ? '沿用爆款原片素材' : '尚未上传素材'}</span>{!isReplication && <button type="button" onClick={()=>uploadRef.current?.click()} className="font-black text-emerald-700">上传素材</button>}</div>
        </main>

        <aside className="flex min-h-0 flex-col border-t border-border bg-white lg:border-l lg:border-t-0">
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-black text-text-primary">{isReplication ? '产品与品牌替换' : '生成设置'}</p><p className="mt-1 text-[11px] leading-5 text-text-muted">{isReplication ? '确认企业产品映射后，在左侧逐句检查新口播。' : '每一步都由你确认后再生成。'}</p></div></div>

            {isReplication && <div className="mt-4">
              <p className="text-xs font-black text-text-primary">主推产品 · 多选</p>
              <p className="mt-1 text-[10px] leading-4 text-text-muted">原口播产品词共出现 {productMentions.length} 次，去重后有 {productSlots.length} 个替换对象。同一产品重复出现沿用同一映射；请选择 {productSlots.length} 款企业产品。</p>
              <details className="mt-2 text-[10px] text-text-secondary"><summary className="cursor-pointer font-bold">查看识别依据与出现次数</summary><div className="mt-1 space-y-1">{productMentions.map((mention, index) => <p key={`${mention.time}:${index}`}>{index + 1}. {mention.time} · 「{mention.sourceLabel}」：{mention.text}</p>)}<p className="text-text-muted">按口播文本统计；画面中的瓶数、配方数量、重复分镜不计为不同口播产品。产品类别词不能证明具体 SKU 数量。</p></div></details>
              <button type="button" aria-expanded={productSelectorOpen} aria-label="选择企业知识库产品" disabled={productsLoading || submitting} onClick={() => setProductSelectorOpen(value => !value)} className="mt-2 flex h-11 w-full items-center justify-between rounded-xl border border-border bg-white px-3 text-left text-xs font-bold text-text-primary disabled:bg-slate-100">
                <span>{productsLoading ? '正在读取企业产品目录…' : selectedProductIds.length ? `已选 ${selectedProductIds.length}/${productSlots.length} 款产品` : '请选择主推产品'}</span><ChevronRight size={15} className={productSelectorOpen ? 'rotate-90' : ''} />
              </button>
              {productSelectorOpen && <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-xl border border-border bg-white p-2 shadow-sm">
                {products.map(item => <label key={item.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-xs hover:bg-emerald-50">
                  <input type="checkbox" checked={selectedProductIds.includes(item.id)} disabled={submitting || (!selectedProductIds.includes(item.id) && selectedProductIds.length >= productSlots.length)} onChange={event => setSelectedProductIds(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} className="accent-emerald-700" />
                  <span className="min-w-0 truncate">{item.name}</span>
                </label>)}
                {!products.length && <div className="px-2 py-3 text-xs text-text-muted">企业知识库暂无产品。<button type="button" onClick={() => { try { sessionStorage.setItem('lingshu:enterprise-focus', 'products'); } catch { /* optional storage */ } window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'enterprise' } })); }} className="ml-1 font-bold text-emerald-700 underline">前往录入产品</button></div>}
              </div>}
              {productsUnavailable && <p className="mt-2 flex items-center gap-1 text-[10px] text-amber-700"><CircleAlert size={11} />企业产品目录暂时无法读取</p>}
              {productSlots.length > 0 && <section className="mt-3" aria-label="产品映射设置">
                <div className="mb-2 flex items-center justify-between text-[10px] text-text-muted"><span className="font-bold">产品映射 · {productSlots.length} 项</span>{productSlots.length > 2 && <span>上下滚动查看全部</span>}</div>
                <div role="region" aria-label="产品映射列表" tabIndex={0} style={{ maxHeight: 160, overflowY: 'auto', flexShrink: 0 }} className="space-y-2 overscroll-contain pr-1 [scrollbar-gutter:stable]">
              {productSlots.map((slot, index) => <label key={slot.shotId} className="block min-h-[76px] rounded-lg border border-border bg-surface-2 p-2 text-[10px] font-bold text-text-secondary">
                {index + 1}. 原口播「{slot.sourceLabel}」→ 企业产品
                <select aria-label={`原口播产品 ${slot.sourceLabel} 对应企业产品`} value={productMappings[index]?.productId || ''} onChange={event => {
                  const id = event.target.value;
                  const assignments = Object.fromEntries(productSlots.map((item, slotIndex) => [item.shotId, item.shotId === slot.shotId ? id : productMappings[slotIndex]?.productId || '']));
                  setProductAssignments(assignments);
                  setSelectedProductIds([...new Set(Object.values(assignments).filter(Boolean))]);
                }} className="mt-1 w-full rounded-md border border-border bg-white px-2 py-2 text-xs text-text-primary">
                  <option value="">请选择对应产品</option>{products.map(item => <option key={item.id} value={item.id} disabled={productMappings.some((mapping, mappingIndex) => mappingIndex !== index && mapping.productId === item.id)}>{item.name}</option>)}
                </select>
              </label>)}
                </div>
              </section>}
              {!productSlots.length && <p className="mt-2 text-[10px] leading-4 text-amber-700">未从原口播识别到产品词。若原片确有产品名，请在下方补充原词后再选择对应产品。</p>}
              <div className="mt-2 flex gap-1.5"><input aria-label="补充原口播产品词" value={newProductTerm} onChange={event => setNewProductTerm(event.target.value)} placeholder="补充未识别的原产品词" className="min-w-0 flex-1 rounded-md border border-border px-2 py-1.5 text-[10px]" /><button type="button" disabled={!newProductTerm.trim()} onClick={() => { const term = newProductTerm.trim(); if (!script.join(' ').toLocaleLowerCase().includes(term.toLocaleLowerCase())) { setGenerationNotice('补充的产品词必须出现在原片口播中。'); return; } if (!productSlots.some(slot => slot.sourceLabel.toLocaleLowerCase() === term.toLocaleLowerCase())) setManualProductTerms(current => [...current, term]); setNewProductTerm(''); setGenerationNotice(''); }} className="rounded-md border border-border bg-white px-2 text-[10px] font-bold disabled:opacity-40">添加</button></div>
              {productSlots.length > 0 && !productsReady && <p role="status" className="mt-2 text-[10px] font-bold text-amber-700">需选择 {productSlots.length} 款不同的企业产品，并完成一一对应。</p>}
              <div className="mt-3 rounded-lg border border-border bg-surface-2 p-2.5"><p className="text-[10px] font-bold text-text-secondary">企业品牌 · 自动读取</p><p className="mt-1 text-xs text-text-primary">{enterpriseBrandName || '企业知识库尚未填写品牌名称'}</p><p className="mt-1 text-[10px] text-text-muted">新口播使用企业知识库中的品牌信息，无需填写原片品牌名。</p></div>
            </div>}

            {!isReplication && <div className="mt-4 space-y-2">
              {creationOptions.map(item => {
                const Icon = item.icon;
                const checked = enabledOptions.has(item.id);
                const locked = isReplication;
                return <button key={item.id} type="button" disabled={locked} onClick={() => setEnabledOptions(current => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left ${locked ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400' : checked ? 'border-emerald-200 bg-emerald-50/55' : 'border-border bg-white'}`}>
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${locked ? 'bg-white text-slate-400' : 'bg-white text-emerald-700'}`}><Icon size={15} /></span>
                  <span className="min-w-0 flex-1"><span className="block text-xs font-black">{item.label}</span><span className="mt-0.5 block truncate text-[10px] opacity-75">{item.detail}</span></span>
                  <span className={`h-5 w-9 rounded-full p-0.5 ${checked ? locked ? 'bg-slate-300' : 'bg-emerald-600' : 'bg-slate-200'}`}><span className={`block h-4 w-4 rounded-full bg-white transition ${checked ? 'translate-x-4' : ''}`} /></span>
                </button>;
              })}
            </div>}

            {enterpriseProfileState === 'ready' && enterpriseCtas.length > 0 && <div className="mt-4 rounded-xl border border-border bg-surface-2 p-3">
              <div className="flex items-center gap-2"><Megaphone size={14} /><p className="text-xs font-black text-text-primary">CTA · 已从企业知识库读取</p></div>
              {enterpriseCtas.map(cta => <p key={cta} className="mt-1 text-[10px] leading-5 text-text-secondary">{cta}</p>)}
            </div>}
            {enterpriseProfileState === 'ready' && !enterpriseCtas.length && <div className="mt-4 rounded-xl border border-dashed border-amber-200 bg-amber-50/60 p-3">
              <div className="flex items-center gap-2"><Megaphone size={14} className="text-amber-700" /><p className="text-xs font-black text-amber-950">尚未设置 CTA</p></div>
              <p className="mt-1 text-[10px] leading-5 text-amber-800">企业社媒策略尚未保存 CTA，填写后后续内容自动复用。</p>
              <button type="button" onClick={() => { try { sessionStorage.setItem('lingshu:enterprise-focus', 'social-strategy'); } catch { /* optional storage */ } window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'enterprise' } })); }} className="mt-2 text-[10px] font-black text-amber-800 underline underline-offset-2">前往企业中心填写</button>
            </div>}
            {enterpriseProfileState !== 'ready' && <p className="mt-4 text-[10px] text-text-muted">{enterpriseProfileState === 'loading' ? '正在读取企业 CTA…' : '企业 CTA 暂时无法读取，请稍后重试。'}</p>}

          </div>

        </aside>
      </div>
      <footer className="min-h-[76px] shrink-0 border-t border-border bg-white px-5 py-3"><div className="flex w-full items-center justify-end gap-6">
            {generationNotice && <p role="alert" className="mb-3 text-xs text-amber-700">{generationNotice}</p>}
            {/* GENERATION_INTEGRATION_GAP: the server calculates estimatedCostCny only
                after a task plan exists; there is no preflight quote endpoint yet. */}
            {isReplication && <div className="flex items-center gap-3 text-[11px]"><span className="text-text-muted">预计消耗</span><span className="font-black text-text-primary" title="生成任务建立后由服务端返回真实预估">待生成服务核算</span></div>}
            <button type="button" disabled={submitting || generatingSpeech || productsLoading || (isReplication && (!productsReady || !confirmedSpeech.length || (speechGenerated && confirmedSpeech.some(line => !line.draft.trim()))))} onClick={() => { if (isReplication && !speechGenerated) void generateSpeech(); else void startGeneration(); }} className="flex min-w-[220px] items-center justify-center gap-2 rounded-xl bg-[#173d31] px-4 py-3 text-sm font-black text-white shadow-sm hover:bg-[#245644] disabled:cursor-not-allowed disabled:bg-slate-300">
              {submitting || generatingSpeech ? <Loader2 size={16} className="animate-spin" /> : <Film size={16} />}{submitting ? '正在进入创作' : generatingSpeech ? '正在生成英文口播' : isReplication ? speechGenerated ? '确认口播，进入分镜匹配' : '生成口播' : '开始生成'}
            </button>
          </div></footer>
    </section>
  );
}
