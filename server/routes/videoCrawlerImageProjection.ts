import type { CrawledImagePost } from '../socialDiscovery/imagePostEvidenceAnalysis.js';
import { canonicalSourceUrl } from './videoCrawlerSourceUrls.js';
import { isPlatformUrl } from './videoCrawlerNormalization.js';
import {
  apifyAuthor, apifyInstagramTags, apifyInstagramUploadedAt, apifyTikTokTags, apifyUploadedAt,
  asRecord, cleanupAnalysisTitle, compactNumber, firstImageUrl, imageUrlsFrom,
} from './videoCrawlerProviderProjection.js';

export function apifyInstagramItemToImagePost(item: Record<string, unknown>, keyword: string): CrawledImagePost | null {
  const type = String(item.type || '').toLowerCase();
  const isVideo = type === 'video' || item.productType === 'clips' || Boolean(item.videoUrl);
  if (isVideo) return null;
  const author = String(item.ownerUsername || '').trim();
  const shortCode = String(item.shortCode || '').trim();
  const rawUrl = String(item.url || (shortCode ? `https://www.instagram.com/p/${shortCode}/` : '')).trim();
  const sourceUrl = canonicalSourceUrl('instagram', rawUrl, author);
  if (!sourceUrl || !isPlatformUrl(sourceUrl, 'instagram')) return null;
  if (!/\/p\//i.test(sourceUrl)) return null;
  const thumbnailUrl = firstImageUrl([item.displayUrl, item.images, item]);
  if (!thumbnailUrl) return null;
  const caption = String(item.caption || '').trim();
  const imageUrls = imageUrlsFrom([item.displayUrl, item.images, item.childPosts, item]).filter(url => !/\.(?:mp4|mov|webm)(?:[?#]|$)/i.test(url));
  const likes = Number(item.likesCount || 0);
  const comments = Number(item.commentsCount || 0);
  const owner = asRecord(item.owner);
  return {
    platform: 'instagram',
    title: cleanupAnalysisTitle(caption || (author ? `Instagram post by ${author}` : 'Instagram image post')),
    sourceUrl,
    thumbnailUrl,
    caption,
    imageUrls: imageUrls.length ? imageUrls : [thumbnailUrl],
    views: likes > 0 ? `${compactNumber(likes)} likes` : 'Instagram',
    tags: apifyInstagramTags(item, keyword),
    uploadedAt: apifyInstagramUploadedAt(item),
    author,
    likes: likes > 0 ? compactNumber(likes) : undefined,
    comments: comments > 0 ? compactNumber(comments) : undefined,
    followers: Number(item.ownerFollowersCount || item.followersCount || owner.followersCount || 0) || undefined,
    isPaidPartnership: item.isPaidPartnership === true || item.isPaidPartnershipPost === true,
    source: 'apify-image',
  };
}

export function apifyTikTokItemToImagePost(item: Record<string, unknown>, keyword: string): CrawledImagePost | null {
  const hasImages = Boolean(item.imagePost)
    || (Array.isArray(item.images) && item.images.length > 0)
    || (Array.isArray(item.imageUrls) && item.imageUrls.length > 0)
    || String(item.type || item.mediaType || '').toLowerCase().includes('photo');
  if (!hasImages) return null;
  const author = apifyAuthor(item);
  const sourceUrl = canonicalSourceUrl('tiktok', String(item.webVideoUrl || item.url || item.shareUrl || item.link || '').trim(), author);
  if (!sourceUrl || !isPlatformUrl(sourceUrl, 'tiktok')) return null;
  const text = String(item.text || item.description || item.desc || item.title || '').trim();
  const thumbnailUrl = firstImageUrl([item.imagePost, item.images, item.imageUrls, item.coverUrl, item.thumbnailUrl, item]);
  const imageUrls = imageUrlsFrom([item.imagePost, item.images, item.imageUrls, item.coverUrl, item.thumbnailUrl, item]);
  const likes = Number(item.diggCount || item.likes || item.likeCount || 0);
  const comments = Number(item.commentCount || item.comments || 0);
  const shares = Number(item.shareCount || item.shares || 0);
  const plays = Number(item.playCount || item.plays || 0);
  const authorMeta = asRecord(item.authorMeta);
  return {
    platform: 'tiktok',
    title: cleanupAnalysisTitle(text || (author ? `TikTok photo post by ${author}` : 'TikTok photo post')),
    sourceUrl,
    thumbnailUrl,
    caption: text,
    imageUrls: imageUrls.length ? imageUrls : [thumbnailUrl].filter(Boolean),
    views: likes > 0 ? `${compactNumber(likes)} likes` : 'TikTok',
    tags: apifyTikTokTags(item, keyword),
    uploadedAt: apifyUploadedAt(item),
    author,
    likes: likes > 0 ? compactNumber(likes) : undefined,
    comments: comments > 0 ? compactNumber(comments) : undefined,
    shares: shares > 0 ? compactNumber(shares) : undefined,
    plays: plays > 0 ? compactNumber(plays) : undefined,
    followers: Number(authorMeta.fans || authorMeta.followers || 0) || undefined,
    isAd: item.isAd === true || item.isSponsored === true,
    source: 'apify-image',
  };
}
