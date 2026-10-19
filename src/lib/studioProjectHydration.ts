import type { SocialContentCreateRequest } from '../components/socialContent/SocialContentWorkspace';
import type { Material, StudioProject } from './studioApi';

export function loadedStudioProjectTitle(
  project: Pick<StudioProject, 'id' | 'title' | 'status'>,
  request?: Pick<SocialContentCreateRequest, 'continueProjectId' | 'prefill'> | null,
): string {
  if (project.status === 'template') return `${project.title} · 副本`;
  if (request?.continueProjectId !== project.id) return project.title;
  return request.prefill?.title?.trim() || project.title;
}

export function loadedStudioContinuationStep(
  projectId: string | null,
  request?: Pick<SocialContentCreateRequest, 'continueProjectId' | 'replicationStep' | 'confirmedSpeech'> | null,
  compiledStoryboardReady = false,
): 'mode' | 'material' | 'preview' | null {
  const requestedProjectId = request?.continueProjectId?.trim() || null;
  if (!request || requestedProjectId !== projectId) return null;
  if (request.replicationStep === 1) return 'mode';
  if (request.replicationStep !== 2 && request.replicationStep !== 3) return null;
  if (request.replicationStep === 3) return compiledStoryboardReady ? 'preview' : 'mode';
  if (request.confirmedSpeech?.length) return 'mode';
  return compiledStoryboardReady ? 'material' : 'mode';
}

export function safeStudioStepId(
  steps: ReadonlyArray<{ id: string }>,
  requestedIndex: number,
  fallback = 'mode',
): string {
  if (!steps.length) return fallback;
  const normalizedIndex = Number.isFinite(requestedIndex) ? Math.trunc(requestedIndex) : 0;
  return steps[Math.max(0, Math.min(normalizedIndex, steps.length - 1))]?.id || steps[0]?.id || fallback;
}

export const probeStudioMedia = (file: File) => new Promise<{ duration: number; width: number; height: number }>(resolve => {
  if (file.type.startsWith('image')) {
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(image.src); resolve({ duration: 0, width: image.naturalWidth, height: image.naturalHeight }); };
    image.onerror = () => resolve({ duration: 0, width: 0, height: 0 });
    image.src = URL.createObjectURL(file);
    return;
  }
  if (!file.type.startsWith('video')) { resolve({ duration: 0, width: 0, height: 0 }); return; }
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.onloadedmetadata = () => {
    URL.revokeObjectURL(video.src);
    resolve({ duration: Math.round(video.duration) || 0, width: video.videoWidth || 0, height: video.videoHeight || 0 });
  };
  video.onerror = () => resolve({ duration: 0, width: 0, height: 0 });
  video.src = URL.createObjectURL(file);
});

export const probeStudioAudioDuration = (file: File) => new Promise<number>(resolve => {
  if (!file.type.startsWith('audio')) { resolve(0); return; }
  const audio = document.createElement('audio');
  audio.preload = 'metadata';
  audio.onloadedmetadata = () => {
    const measured = Number.isFinite(audio.duration) ? Number(audio.duration.toFixed(3)) : 0;
    URL.revokeObjectURL(audio.src);
    resolve(measured);
  };
  audio.onerror = () => resolve(0);
  audio.src = URL.createObjectURL(file);
});

export const probeStudioClipAspect = (clip: { type: string; url?: string; poster?: string }) => new Promise<{ width: number; height: number }>(resolve => {
  const source = clip.type === 'image' ? clip.url : (clip.poster || clip.url);
  if (!source || clip.type === 'audio') { resolve({ width: 0, height: 0 }); return; }
  if (clip.type === 'image' || clip.poster) {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve({ width: 0, height: 0 });
    image.src = source;
    return;
  }
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.onloadedmetadata = () => resolve({ width: video.videoWidth, height: video.videoHeight });
  video.onerror = () => resolve({ width: 0, height: 0 });
  video.src = source;
});

export const studioMaterialToClip = (material: Material) => ({
  id: material.id, name: material.name, folder: material.folder, type: material.type, duration: material.duration, width: material.width, height: material.height, aspectRatio: material.aspectRatio, size: material.size, url: material.url, poster: material.poster, scope: material.scope ?? 'own',
  usage: material.usage, sourceType: material.sourceType, providerTaskId: material.providerTaskId, contentSha256: material.contentSha256, industry: material.industry, shotFunction: material.shotFunction, applicability: material.applicability, tags: material.tags,
  generation: material.generation, lineage: material.lineage, quality: material.quality, reuse: material.reuse, rightsScope: material.rightsScope, provenance: material.provenance,
  productId: material.productId, productName: material.productName,
  transcript: material.transcript, transcriptCues: material.transcriptCues, transcriptCuesProvenance: material.transcriptCuesProvenance,
  transcriptSourceHash: material.transcriptSourceHash,
  segmentAnalysisStatus: material.segmentAnalysisStatus, segmentAnalysisError: material.segmentAnalysisError, segments: material.segments, visualObservations: material.visualObservations,
});
