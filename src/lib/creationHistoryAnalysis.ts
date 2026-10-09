import { benchmarkTimeRange, benchmarkMaterialType, benchmarkShotRole, buildBenchmarkAnalysis, recordOf, type BenchmarkAnalysis } from '../../shared/benchmarkAnalysis';

export function creationHistoryAnalysis(spec: Record<string, unknown>, authoritative?: BenchmarkAnalysis): { reference: BenchmarkAnalysis; hook: { visual: string; dialogue: string; source: string }; slots: Record<string, unknown>[] } {
  const results = recordOf(spec.analysisResults);
  const kickoff = recordOf(spec.videoKickoff);
  const video = recordOf(kickoff.video);
  const reference = recordOf(results.reference || kickoff.referenceAnalysis);
  const details = (Array.isArray(reference.details) ? reference.details : []).map(raw => {
    const saved = recordOf(raw);
    const range = benchmarkTimeRange(saved.time || saved.timestamp);
    const source = range && authoritative?.shots.find(shot => shot.start === range.start && shot.end === range.end);
    // Only restore metadata from the same inherited time span; preserve draft structure and explicit tags.
    const detail = source ? { ...source.detailedAnalysis, environment: source.environment, shot: source.framing,
      camera: source.camera, audio: source.audio, authenticity: source.authenticity, visual: source.visual,
      dialogue: source.dialogue, onScreenText: source.onScreenText, purpose: source.purpose,
      materialEvidence: { firstFrameRef: source.firstFrameRef, clipRef: source.clipRef },
      ...saved,
      materialType: benchmarkMaterialType(saved.materialType) === 'unknown' ? source.materialType : saved.materialType,
      narrativeRole: benchmarkShotRole(saved.narrativeRole) === 'unknown' ? source.narrativeRole : saved.narrativeRole,
      classificationEvidence: saved.classificationEvidence || source.classificationEvidence,
    } : saved;
    const evidence = recordOf(detail.materialEvidence);
    return { ...detail, materialEvidence: { ...evidence, firstFrameRef: evidence.firstFrameRef || detail.firstFrameRef, clipRef: evidence.clipRef || detail.clipRef } };
  });
  const analysis = buildBenchmarkAnalysis({
    videoId: typeof video.referenceRecordId === 'string' ? video.referenceRecordId : '',
    duration: Number(video.duration),
    analysis: { gemini: { scriptDetails15s: details }, analysisMode: 'inherited' },
  });
  const storyboard = recordOf(results.storyboard);
  const slots = (Array.isArray(storyboard.slots) ? storyboard.slots : []).map(recordOf);
  const first = slots[0];
  const shots = recordOf(results.shots);
  const shootingSlots = Array.isArray(spec.shootingSlots) ? spec.shootingSlots : Array.isArray(shots.shootingSlots) ? shots.shootingSlots : [];
  const shooting = shootingSlots.map(recordOf).find(slot => first && slot.slotId === first.id);
  const productionId = shooting?.id || first?.id;
  const productions = recordOf(spec.shotProductions || shots.productions);
  const activeKey = `${String(spec.activeAssemblyId || '')}:${String(productionId || '')}`;
  const production = productions[activeKey] || productions[String(productionId || '')]
    || Object.entries(productions).find(([key]) => productionId && key.endsWith(`:${productionId}`))?.[1];
  const savedHook = recordOf(results.hook);
  const generated = recordOf(kickoff.generatedVideo);
  return { reference: analysis, slots, hook: {
    visual: String(savedHook.visual || first?.detail || generated.title || ''),
    dialogue: String(savedHook.dialogue || recordOf(production).narration || ''),
    source: first || savedHook.visual || savedHook.dialogue ? '本次创作首镜' : generated.title ? '指定开场钩子' : '尚未记录本次创作钩子',
  } };
}
