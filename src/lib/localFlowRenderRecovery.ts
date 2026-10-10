const inputKeys = ['script', 'ratio', 'platform', 'shootingSlots', 'storyboardAssignments', 'shotProductions', 'clipEdits', 'activeAssemblyId', 'selectedProductIds', 'voice', 'voiceoverMode', 'voiceoverUrl', 'voiceoverDur', 'voiceDrafts', 'voiceoverAudios', 'alignedCuesByLang', 'sourceCaptionTextEdits', 'subtitlesOn', 'subMode', 'subtitleStyle', 'bgm', 'bgmVol', 'voiceVol', 'effectPreset', 'effectIntensity', 'effectSoundsOn', 'disabledEffectSceneIds', 'cover', 'coverTitle', 'coverStyle'];
function stable(value: any): any {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
function renderInputValue(key: string, value: any): any {
  if (key !== 'shootingSlots' || !Array.isArray(value)) return value;
  return value.map((shot: any) => ({
    id: String(shot.id || ''), slotId: String(shot.slotId || ''), detail: String(shot.detail || ''),
    duration: Math.round(Number(shot.duration || 0) * 1000) / 1000,
  }));
}
function sameInput(key: string, left: any, right: any): boolean {
  return JSON.stringify(stable(renderInputValue(key, left))) === JSON.stringify(stable(renderInputValue(key, right)));
}
/** An input identity, not a cryptographic signature or a production trust assertion. */
export function localFlowRenderInputIdentity(spec: Record<string, any>): string {
  return JSON.stringify(stable({ ...Object.fromEntries(inputKeys.map(key => [key, renderInputValue(key, spec[key] ?? null)])), materialVersions: (spec.materialSnapshots || []).map((m: any) => ({ id: m.id, contentSha256: m.contentSha256 || '', objectEtag: m.objectEtag || '' })) }));
}
export function localFlowRenderRecovery(spec: Record<string, any>, projectId: string, versions: Array<{ key: string; code: string; plan: { id: string }; inputSignature: string }>, hostname: string) {
  const receipt = spec.localFlowTest?.renderRecovery;
  if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname) || spec.localFlowTest?.enabled !== true || !receipt || receipt.projectId !== projectId
    || receipt.inputIdentity !== localFlowRenderInputIdentity(spec) || !/^[a-f0-9]{64}$/.test(receipt.contentSha256 || '') || !receipt.path || !receipt.previewUrl) return null;
  const version = versions.find(item => item.plan.id === receipt.assemblyId && item.code === receipt.language);
  if (!version) return null;
  return { key: version.key, output: { status: 'done' as const, path: String(receipt.path), previewUrl: String(receipt.previewUrl), inputSignature: version.inputSignature } };
}

export function localFlowRenderInputsStillMatch(saved: Record<string, any>, current: Record<string, any>): boolean {
  return inputKeys.every(key => saved[key] === undefined || sameInput(key, saved[key], current[key]))
    && (saved.materialSnapshots || []).every((material: any) => !material.contentSha256 || (current.materialSnapshots || []).some((next: any) => next.id === material.id && next.contentSha256 === material.contentSha256));
}

/** Hydration adds UI defaults to scripts, productions and edit maps. For the
 * one-time local recovery receipt, bind only when the durable visual source is
 * still identical. The recovered output then receives the current formal
 * render signature, so any edit made after recovery invalidates it normally. */
export function localFlowRecoverySourceStillMatches(saved: Record<string, any>, current: Record<string, any>): boolean {
  const keys = ['ratio', 'platform', 'activeAssemblyId', 'selectedProductIds', 'storyboardAssignments', 'shootingSlots'];
  return keys.every(key => sameInput(key, saved[key] ?? null, current[key] ?? null))
    && (saved.materialSnapshots || []).every((material: any) => !material.contentSha256
      || (current.materialSnapshots || []).some((next: any) => next.id === material.id && next.contentSha256 === material.contentSha256));
}

export function localFlowRenderInputMismatches(saved: Record<string, any>, current: Record<string, any>): string[] {
  return [
    ...inputKeys.filter(key => saved[key] !== undefined && !sameInput(key, saved[key], current[key])),
    ...(saved.materialSnapshots || []).filter((material: any) => material.contentSha256
      && !(current.materialSnapshots || []).some((next: any) => next.id === material.id && next.contentSha256 === material.contentSha256))
      .map((material: any) => `material:${material.id}`),
  ];
}
