/** Only this endpoint returns JSON; material URLs are already playable media. */
export function isPlaybackResolver(url: string): boolean {
  return /^\/api\/overseas\/videos\/[^/]+\/media-url(?:[?#]|$)/.test(url);
}

export function crawlerMediaUrls(record: { id: string; thumbnailUrl?: string; thumbnailFile?: string; videoFileId?: string }, analysis: { videoObjectKey?: string; thumbnailObjectKey?: string }) {
  const base = `/api/overseas/videos/${encodeURIComponent(record.id)}`;
  const hasVideo = Boolean(record.videoFileId || analysis.videoObjectKey);
  return {
    thumbnail: record.thumbnailFile || analysis.thumbnailObjectKey
      ? `${base}/thumbnail`
      : record.thumbnailUrl || (hasVideo ? `${base}/thumbnail` : ''),
    videoUrl: hasVideo ? `${base}/media-url` : undefined,
  };
}
