import type { ImageLanguage } from '../../shared/contracts/imageLanguages.js';
import type { EnterpriseProfile } from '../routes/enterpriseProfileContracts.js';
import { neutralSocialImageCopy } from './socialImageLanguageCopy.js';

type Product = NonNullable<EnterpriseProfile['products']['items']>[number];
type BuyerWords = { category: string; mistCategory: string; texture: string; textureDetail: string; eveningUse: string;
  cta: string; inquiry: string; label: string; oemInquiry: string };

// These are questions or requests, never promises about MOQ, packaging, price or delivery.
const WORDS: Record<ImageLanguage, BuyerWords> = {
  en: { category: 'Face cream', mistCategory: 'Facial mist', texture: 'Cool-touch sorbet texture', textureDetail: 'Sorbet-like texture', eveningUse: 'Evening skincare', cta: 'Message us for catalog and quote', inquiry: 'Order size · Packaging · Timing?', label: 'B2B SOURCING', oemInquiry: 'Request OEM/ODM info' },
  zh: { category: '面霜', mistCategory: '护肤喷雾', texture: '冰沙般清凉质地', textureDetail: '冰沙质地', eveningUse: '晚间护肤场景', cta: '私信获取目录与人工报价', inquiry: '可咨询订购数量、包装与交付安排', label: '采购咨询', oemInquiry: '可索取 OEM/ODM 合作资料' },
  es: { category: 'Crema facial', mistCategory: 'Bruma facial', texture: 'Textura sorbete refrescante', textureDetail: 'Textura tipo sorbete', eveningUse: 'Cuidado facial nocturno', cta: 'Solicite catálogo y cotización', inquiry: 'Consulte cantidades, envase y plazos', label: 'COMPRAS B2B', oemInquiry: 'Información OEM/ODM a solicitud' },
  fr: { category: 'Crème visage', mistCategory: 'Brume visage', texture: 'Texture sorbet fraîche', textureDetail: 'Texture façon sorbet', eveningUse: 'Soin du visage du soir', cta: 'Demandez le catalogue et un devis', inquiry: 'Renseignez-vous sur les quantités, l’emballage et les délais', label: 'ACHATS B2B', oemInquiry: 'Informations OEM/ODM sur demande' },
  de: { category: 'Gesichtscreme', mistCategory: 'Gesichtsspray', texture: 'Kühlende Sorbet-Textur', textureDetail: 'Sorbetartige Textur', eveningUse: 'Abendliche Gesichtspflege', cta: 'Katalog und Angebot anfragen', inquiry: 'Fragen Sie nach Mengen, Verpackung und Zeitplan', label: 'B2B-EINKAUF', oemInquiry: 'OEM/ODM-Infos auf Anfrage' },
  pt: { category: 'Creme facial', mistCategory: 'Bruma facial', texture: 'Textura sorbet refrescante', textureDetail: 'Textura tipo sorbet', eveningUse: 'Cuidado facial noturno', cta: 'Solicite catálogo e orçamento', inquiry: 'Consulte quantidades, embalagem e prazos', label: 'COMPRAS B2B', oemInquiry: 'Informações OEM/ODM sob consulta' },
  ar: { category: 'كريم للوجه', mistCategory: 'رذاذ للوجه', texture: 'قوام سوربيه منعش', textureDetail: 'قوام يشبه السوربيه', eveningUse: 'للعناية المسائية بالبشرة', cta: 'اطلب الكتالوج وعرض السعر', inquiry: 'اسأل عن الكميات والتغليف والمواعيد', label: 'شراء للشركات', oemInquiry: 'معلومات OEM/ODM عند الطلب' },
  id: { category: 'Krim wajah', mistCategory: 'Face mist', texture: 'Tekstur sorbet yang sejuk', textureDetail: 'Tekstur seperti sorbet', eveningUse: 'Perawatan wajah malam', cta: 'Minta katalog dan penawaran', inquiry: 'Tanyakan jumlah, kemasan, dan jadwal', label: 'PENGADAAN B2B', oemInquiry: 'Informasi OEM/ODM atas permintaan' },
  vi: { category: 'Kem dưỡng da mặt', mistCategory: 'Xịt khoáng dưỡng da', texture: 'Kết cấu sorbet mát dịu', textureDetail: 'Kết cấu như sorbet', eveningUse: 'Chăm sóc da buổi tối', cta: 'Nhắn tin nhận danh mục và báo giá', inquiry: 'Hỏi về số lượng, bao bì và thời gian', label: 'MUA HÀNG B2B', oemInquiry: 'Thông tin OEM/ODM theo yêu cầu' },
  ja: { category: 'フェイスクリーム', mistCategory: 'フェイスミスト', texture: 'ひんやりシャーベット質感', textureDetail: 'シャーベットのような質感', eveningUse: '夜のスキンケア', cta: 'カタログと見積りをお問い合わせ', inquiry: '数量・包装・納期についてご相談ください', label: '法人向け商品案内', oemInquiry: 'OEM/ODM 資料はお問い合わせください' },
  ko: { category: '페이스 크림', mistCategory: '페이스 미스트', texture: '시원한 셔벗 제형', textureDetail: '셔벗 같은 제형', eveningUse: '저녁 스킨케어', cta: '카탈로그와 견적 문의', inquiry: '수량·포장·일정 문의', label: '기업 구매 문의', oemInquiry: 'OEM/ODM 자료 문의' },
  ru: { category: 'Крем для лица', mistCategory: 'Спрей для лица', texture: 'Освежающая текстура сорбета', textureDetail: 'Текстура как у сорбета', eveningUse: 'Вечерний уход за кожей', cta: 'Запросите каталог и расчёт', inquiry: 'Уточните объём заказа, упаковку и сроки', label: 'ЗАКУПКИ B2B', oemInquiry: 'Информация OEM/ODM по запросу' },
  it: { category: 'Crema viso', mistCategory: 'Nebbia viso', texture: 'Texture sorbet fresca', textureDetail: 'Texture tipo sorbetto', eveningUse: 'Cura del viso serale', cta: 'Richiedi catalogo e preventivo', inquiry: 'Chiedi quantità, confezione e tempi', label: 'ACQUISTI B2B', oemInquiry: 'Informazioni OEM/ODM su richiesta' },
};

const productId = (product: Product) => String(product.id || product.productId || product.sku || '');

function verifiedHeadline(product: Product, language: ImageLanguage, category: string, packagingHint: string): string {
  if (language === 'zh') return String(product.name || category).trim().slice(0, 20);
  if (language === 'en') {
    const endings = product.category === '面霜' ? ['CREAM']
      : product.category === '护肤喷雾' ? ['MIST', 'SPRAY'] : [];
    const brand = String(product.brand || '').toUpperCase();
    for (const rawLine of packagingHint.split(/\r?\n/)) {
      const tokens = rawLine.toUpperCase().match(/[A-Z]{2,}/g) || [];
      const end = tokens.findIndex(token => endings.includes(token));
      if (end < 1) continue;
      const prefix = tokens.slice(0, end).filter((token, index) => index !== 0 || token !== brand);
      if (!prefix.length) continue;
      const headline = [...prefix.slice(0, 2), tokens[end]!].join(' ');
      if (headline.length <= 20) return headline;
      const shorter = `${prefix[0]} ${tokens[end]}`;
      if (shorter.length <= 20) return shorter;
    }
  }
  return category.toUpperCase();
}

/** Only selected, confirmed tenant facts may become deterministic buyer-facing copy. */
export function socialImageBuyerCopy(profile: EnterpriseProfile, selectedId: string, language: ImageLanguage,
  packagingHint: string | null): { poster: { headline: string; originBadge: string; subheadline: string; sellingPoints: string[];
    bottomBar: string[]; cta: string }; auditEvidence: string } | null {
  if (!profile.factVersion?.id) return null;
  const matches = (profile.products.items || []).filter(item => productId(item) === selectedId);
  if (matches.length !== 1) return null;
  const product = matches[0]!;
  const words = WORDS[language];
  const brand = String(product.brand || '').trim().slice(0, 32);
  const sku = String(product.sku || product.id || '').trim();
  const net = String(product.attributes?.['净含量'] || '').trim();
  const netContent = /^\d+(?:\.\d+)?\s?(?:g|kg|ml|l|oz)$/i.test(net)
    ? net.replace(/\s*(g|kg|ml|l|oz)$/i, ' $1') : '';
  const productCategory = String(product.category || '').trim();
  const category = productCategory === '面霜' ? words.category
    : productCategory === '护肤喷雾' ? words.mistCategory : '';
  const eveningUse = /晚间锁水/.test(String(product.attributes?.['核心场景'] || '')) ? words.eveningUse : '';
  // A texture phrase needs both the selected product name and the real package title.
  const sorbet = /冰沙/.test(String(product.name || '')) && /\bsorbet\s+cream\b/i.test(packagingHint || '');
  const catalog = /目录|catalog/i.test([profile.knowledge,
    ...Object.values(profile.socialStrategy?.routeStrategies || {}).map(route => route?.primaryCta || '')].join(' '));
  const oemCta = String(profile.socialStrategy?.routeStrategies?.oem_odm?.primaryCta || '');
  const oemInquiry = /\bOEM\b/i.test(oemCta) && /\bODM\b/i.test(oemCta) && /资料|information|catalog/i.test(oemCta);
  const sellingPoints = [category, sorbet ? words.textureDetail : '', eveningUse,
    oemInquiry ? words.oemInquiry : '', sku ? `SKU: ${sku}` : ''].filter(Boolean);
  if (!sellingPoints.length && !netContent) return null;
  return {
    poster: { headline: verifiedHeadline(product, language, category, packagingHint || ''),
      originBadge: brand, subheadline: sorbet ? words.texture : '', sellingPoints,
      bottomBar: [netContent, oemInquiry ? 'OEM / ODM' : words.label, words.inquiry],
      cta: catalog ? words.cta : neutralSocialImageCopy(language).cta },
    auditEvidence: [`已确认产品SKU：${sku}`, netContent ? `已确认产品净含量：${netContent}` : '',
      category ? `已确认产品类目：${product.category}` : '', eveningUse ? `已确认产品核心场景：${product.attributes?.['核心场景']}` : '',
      brand ? `已确认产品品牌：${brand}` : '',
      oemInquiry ? `已确认OEM/ODM资料询盘入口：${oemCta}` : ''].filter(Boolean).join('\n'),
  };
}
