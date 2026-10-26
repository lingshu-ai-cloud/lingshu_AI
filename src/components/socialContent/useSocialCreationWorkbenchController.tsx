import { getScrollBehavior } from '../../lib/usePrefersReducedMotion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { App as AntApp } from 'antd';
import type { SocialContentCreationPath } from '../../lib/socialContentModel';
import { studioApi, type Material, type StudioScriptResult } from '../../lib/studioApi';
import { socialContentApi } from '../../lib/socialContentApi';
import type { SocialContentStageProfile } from '../../lib/socialContentStage';
import { authHeader } from '../../lib/auth';
import { referenceBrandTerm, referenceProductMentions, referenceProductTerms, replaceReferenceIdentities, spokenIdentityLabel } from '../../lib/referenceIdentityMapping';
import { referenceSpeechLines, type ReferenceSpeechLine } from './referenceSpeechLines';
import { groupSpeechShots, type SpeechGroup, timeRange } from './speechShotGroups';
import { normalizeFreeCreationState, type FreeCreationState, type FreeCreationShotType } from '../../../shared/contracts/freeCreationProject';
import { assignReplicationDefaultProduct, parseFreeCreationScript, resolveReplicationProductMappings, serializeFreeCreationLines, type EnterpriseProductOption, type FreeCreationLine } from './socialCreationDraft';
import { shotStart } from './socialCreationWorkbenchTime';
import { resolveStudioProductOption } from '../studio/studioProductSelection';
import { useSocialProductMaterials } from './useSocialProductMaterials';
import type { SocialCreationWorkbenchSeed, SocialCreationWorkbenchSubmit } from './SocialCreationWorkbench';

export function useSocialCreationWorkbenchController({
  mode,
  seed,
  stageProfile,
  onGenerate,
}: {
  mode: SocialContentCreationPath;
  seed?: SocialCreationWorkbenchSeed;
  stageProfile?: SocialContentStageProfile;
  onGenerate: (request: SocialCreationWorkbenchSubmit) => void | Promise<void>;
}) {
  const { message } = AntApp.useApp();
  const isReplication = mode === 'viral_replication';
  const draftStorageKey = seed?.assistantEntry ? `lingshu:free-creation-draft-id:${seed.assistantEntry.id}` : 'lingshu:free-creation-draft-id';
  const initialDraftTitle = seed?.draftTitle?.trim()
    || (isReplication ? '爆款复刻 · 未命名草稿' : '自由创作 · 未命名草稿');
  const [products, setProducts] = useState<EnterpriseProductOption[]>([]);
  const [productId, setProductId] = useState('');
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [replicationMaterialProductIds, setReplicationMaterialProductIds] = useState<string[]>([]);
  const productMaterials = useSocialProductMaterials(isReplication ? replicationMaterialProductIds : selectedProductIds, products.length > 0);
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
  const [freeScriptText, setFreeScriptText] = useState(seed?.creationDialoguePlan?.narrations.find(row => row.id === seed.creationDialoguePlan?.selection.narrationId)?.text || '');
  const [freeGeneration, setFreeGeneration] = useState<StudioScriptResult | null>(null);
  const [freeHookMaterial, setFreeHookMaterial] = useState<Material | null>(null);
  const [aiHookCandidate, setAiHookCandidate] = useState<Material | null>(null);
  const [aiHookFrame, setAiHookFrame] = useState<Material | null>(null);
  const [aiHookPhase, setAiHookPhase] = useState<'idle' | 'saving' | 'frame' | 'video' | 'ready' | 'failed'>('idle');
  const [aiHookError, setAiHookError] = useState('');
  const [aiHookEstimatedCost, setAiHookEstimatedCost] = useState(0);
  const aiHookRequestRef = useRef<{ frame: string; video: string } | null>(null);
  // Keep task creation idempotent across retries of the same workbench session.
  // The operation key also includes the saved draft/title/path, so another
  // workbench submission still receives its own durable task.
  const submissionRequestIdRef = useRef(Date.now());
  const [freeLines, setFreeLines] = useState<FreeCreationLine[]>([]);
  const [hookMode, setHookMode] = useState<'none' | 'upload' | 'library' | 'ai'>('none');
  const [hookChooserOpen, setHookChooserOpen] = useState(mode !== 'viral_replication' && !seed?.creationDialoguePlan);
  const [libraryHooks, setLibraryHooks] = useState<Material[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [draftProjectId, setDraftProjectId] = useState('');
  const [draftTitle, setDraftTitle] = useState(initialDraftTitle);
  const [draftTitleStatus, setDraftTitleStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const draftTitleEditedRef = useRef(false);
  const lastSavedDraftTitleRef = useRef(initialDraftTitle);
  const draftSaveTimer = useRef<number>(0);
  const draftCreationRef = useRef<Promise<string> | null>(null);
  const draggedFreeLineIndex = useRef<number | null>(null);
  const [contentGoal, setContentGoal] = useState('种草');
  const [targetAudience, setTargetAudience] = useState('海外目标客户');
  const platformLabel: Record<string, string> = { tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube', facebook: 'Facebook' };
  const [platform, setPlatform] = useState(platformLabel[seed?.assistantEntry?.platforms[0] || ''] || 'TikTok');
  const [contentLanguage, setContentLanguage] = useState('zh');
  const [sellingPoints, setSellingPoints] = useState('');
  const [desiredDuration, setDesiredDuration] = useState(seed?.assistantEntry?.targetDurationSeconds ?? 20);
  const [tone, setTone] = useState('专业、自然');
  const [callToAction, setCallToAction] = useState('');
  const [prohibitedClaims, setProhibitedClaims] = useState('');
  const [briefNotes, setBriefNotes] = useState([seed?.assistantEntry?.objective, seed?.creationDialoguePlan?.gaps.join('；')].filter(Boolean).join('；'));
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
  const [taskPresenterAssetId, setTaskPresenterAssetId] = useState('');
  const [generationNotice, setGenerationNotice] = useState('');
  useEffect(() => {
    const key = 'social-creation-generation';
    if (!generationNotice) {
      message.destroy(key);
      return;
    }
    void message.open({
      key,
      type: /失败|无法|错误|必须|请先/.test(generationNotice)
        ? 'warning'
        : /正在/.test(generationNotice) ? 'loading' : 'success',
      content: generationNotice,
      duration: /正在/.test(generationNotice) ? 0 : 3,
    });
  }, [generationNotice, message]);
  useEffect(() => () => message.destroy('social-creation-generation'), [message]);
  const [speechEdits, setSpeechEdits] = useState<Record<number, string>>({});
  const [generatedSpeech, setGeneratedSpeech] = useState<string[] | null>(null);
  const [generatedMappingKey, setGeneratedMappingKey] = useState<string | null>(null);
  const restoredSpeechRef = useRef<string>('');
  const restoredMaterialSourceRef = useRef('');
  useEffect(() => {
    if (!seed?.productMaterialSelection) return;
    productMaterials.restore({ selected: seed.productMaterialSelection.selectedIds, productMaterialSelection: seed.productMaterialSelection });
  }, [seed?.productMaterialSelection]);
  const [spokenNames, setSpokenNames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!seed?.confirmedSpeech?.length) return;
    setSpeechEdits(Object.fromEntries(seed.confirmedSpeech.map((line, index) => [index, line.draft])));
  }, [seed?.confirmedSpeech]);
  const uploadRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!isReplication && !seed?.creationDialoguePlan) setHookChooserOpen(true);
  }, [isReplication, seed?.creationDialoguePlan]);
  useEffect(() => {
    const nextTitle = seed?.draftTitle?.trim();
    if (!nextTitle || draftTitleEditedRef.current) return;
    setDraftTitle(nextTitle);
    lastSavedDraftTitleRef.current = nextTitle;
    setDraftTitleStatus('idle');
  }, [seed?.draftTitle]);
  useEffect(() => {
    const projectId = String(seed?.continueProjectId || '').trim();
    if (!isReplication || !projectId) return undefined;
    let active = true;
    void studioApi.getProject(projectId).then(project => {
      if (!active) return;
      if (restoredMaterialSourceRef.current !== `project:${projectId}`) { productMaterials.restore(project.spec); restoredMaterialSourceRef.current = `project:${projectId}`; }
      if (draftTitleEditedRef.current || !project.title.trim()) return;
      setDraftTitle(project.title.trim());
      lastSavedDraftTitleRef.current = project.title.trim();
      setDraftTitleStatus('saved');
    }).catch(() => {
      // The prefilled title remains editable even when a continued project
      // cannot be read yet; the generation transition will retry persistence.
    });
    return () => { active = false; };
  }, [isReplication, seed?.continueProjectId]);
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
      const storedId = (() => { try { return localStorage.getItem(draftStorageKey) || ''; } catch { return ''; } })();
      if (storedId) {
        const existing = (await studioApi.listProjects()).find(item => item.id === storedId && item.status === 'draft' && item.spec?.freeCreation);
        if (existing) {
          studioApi.adoptProjectRevision(existing);
          const restored = normalizeFreeCreationState(existing.spec.freeCreation);
          productMaterials.restore(existing.spec);
          setSelectedProductIds(restored.brief.productIds); setContentGoal(['种草', '询盘', '品牌认知', '活动推广'].includes(restored.brief.goal) ? restored.brief.goal : '种草'); setTargetAudience(restored.brief.audience || '海外目标客户');
          setPlatform(platformLabel[restored.brief.platform] || restored.brief.platform || 'TikTok'); setContentLanguage(restored.brief.language || 'zh'); setSellingPoints(restored.brief.sellingPoints);
          setDesiredDuration(restored.brief.durationSeconds); setTone(restored.brief.tone || '专业、自然'); setCallToAction(restored.brief.cta);
          setProhibitedClaims(restored.brief.prohibitedClaims); setBriefNotes(restored.brief.notes || seed?.assistantEntry?.objective || ''); setHookMode(restored.hookSource);
          const restoredLines: FreeCreationLine[] = restored.script.lines.map(line => ({ id: line.id, time: `${line.start}–${line.end}s`, speech: line.narration, visual: line.visualIntent, shotType: line.shotType === 'presenter' ? '真人口播' : line.shotType === 'factory' ? '工厂' : line.shotType === 'consumer_demo' ? 'D to C' : '产品', silent: line.silent, hook: line.primaryHook }));
          setFreeLines(restoredLines); setFreeScriptText(String(existing.spec.script || serializeFreeCreationLines(restoredLines)));
          const kickoff = existing.spec.videoKickoff as { initialGeneration?: StudioScriptResult; generatedVideo?: { material?: Material } } | undefined;
          setFreeGeneration(kickoff?.initialGeneration || null);
          setFreeHookMaterial(kickoff?.generatedVideo?.material || null);
          if (!draftTitleEditedRef.current && existing.title.trim()) {
            setDraftTitle(existing.title.trim());
            lastSavedDraftTitleRef.current = existing.title.trim();
          }
          setDraftProjectId(existing.id);
          return existing.id;
        }
      }
      const result = await studioApi.saveProject({
        title: draftTitle.trim() || '自由创作 · 未命名草稿', status: 'draft',
        spec: { creationPath: 'free_creation', mode: 'material', contentMode: 'video', manualWorkflow: true, freeCreation: freeCreationState },
      });
      const id = result.ok ? result.project?.id || '' : '';
      if (id) { setDraftProjectId(id); try { localStorage.setItem(draftStorageKey, id); } catch { /* navigation hint only */ } }
      return id;
    })().catch(() => '');
  }, [isReplication]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isReplication || productMaterials.loading || productMaterials.error) return;
    window.clearTimeout(draftSaveTimer.current);
    setDraftTitleStatus('saving');
    draftSaveTimer.current = window.setTimeout(() => {
      void (async () => {
        const id = draftProjectId || await draftCreationRef.current || '';
        if (!id) { setDraftTitleStatus('error'); return; }
        const title = draftTitle.trim() || '自由创作 · 未命名草稿';
        const productName = selectedFreeProducts.map(item => item.name).join('、');
        const saved = await studioApi.saveProject({ id, title, status: 'draft', spec: {
          creationPath: 'free_creation', mode: 'material', contentMode: 'video', manualWorkflow: true,
          freeCreation: freeCreationState, script: freeScriptText, duration: desiredDuration,
          selectedProductIds, productId: selectedFreeProducts[0]?.id || '', productInfo: productName, ...productMaterials.selectionSpec,
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
        if (saved.ok) lastSavedDraftTitleRef.current = title;
        setDraftTitleStatus(saved.ok ? 'saved' : 'error');
      })().catch(() => setDraftTitleStatus('error'));
    }, 600);
    return () => window.clearTimeout(draftSaveTimer.current);
  }, [desiredDuration, draftProjectId, draftTitle, freeCreationState, freeGeneration, freeHookMaterial, freeScriptText, isReplication, selectedFreeProducts, selectedProductIds, productMaterials.selectionSpec, productMaterials.loading, productMaterials.error]);
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
        const product = mapping && resolveStudioProductOption({ id: mapping.productId, name: mapping.productName },
          products.map(item => ({ id: item.id, label: item.name, info: '' })));
        if (product) next[slot.shotId] = product.id;
      }
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
  }, [seed?.productMappings, products, productSelectionChanged, JSON.stringify(productSlots)]);
  useEffect(() => {
    if (!seed?.productMappings?.length || !products.length) return;
    const options = products.map(item => ({ id: item.id, label: item.name, info: '' }));
    const mapped = seed.productMappings.map(mapping => resolveStudioProductOption({ id: mapping.productId, name: mapping.productName }, options)?.id).filter((id): id is string => Boolean(id));
    setSelectedProductIds(current => [...new Set([...current, ...mapped])]);
  }, [seed?.productMappings, products]);
  const primaryProductId = productId || selectedProductIds[0] || '';
  const primaryProduct = products.find(item => item.id === primaryProductId);
  const productMappings = resolveReplicationProductMappings(productSlots, products, primaryProductId, productAssignments);
  const mappedProductIdsKey = JSON.stringify([...new Set([...productMappings.map(item => item.productId), ...(!productSelectionChanged ? selectedProductIds : [])].filter(Boolean))]);
  useEffect(() => { if (isReplication) setReplicationMaterialProductIds(JSON.parse(mappedProductIdsKey)); }, [isReplication, mappedProductIdsKey]);
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
      if (!active) return;
      if (!seed.continueProjectId && restoredMaterialSourceRef.current !== `task:${initial.taskId}`) {
        if (initial.brief.productMaterialSelection) productMaterials.restore({ selected: initial.brief.productMaterialSelection.selectedIds, productMaterialSelection: initial.brief.productMaterialSelection });
        if (initial.brief.productIds?.length) { setSelectedProductIds(initial.brief.productIds); setProductId(initial.brief.productIds[0]); }
        restoredMaterialSourceRef.current = `task:${initial.taskId}`;
      }
      let task = initial;
      if (!refreshed && initial.referenceVideoAnalysis?.status !== 'ready') {
        refreshed = true;
        task = await socialContentApi.refreshReference(initial.taskId, initial.version).catch(() => initial);
      }
      if (!active || task.referenceVideoAnalysis?.status !== 'ready') return;
      window.clearInterval(timer);
      setTaskPresenterAssetId(task.brief.presenterAssetId || task.brief.requestedPresenterAssetId || '');
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
        const options = items.map(item => ({ id: item.id, label: item.name, info: '' }));
        const seeded = resolveStudioProductOption({ id: seed?.productId, name: seed?.productName }, options);
        setProductId(current => items.some(item => item.id === current) ? current : seeded?.id || '');
        setSelectedProductIds(current => {
          const retained = current.filter(id => items.some(item => item.id === id));
          const requested = seed?.selectedProductIds?.length
            ? seed.selectedProductIds.map(id => ({ id }))
            : (seed?.selectedProductNames || []).map(name => ({ name }));
          const mapped = [...requested.map(reference => resolveStudioProductOption(reference, options)?.id),
            ...(seed?.productMappings || []).map(mapping => resolveStudioProductOption({ id: mapping.productId, name: mapping.productName }, options)?.id)].filter((id): id is string => Boolean(id));
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
    if (productMaterials.loading || productMaterials.error) {
      setGenerationNotice(productMaterials.error || '正在读取产品素材，请稍后再试。');
      return;
    }
    setSubmitting(true); setGenerationNotice('');
    try {
      const presenterAssetId = isReplication ? seed?.presenterAssetId || taskPresenterAssetId : '';
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
            title: draftTitle.trim() || '自由创作 · 未命名草稿', status: 'draft',
            spec: {
              creationPath: 'free_creation', mode: 'material', contentMode: 'video', manualWorkflow: true,
              freeCreation: confirmedFreeState, script: freeScriptText, duration: desiredDuration,
              selectedProductIds, productId: selectedFreeProducts[0]?.id || '', productInfo: productName, ...productMaterials.selectionSpec,
              videoKickoff: { source: hookMode === 'ai' ? 'ai_generated_hook' : 'material_library', productInfo: productName, script: freeScriptText, initialGeneration: freeGeneration || undefined, generatedVideo: freeHookMaterial ? { id: freeHookMaterial.id, title: freeHookMaterial.name, url: freeHookMaterial.url, poster: freeHookMaterial.poster, duration: freeHookMaterial.duration, material: freeHookMaterial } : undefined, materialRole: freeHookMaterial ? 'hook' : undefined },
            },
          });
          if (!saved.ok) throw new Error(saved.error || '自由创作草稿保存失败，请重试');
          lastSavedDraftTitleRef.current = saved.project?.title || draftTitle.trim();
          setDraftTitleStatus('saved');
          setDraftProjectId(resolvedDraftProjectId);
        }
      }
      // GENERATION_INTEGRATION_GAP: the current task contract accepts shared files plus
      // selected sentence indexes, but not a durable sentence-to-asset mapping yet.
      await onGenerate({
        replicationStep: isReplication ? replicationStep : undefined,
        confirmedSpeech: isReplication && !navigationOnly ? confirmedSpeech : undefined,
        initialScript: !isReplication ? freeScriptText : undefined,
        initialGeneration: !isReplication ? freeGeneration || undefined : undefined,
        draftProjectId: isReplication ? seed?.continueProjectId : resolvedDraftProjectId,
        requestId: submissionRequestIdRef.current,
        creationPath: mode,
        title: draftTitle.trim() || (isReplication ? '爆款复刻 · 未命名草稿' : '自由创作 · 未命名草稿'),
        productId: isReplication ? productMappings[0]?.productId || '' : selected?.id || '',
        productName,
        platforms: [platform.toLowerCase()],
        productMappings: isReplication ? productMappings : selectedFreeProducts.map(item => ({ sourceTerm: item.name, productId: item.id, productName: item.name })),
        brandMapping: enterpriseBrandName ? { sourceTerm: brandSourceTerm.trim(), brandName: enterpriseBrandName } : undefined,
        presenterAssetId,
        files,
        uploadedMaterials,
        selectedProductMaterials: productMaterials.selectedMaterials,
        productMaterialSelection: productMaterials.selectionSpec.productMaterialSelection,
        referenceLinks: [...new Set([...(seed?.referenceLinks || []), ...uploadedMaterials.map(item => item.url).filter(Boolean)])],
        callToAction: '',
        specialRequirements: isReplication ? '已确认口播文本；分镜匹配时制作数字人口播镜头，成片渲染时生成统一配音。' : `人工自由创作；用户需求：${briefNotes}；钩子来源：${hookMode}；允许无口播分镜；由 Gemini 依据企业产品资料生成逐句口播及后续分镜。`,
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
      const saved = await studioApi.saveProject({ id, title: draftTitle.trim() || '自由创作 · 未命名草稿', status: 'draft', spec: {
        creationPath: 'free_creation', mode: 'material', contentMode: 'video', manualWorkflow: true,
        freeCreation: { ...freeCreationState, hookSource: 'ai', hookMaterialId: '' }, script: freeScriptText, duration: desiredDuration,
        selectedProductIds, productId: selectedFreeProducts[0]?.id || '', productInfo: productName, ...productMaterials.selectionSpec,
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
  const updateDraftTitle = (value: string) => {
    draftTitleEditedRef.current = true;
    setDraftTitle(value);
    setDraftTitleStatus(isReplication ? 'idle' : 'saving');
  };
  const commitDraftTitle = async () => {
    const normalized = draftTitle.trim().slice(0, 120);
    if (!normalized) {
      setDraftTitle(lastSavedDraftTitleRef.current);
      setDraftTitleStatus('error');
      return;
    }
    if (normalized !== draftTitle) setDraftTitle(normalized);
    if (!isReplication) return;
    const projectId = String(seed?.continueProjectId || '').trim();
    if (!projectId) {
      lastSavedDraftTitleRef.current = normalized;
      setDraftTitleStatus('saved');
      return;
    }
    setDraftTitleStatus('saving');
    try {
      const current = await studioApi.getProject(projectId);
      const saved = await studioApi.saveProject({
        id: current.id,
        title: normalized,
        status: current.status,
        spec: current.spec,
        thumbSeed: current.thumbSeed,
        baseUpdatedAt: current.updatedAt,
      });
      if (!saved.ok) throw new Error(saved.error || '草稿名称保存失败');
      lastSavedDraftTitleRef.current = saved.project?.title || normalized;
      setDraftTitle(saved.project?.title || normalized);
      setDraftTitleStatus('saved');
    } catch {
      setDraftTitleStatus('error');
    }
  };
  const freeReady = selectedProductIds.length > 0 && Boolean(contentGoal.trim()) && Boolean(targetAudience.trim()) && freeLines.length > 0
    && freeLines.every(line => line.visual.trim() && (line.silent || line.speech.trim())) && freeLines.filter(line => line.hook).length === 1;
  return {
    isReplication, products, productId, setProductId, selectedProductIds, setSelectedProductIds, setProductAssignments,
    setProductSelectionChanged, productSelectorOpen, setProductSelectorOpen, setManualProductTerms, newProductTerm, setNewProductTerm, enterpriseBrandName,
    enterpriseCtas, enterpriseProfileState, productsLoading, productsUnavailable, submitting, generatingSpeech, files,
    setFiles, freeScriptText, setFreeScriptText, setFreeGeneration, freeHookMaterial, setFreeHookMaterial, aiHookCandidate,
    aiHookFrame, aiHookPhase, aiHookError, aiHookEstimatedCost, freeLines, setFreeLines, hookMode,
    setHookMode, hookChooserOpen, setHookChooserOpen, libraryHooks, libraryLoading, draftTitle, draftTitleStatus,
    draggedFreeLineIndex, contentGoal, setContentGoal, targetAudience, setTargetAudience, platform, setPlatform,
    contentLanguage, setContentLanguage, sellingPoints, setSellingPoints, desiredDuration, setDesiredDuration, tone,
    setTone, callToAction, setCallToAction, prohibitedClaims, setProhibitedClaims, briefNotes, setBriefNotes,
    activeLine, setActiveLine, expandedSpeechLines, setExpandedSpeechLines, requestedSeek, setRequestedSeek, seekRequestId,
    setSeekRequestId, cardsRef, cardListRef, resolvedReferenceUrl, setResolvedReferenceUrl, setGenerationNotice, speechEdits,
    setSpeechEdits, generatedSpeech, uploadRef, selectedFreeProducts, referenceShots, referenceLines, script,
    productSlots, productMentions, primaryProductId, primaryProduct, productMappings, productsReady, productSelectionLoading,
    chooseDefaultProduct, speechGenerated, confirmedSpeech, generateSpeech, highlightSpeech, syncPlaybackCard, previewUrl,
    startGeneration, commitFreeLines, regenerateFreeLine, generateAiHook, adoptAiHook, chooseHookMode, updateDraftTitle,
    commitDraftTitle, freeReady, productMaterials, replicationMaterialProductIds,
  };
}
