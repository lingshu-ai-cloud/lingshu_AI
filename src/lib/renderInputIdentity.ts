/** Identity only: never use this value for playback or authorization. */
export function renderAssetIdentity(raw: string): string {
  if (!raw || /^(?:data|blob):/i.test(raw)) return raw;
  try {
    const relative = raw.startsWith('/');
    const url = new URL(raw, 'http://studio.local');
    if (relative) {
      url.searchParams.delete('assetToken');
      if (/^\/(?:cloud-files|studio-media)\//.test(url.pathname)) {
        url.pathname = url.pathname.replace(/\/signed\/[^/]+\/(?=[^/]+$)/, '/');
      }
    }
    // S3/R2 rotate these credentials without changing the stored object.
    if (url.searchParams.has('X-Amz-Signature')) {
      for (const name of ['X-Amz-Signature', 'X-Amz-Date', 'X-Amz-Expires', 'X-Amz-Credential', 'X-Amz-Security-Token', 'X-Amz-Algorithm', 'X-Amz-SignedHeaders']) url.searchParams.delete(name);
    }
    url.searchParams.sort();
    return `${relative ? '' : url.origin}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return raw;
  }
}

/** Also accepts historical JSON signatures so existing renders can recover. */
export function canonicalRenderSignature(signature: string): string {
  try {
    const value = JSON.parse(signature);
    if (typeof value.voiceoverUrl === 'string') value.voiceoverUrl = renderAssetIdentity(value.voiceoverUrl);
    if (typeof value.capturedCoverFrameUrl === 'string') value.capturedCoverFrameUrl = renderAssetIdentity(value.capturedCoverFrameUrl);
    if (Array.isArray(value.timeline)) value.timeline = value.timeline.map((item: Record<string, unknown>) => {
      const next = { ...item };
      if (typeof next.url === 'string') next.url = renderAssetIdentity(next.url);
      return next;
    });
    return JSON.stringify(value);
  } catch {
    return signature;
  }
}

export function renderSignaturesMatch(saved: string | undefined, current: string): boolean {
  return Boolean(saved) && canonicalRenderSignature(saved!) === canonicalRenderSignature(current);
}
