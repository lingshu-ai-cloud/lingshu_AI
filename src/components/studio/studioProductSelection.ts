
import type { ProductOption, EnterpriseProfileLite, EnterpriseProductItem } from './studioWorkspaceContracts.js';
import { compact, PLACEHOLDER_PRODUCT_RE } from './studioScriptQualityPresentation.js';

export function formatSelectedProductInfo(options: ProductOption[]): string {
  return options.map((option, index) => [
    options.length > 1 ? `选定产品 ${index + 1}：${option.label}` : '',
    option.info,
  ].filter(Boolean).join('\n')).join('\n\n');
}

export function selectedProductLabel(productInfo: string): string {
  const names = Array.from(String(productInfo || '').matchAll(/产品名称[：:]\s*([^\n]+)/g))
    .map(match => compact(match[1]))
    .filter(name => name && !PLACEHOLDER_PRODUCT_RE.test(name));
  if (names.length) return names.join(' + ');
  const brief = parseProductBrief(productInfo);
  return brief.name && !PLACEHOLDER_PRODUCT_RE.test(brief.name) ? brief.name : '';
}

export function productOptionFromInfo(info: string, id = 'kickoff-product'): ProductOption | null {
  const label = selectedProductLabel(info);
  if (!label) return null;
  return { id, label, info: String(info || '').trim() };
}

export function productOptionCategory(option: ProductOption): string {
  return option.info.match(/所属类目[：:]\s*([^\n]+)/)?.[1]?.trim() || '未分类';
}

/** Matches the identity used by enterprise products and the tenant material library. */
export function enterpriseProductIdentity(item: Pick<EnterpriseProductItem, 'id' | 'productId' | 'sku'>): string {
  return [item.id, item.productId, item.sku].map(value => String(value || '').trim()).find(Boolean) || '';
}

/** Explicit catalog identity wins; only legacy or name-only references may resolve by unique name. */
export function resolveStudioProductOption(
  requested: { id?: string; name?: string }, options: ProductOption[],
): ProductOption | undefined {
  const id = String(requested.id || '').trim();
  const exact = id ? options.find(option => option.id === id) : undefined;
  if (exact) return exact;
  const legacyName = id.match(/^product-\d+-(.+)$/)?.[1];
  if (id && !legacyName) return undefined;
  const name = String(requested.name || legacyName || '').trim();
  if (!name) return undefined;
  const matches = options.filter(option => option.label === name);
  return matches.length === 1 ? matches[0] : undefined;
}

/** Restore old index/name draft IDs only when their product name resolves unambiguously. */
export function resolveStudioProductIds(ids: string[], options: ProductOption[]): string[] {
  return [...new Set(ids.flatMap(id => {
    const match = resolveStudioProductOption({ id }, options);
    return match ? [match.id] : [];
  }))];
}

/** During asynchronous profile hydration, retain draft identity until the catalog is available. */
export function restoreStudioProductIds(ids: string[], options: ProductOption[]): string[] {
  return options.some(option => option.catalogProductId)
    ? resolveStudioProductIds(ids, options)
    : [...ids];
}

export function buildAiProductOptions(profile: EnterpriseProfileLite): ProductOption[] {
  const categories = compact(profile.products?.categories);
  const fallbackNames = compact(profile.strategy?.focusProducts || categories)
    .split(/[、,，\n]/)
    .map(item => item.trim())
    .filter(Boolean);
  const rawItems: EnterpriseProductItem[] = profile.products?.items?.length
    ? profile.products.items
    : fallbackNames.map(name => ({ name }));
  return rawItems
    .map(item => {
      const name = compact(item.name);
      if (!name || /^产品\d+$/.test(name)) return null;
      const category = compact(item.category || categories);
      const highlights = compact(item.highlights || profile.products?.highlights || profile.brand?.usp);
      const price = compact(item.priceRange || profile.products?.priceRange);
      const moq = compact(item.moq || profile.products?.moq);
      const certifications = compact(item.certifications || profile.products?.certifications);
      const assetNames = (list?: Array<{ name?: string }>) => (list || [])
        .map(asset => compact(asset.name))
        .filter(Boolean)
        .slice(0, 6)
        .join('、');
      return {
        id: enterpriseProductIdentity(item) || `legacy-product:${encodeURIComponent(name)}`,
        ...(enterpriseProductIdentity(item) ? { catalogProductId: enterpriseProductIdentity(item) } : {}),
        label: name,
        imageUrls: [
          ...(item.images || []),
          ...(item.packagingImages || []),
          ...(item.sceneImages || []),
        ].map(asset => compact(asset.url)).filter(Boolean),
        info: [
          `产品名称：${name}`,
          compact(item.sku) ? `产品SKU：${compact(item.sku)}` : '',
          category ? `所属类目：${category}` : '',
          highlights ? `产品卖点：${highlights}` : '',
          price ? `价格区间：${price}` : '',
          moq ? `起订量：${moq}` : '',
          certifications ? `认证资质：${certifications}` : '',
          assetNames(item.images) ? `产品主图素材：${assetNames(item.images)}` : '',
          assetNames(item.factoryImages) ? `工厂实拍素材：${assetNames(item.factoryImages)}` : '',
          assetNames(item.packagingImages) ? `包装定制素材：${assetNames(item.packagingImages)}` : '',
          assetNames(item.certificateImages) ? `证书资质素材：${assetNames(item.certificateImages)}` : '',
          assetNames(item.sceneImages) ? `使用场景素材：${assetNames(item.sceneImages)}` : '',
          assetNames(item.brandAssets) ? `品牌视觉素材：${assetNames(item.brandAssets)}` : '',
        ].filter(Boolean).join('\n'),
      };
    })
    .filter(Boolean) as ProductOption[];
}

export function parseProductBrief(productInfo: string) {
  const lines = String(productInfo || '').split('\n').map(line => line.trim()).filter(Boolean);
  const pick = (label: string) => {
    const line = lines.find(item => item.startsWith(`${label}：`) || item.startsWith(`${label}:`));
    return compact(line?.replace(new RegExp(`^${label}[：:]\\s*`), ''));
  };
  const firstProductName = Array.from(String(productInfo || '').matchAll(/产品名称[：:]\s*([^\n]+)/g))
    .map(match => compact(match[1]))
    .filter(Boolean)
    .join(' + ');
  const first = compact(lines[0]?.replace(/^[^：:]+[：:]\s*/, ''));
  return {
    name: firstProductName || pick('产品名称') || pick('主推品') || first || '主推产品',
    category: pick('所属类目') || pick('产品类目') || '待补充类目',
    highlights: pick('产品卖点') || pick('核心优势') || '待补充真实卖点',
    price: pick('价格区间'),
    moq: pick('起订量'),
    certifications: pick('认证资质'),
  };
}
