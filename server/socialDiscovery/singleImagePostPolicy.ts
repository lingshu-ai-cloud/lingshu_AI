import type { CrawledImagePost } from './imagePostEvidenceAnalysis.js';

/** Only one still image is eligible for image-reference collection. */
export function isSingleStillImagePost(item: CrawledImagePost): boolean {
  const urls = item.imageUrls?.length ? item.imageUrls : [item.thumbnailUrl];
  if (urls.length !== 1 || !urls[0]?.trim()) return false;
  return [urls[0], item.thumbnailUrl].every(value => {
    const url = String(value || '').trim();
    return !/^data:image\/gif[;,]/i.test(url)
      && !/(?:\.gif(?:[?#]|$)|[?&](?:format|fm|type|mime)=image%2Fgif(?:&|$)|[?&](?:format|fm|type)=gif(?:&|$))/i.test(url);
  });
}

export function isGifImageBytes(bytes: Buffer, mimeType: string): boolean {
  return /^image\/gif(?:;|$)/i.test(mimeType.trim())
    || bytes.subarray(0, 6).toString('ascii') === 'GIF87a'
    || bytes.subarray(0, 6).toString('ascii') === 'GIF89a';
}
