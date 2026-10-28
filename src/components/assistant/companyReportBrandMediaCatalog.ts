/** Reviewed official imagery, independent of model output and historical financial evidence. */
export interface CompanyBrandMedia {
  id: string;
  brand: string;
  companyId: string;
  aliases: readonly string[];
  image: string;
  originalImageUrl: string;
  sourceUrl: string;
  sourceName: string;
  retrievedOn: string;
  attribution: string;
}

const botanee = (id: string, brand: string, original: string, aliases: string[] = []): CompanyBrandMedia => ({
  id, brand, companyId: 'botanee', aliases: [brand, ...aliases],
  image: `/company-brands/${id}.${original.endsWith('.png') ? 'png' : 'jpg'}`,
  originalImageUrl: `https://www.botanee.com.cn/${original}`,
  sourceUrl: 'https://www.botanee.com.cn/brands',
  sourceName: '贝泰妮集团官网 · 品牌与解决方案',
  retrievedOn: '2026-10-28', attribution: '图片归贝泰妮集团及相应品牌所有',
});

const proya = (id: string, brand: string, original: string, sourcePath: string, aliases: string[] = []): CompanyBrandMedia => ({
  id, brand, companyId: 'proya', aliases: [brand, ...aliases], image: `/company-brands/${id}.${original.endsWith('.png') ? 'png' : 'jpg'}`,
  originalImageUrl: `https://www.proya-group.com/local_upload/${original}`, sourceUrl: `https://www.proya-group.com/${sourcePath}`,
  sourceName: '珀莱雅集团官网 · 旗下品牌', retrievedOn: '2026-10-28', attribution: '图片归珀莱雅集团及相应品牌所有',
});

// Assets are exact copies of the image URLs above, reviewed with their official source page.
// These images illustrate the current brand/product identity; they do not prove sales or popularity.
export const COMPANY_BRAND_MEDIA: readonly CompanyBrandMedia[] = [
  botanee('winona', '薇诺娜', 'brand-profile-winona-v1.jpg', ['WINONA']),
  botanee('winona-baby', '薇诺娜宝贝', 'brand-profile-winona-baby-v2.jpg', ['WINONA BABY']),
  botanee('aoxmed', '瑷科缦', 'brand-profile-aoxmed-v1.png', ['AOXMED']),
  botanee('beforteen', '贝芙汀', 'brand-hero-beforteen-official.png', ['BEFORTEEN']),
  botanee('tripollar', '初普', 'brand-profile-tripollar-v2.jpg', ['TRIPOLLAR']),
  proya('proya-main', '珀莱雅', '20260807/2085625115739553792.png', 'brand-info/polaiya222', ['PROYA']),
  proya('timage', '彩棠', '20260429/2049290506705960960.jpg', 'brand-info/caitang756', ['TIMAGE']),
  proya('off-relax', 'Off&Relax', '20260424/2047566128444211200.jpg', 'brand', ['OFF & RELAX', 'OFF＆RELAX']),
  proya('hapsode', '悦芙媞', '20260424/2047556679239335936.png', 'brand', ['HAPSODE']),
];

export function companyReportBrandMedia(companyId: string, text: string): CompanyBrandMedia[] {
  if (!/品牌|业务|产品|分布/u.test(text)) return [];
  const normalized = text.toUpperCase();
  return COMPANY_BRAND_MEDIA.filter(item => item.companyId === companyId && item.aliases.some(alias => {
    // A mention of WINONA BABY alone must not also insert the parent brand's product picture.
    if (item.id === 'winona') return normalized.replaceAll('薇诺娜宝贝', '').replaceAll('WINONA BABY', '').includes(alias);
    return normalized.includes(alias.toUpperCase());
  }));
}
