/** Resolve a locally imported crawler record through its tenant-checked media endpoint. */
export function localReferenceMediaUrl(sourceRef?: string): string {
  const match = /^local:\/\/([a-zA-Z0-9._:-]{1,200})$/.exec(sourceRef?.trim() || '');
  return match ? `/api/overseas/videos/${encodeURIComponent(match[1])}/media-url` : '';
}
