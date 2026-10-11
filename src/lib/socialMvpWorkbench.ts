import {
  assertSocialMvpClipHandoff, assertSocialMvpExecutionPackage,
  type SocialMvpHandoffRead, type SocialMvpScope,
} from '../../shared/contracts/socialMvpHandoff';

export interface SocialMvpWorkbenchRead extends SocialMvpHandoffRead {
  reviews?: {
    technical?: MvpReview | null;
    creativePreliminary?: MvpReview | null;
    finalInternalHuman?: (MvpReview & { reviewerId: string; reviewedAt: string; source: 'internal_human' }) | null;
  };
}
interface MvpReview { status: 'pending' | 'passed' | 'changes_requested'; recordRef: string }

/** Display only a complete frozen package bound to the open editor. This does
 * not resolve media bytes, receipts, rights, ledger entries or human authority. */
export function socialMvpWorkbenchRead(value: unknown, expected: Partial<SocialMvpScope>): SocialMvpWorkbenchRead | null {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw Error('真实交接记录格式无效，保持未核验。');
  const read = value as SocialMvpWorkbenchRead;
  if (!Array.isArray(read.clips) || !Array.isArray(read.gaps) || !read.gaps.every(gap => typeof gap === 'string')) throw Error('真实交接记录格式无效，保持未核验。');
  if (read.package === null) {
    if (read.clips.length) throw Error('交接片段缺少冻结执行包，不显示其他任务媒体。');
    return { ...read, reviews: undefined };
  }
  assertSocialMvpExecutionPackage(read.package);
  for (const [key, identity] of Object.entries(expected)) {
    if (!identity || read.package.scope[key as keyof SocialMvpScope] !== identity) throw Error('交接身份与当前工作台不一致，不展示其他任务记录。');
  }
  const seen = new Set<string>();
  for (const clip of read.clips) {
    assertSocialMvpClipHandoff(clip, read.package);
    if (seen.has(clip.sceneId)) throw Error('同一镜头交接不唯一，请核验原供应商任务。');
    seen.add(clip.sceneId);
  }
  return read;
}

export function mvpMoney(value: unknown, currency = 'CNY'): string {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? `${currency} ${value.toFixed(2)}` : '未核验';
}

export function mvpReviewLabel(value: unknown, human = false): string {
  if (!value || typeof value !== 'object') return '未核验';
  const review = value as Record<string, unknown>;
  if (typeof review.recordRef !== 'string' || !review.recordRef.trim()) return '未核验';
  if (human && (review.source !== 'internal_human' || typeof review.reviewerId !== 'string' || !review.reviewerId.trim()
    || typeof review.reviewedAt !== 'string' || !Number.isFinite(Date.parse(review.reviewedAt)))) return '未核验';
  return review.status === 'passed' ? '记录为通过' : review.status === 'changes_requested' ? '记录为需要修改' : '待审核';
}
