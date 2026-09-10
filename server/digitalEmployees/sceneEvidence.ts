import fs from 'node:fs';
/** Observations are visual evidence only; names, tags and product facts are not. */
export type EvidenceAsset = {
  id: string; type: 'image' | 'video'; duration: number;
  localPath?: string; objectKey?: string; url?: string;
  visualObservations: string[]; segments?: Array<Record<string, unknown>>;
};
export type EvidenceClip = {
  assetId: string; identity: string; start: number; end: number;
  observations: string[]; segmentId: string; confidence: number;
};
export function mediaIdentity(asset: EvidenceAsset): string {
  if (asset.localPath) { try { return fs.realpathSync(asset.localPath); } catch { return asset.localPath; } }
  return asset.objectKey || asset.url || asset.id;
}
export function observationStrings(segment: Record<string, unknown>): string[] {
  return [segment.observedFacts, segment.action, segment.visual, segment.environment, segment.subject]
    .flatMap(value => Array.isArray(value) ? value : [value])
    .filter((value): value is string => typeof value === 'string' && !!value.trim()).map(value => value.trim());
}
export function evidenceClips(asset: EvidenceAsset): EvidenceClip[] {
  const identity = mediaIdentity(asset);
  if (asset.type === 'image') {
    const observations = asset.visualObservations.filter(value => !/^企业知识库产品.+的已上传(?:视频|图片)$/.test(value));
    return observations.length ? [{ assetId: asset.id, identity, start: 0, end: Infinity, observations, segmentId: `${asset.id}:image`, confidence: 1 }] : [];
  }
  return (asset.segments || []).flatMap((segment, index) => {
    const start = Number(segment.start ?? segment.startTime), end = Number(segment.end ?? segment.endTime);
    const confidence = Number(segment.confidence ?? 0);
    const observations = observationStrings(segment);
    if (segment.needsReview === true || !Number.isFinite(confidence) || confidence < .65 || confidence > 1
      || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start
      || !Number.isFinite(asset.duration) || end > asset.duration + .05 || !observations.length) return [];
    return [{ assetId: asset.id, identity, start, end, observations, segmentId: String(segment.id || `${asset.id}:${index}`), confidence }];
  });
}
const stopWords = new Set(['产品','画面','展示','镜头','环境','特写','全景','近景','product','scene','show','with','the','and','close','shot']);
export function visualEvidenceScore(intent: string, observations: string[]): number {
  const lower = intent.toLowerCase().replace(/产品|画面|展示|镜头|环境|特写|全景|近景/g, ' ');
  const tokens = [...(lower.match(/[a-z][a-z0-9_-]{2,}/g) || []),
    ...[...lower.matchAll(/[\u3400-\u9fff]{2,}/g)].flatMap(m => Array.from({length: m[0].length - 1}, (_, i) => m[0].slice(i, i + 2)))];
  const unique = [...new Set(tokens)].filter(token => !stopWords.has(token));
  const observed = observations.join(' ').toLowerCase();
  return unique.filter(token => observed.includes(token)).length;
}
export function overlaps(a: Pick<EvidenceClip, 'identity' | 'start' | 'end'>, b: Pick<EvidenceClip, 'identity' | 'start' | 'end'>): boolean {
  return a.identity === b.identity && a.start < b.end - .001 && a.end > b.start + .001;
}
export type EvidenceRequest = { sceneIndex: number; intent: string; duration: number; materialId?: string; trimStart?: number };
/** Bounded backtracking reserves scarce clips before a flexible scene can consume them. */
export function allocateEvidenceClips(input: {
  scenes: EvidenceRequest[]; assets: EvidenceAsset[]; excluded?: Array<Pick<EvidenceClip, 'identity' | 'start' | 'end'>>;
}): { plan: Array<EvidenceClip & { sceneIndex: number; score: number }>; gaps: string[] } {
  const pools = input.scenes.map(scene => input.assets.filter(asset => !scene.materialId || asset.id === scene.materialId).flatMap(asset =>
    evidenceClips(asset).flatMap(clip => {
      const score = visualEvidenceScore(scene.intent, clip.observations);
      if (!score || !Number.isFinite(scene.duration) || scene.duration <= 0) return [];
      const starts = scene.trimStart !== undefined ? [scene.trimStart] : asset.type === 'image' ? [0] :
        Array.from({ length: Math.min(32, Math.floor((clip.end - clip.start) / scene.duration)) }, (_, i) => clip.start + i * scene.duration);
      return starts.flatMap(start => {
        const end = asset.type === 'image' ? Infinity : start + scene.duration;
        if (!Number.isFinite(start) || start < clip.start || end > clip.end + .001) return [];
        const candidate = { ...clip, start, end, score: score * 10 + clip.confidence, sceneIndex: scene.sceneIndex };
        return input.excluded?.some(excluded => overlaps(candidate, excluded)) ? [] : [candidate];
      });
    })).sort((a,b) => b.score - a.score || a.assetId.localeCompare(b.assetId) || a.start - b.start).slice(0, 64));
  const order = input.scenes.map((_, i) => i).sort((a,b) => pools[a].length - pools[b].length || a-b);
  const selected: Array<(typeof pools)[number][number]> = [];
  let visited = 0;
  const search = (depth: number): boolean => {
    if (depth === order.length) return true;
    if (++visited > 5000) return false;
    for (const candidate of pools[order[depth]]) {
      if (selected.some(other => overlaps(candidate, other))) continue;
      selected.push(candidate);
      if (search(depth + 1)) return true;
      selected.pop();
    }
    return false;
  };
  if (search(0)) return { plan: selected.sort((a,b) => a.sceneIndex-b.sceneIndex), gaps: [] };
  const missing = input.scenes.filter((_,i) => !pools[i].length);
  return { plan: [], gaps: missing.length ? missing.map(scene => `第 ${scene.sceneIndex + 1} 镜缺少支持「${scene.intent.slice(0,120)}」且覆盖 ${scene.duration.toFixed(1)} 秒的已确认素材片段`) : ['分镜可用片段相互重复或无法同时分配；请补充相关素材或缩短对应镜头'] };
}
