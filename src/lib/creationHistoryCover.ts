import { recordOf } from '../../shared/benchmarkAnalysis';
export type CreationCoverSource = { kind: 'video' | 'image'; url: string; time: number };
/** Prefer the finished creation; older drafts retain their first shot or reference cover. */
export function creationHistoryCoverSources(spec: Record<string, unknown>, referenceFirstFrameRef?: string): CreationCoverSource[] {
  const result: CreationCoverSource[] = [];
  const add = (kind: CreationCoverSource['kind'], value: unknown, time = 0) => {
    if (typeof value === 'string' && value.trim() && !result.some(item => item.url === value.trim())) result.push({ kind, url: value.trim(), time });
  };
  for (const value of Object.values(recordOf(spec.languageRenderOutputs))) {
    const output = recordOf(value); if (output.status === 'done') add('video', output.previewUrl);
  }
  add('video', spec.renderOutputPreviewUrl);
  const results = recordOf(spec.analysisResults);
  const firstSlot = recordOf((recordOf(results.storyboard).slots as unknown[] | undefined)?.[0]);
  const firstPlan = recordOf(recordOf(spec.storyboardSourcePlans)[String(firstSlot.id || '')]);
  add('image', firstPlan.firstFrameUrl);
  add('image', spec.firstFrameUrl); add('image', spec.thumbnailUrl);
  const kickoff = recordOf(spec.videoKickoff); const generated = recordOf(kickoff.generatedVideo);
  add('video', generated.url); add('image', generated.poster);
  add('image', referenceFirstFrameRef);
  const reference = recordOf(results.reference || kickoff.referenceAnalysis);
  const shot = recordOf((Array.isArray(reference.details) ? reference.details : [])[0]);
  add('image', shot.firstFrameRef);
  const video = recordOf(kickoff.video); const analysis = recordOf(video.aiAnalysis);
  add('image', analysis.materialPoster); add('image', video.thumbnail);
  add('video', analysis.materialUrl); add('video', video.videoUrl);
  return result;
}
