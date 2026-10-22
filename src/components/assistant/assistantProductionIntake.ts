import { authHeader } from '../../lib/auth';

export type AssistantProductionIntent = {
  title: string;
  objective: string;
  productQuery: string;
  platforms: string[];
  formats: string[];
  aspectRatio: string | null;
  targetDurationSeconds: number | null;
};

export function assistantProductionIntent(text: string): AssistantProductionIntent | null {
  const normalized = text.trim().replace(/\s+/gu, ' ');
  if (!normalized || /^(?:如何|怎么|为什么|是否|能否|可以(?:怎么|如何)|分析|诊断|建议|介绍)/u.test(normalized)) return null;
  const hasProductionVerb = /(?:^|[，。；、\s])(?:请|请帮我|帮我|直接|现在|立即|马上)*(?:生成|制作|创作|撰写|写出|产出|做)(?:一份|一个|一条|这份|这个|该)?/u.test(normalized);
  const hasProductionArtifact = /(?:短视频|视频|竖版|横版|脚本|分镜|口播|广告素材|社媒素材|图文|海报)/iu.test(normalized);
  if (!hasProductionVerb || !hasProductionArtifact) return null;

  const platforms = [
    [/TikTok|抖音/iu, 'tiktok'],
    [/Instagram|\bIG\b/iu, 'instagram'],
    [/Facebook|\bFB\b/iu, 'facebook'],
    [/YouTube/iu, 'youtube'],
  ].filter(([pattern]) => (pattern as RegExp).test(normalized)).map(([, platform]) => platform as string);
  const durationMatch = normalized.match(/(\d{1,3})\s*秒/u);
  const duration = durationMatch ? Number(durationMatch[1]) : null;
  const quotedProduct = normalized.match(/[「“"]([^」”"]{2,80})[」”"]/u)?.[1]?.trim() || '';
  const titleBody = normalized
    .replace(/^(?:请|请帮我|帮我|直接|现在|立即|马上)*/u, '')
    .replace(/^(?:生成|制作|创作|撰写|写出|产出|做)(?:一份|一个|一条|这份|这个|该)?/u, '')
    .replace(/[。！!]+$/u, '')
    .trim();
  return {
    title: (titleBody || '内容 Agent 生产任务').slice(0, 120),
    objective: normalized.slice(0, 1_000),
    productQuery: quotedProduct,
    platforms,
    formats: [/(?:短视频|视频|竖版|横版|分镜|口播)/u.test(normalized) ? '短视频' : /(?:图文|海报)/u.test(normalized) ? '图文' : '内容素材'],
    aspectRatio: /(?:竖版|9\s*[:：]\s*16)/u.test(normalized) ? '9:16' : /(?:横版|16\s*[:：]\s*9)/u.test(normalized) ? '16:9' : null,
    targetDurationSeconds: duration !== null && duration >= 6 && duration <= 60 ? duration : null,
  };
}

export type AssistantEnterpriseProduct = { id: string; label: string; info: string };

function assistantComparableProduct(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s·•・_\-—()（）【】\[\]「」“”'"]/gu, '');
}

export async function resolveAssistantEnterpriseProduct(productQuery: string): Promise<AssistantEnterpriseProduct> {
  if (!productQuery) throw new Error('请在产品名称外使用「」标明要制作的企业产品。');
  const response = await fetch('/api/overseas/enterprise/profile', {
    headers: authHeader(),
    credentials: 'same-origin',
  });
  if (!response.ok) throw new Error('暂时无法读取企业中心产品，请稍后重试。');
  const result = await response.json() as { profile?: unknown } & Record<string, unknown>;
  const profile = ((result.profile && typeof result.profile === 'object') ? result.profile : result) as {
    products?: {
      categories?: string;
      priceRange?: string;
      moq?: string;
      certifications?: string;
      highlights?: string;
      items?: Array<{
        id?: string;
        productId?: string;
        sku?: string;
        name?: string;
        category?: string;
        priceRange?: string;
        moq?: string;
        certifications?: string;
        highlights?: string;
      }>;
    };
    brand?: { usp?: string };
  };
  const requested = assistantComparableProduct(productQuery);
  const items = profile.products?.items || [];
  const index = items.findIndex(item => {
    const candidate = assistantComparableProduct(item.name || '');
    return candidate === requested || (requested.length >= 4 && (candidate.includes(requested) || requested.includes(candidate)));
  });
  const item = index >= 0 ? items[index] : undefined;
  const name = item?.name?.trim() || '';
  if (!item || !name) throw new Error(`企业中心没有找到已确认产品“${productQuery}”，请先核对产品名称。`);
  let productId = [item.id, item.productId, item.sku]
    .map(value => String(value || '').trim().slice(0, 200))
    .find(Boolean) || '';
  if (!productId) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(name));
    productId = `product-${Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, '0')).join('').slice(0, 16)}`;
  }
  const lines = [
    `产品名称：${name}`,
    item.sku?.trim() ? `产品SKU：${item.sku.trim()}` : '',
    (item.category || profile.products?.categories)?.trim() ? `所属类目：${(item.category || profile.products?.categories)!.trim()}` : '',
    (item.highlights || profile.products?.highlights || profile.brand?.usp)?.trim()
      ? `产品卖点：${(item.highlights || profile.products?.highlights || profile.brand?.usp)!.trim()}` : '',
    (item.priceRange || profile.products?.priceRange)?.trim() ? `价格区间：${(item.priceRange || profile.products?.priceRange)!.trim()}` : '',
    (item.moq || profile.products?.moq)?.trim() ? `起订量：${(item.moq || profile.products?.moq)!.trim()}` : '',
    (item.certifications || profile.products?.certifications)?.trim()
      ? `认证资质：${(item.certifications || profile.products?.certifications)!.trim()}` : '',
  ].filter(Boolean);
  return { id: productId, label: name, info: lines.join('\n') };
}
