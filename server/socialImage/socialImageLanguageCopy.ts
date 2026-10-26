import type { ImageLanguage } from '../../shared/contracts/imageLanguages.js';

/** Deterministic neutral fallback must retain the selected language without another paid call. */
const COPY: Record<ImageLanguage, readonly [string, string, string, string]> = {
  en: ['Product overview', 'Product and packaging overview', 'Message us for verified product details', 'Explore this product and its packaging. Contact us for verified commercial details.'],
  zh: ['产品概览', '产品与包装展示', '联系获取已核实资料', '查看本次产品与包装展示。具体商业信息请以企业确认资料为准。'],
  es: ['Descripción del producto', 'Producto y presentación del envase', 'Contáctenos para obtener información verificada', 'Conozca el producto y su envase. Contáctenos para obtener información comercial verificada.'],
  fr: ['Présentation du produit', 'Le produit et son emballage', 'Contactez-nous pour des informations vérifiées', 'Découvrez ce produit et son emballage. Contactez-nous pour obtenir des informations commerciales vérifiées.'],
  de: ['Produktübersicht', 'Produkt und Verpackung', 'Kontaktieren Sie uns für geprüfte Informationen', 'Entdecken Sie das Produkt und seine Verpackung. Kontaktieren Sie uns für geprüfte Geschäftsinformationen.'],
  pt: ['Apresentação do produto', 'Produto e embalagem', 'Fale conosco para obter informações verificadas', 'Conheça o produto e sua embalagem. Entre em contato para obter informações comerciais verificadas.'],
  ar: ['نظرة عامة على المنتج', 'المنتج والعبوة', 'تواصل معنا للحصول على معلومات موثقة', 'تعرّف على المنتج وعبوته. تواصل معنا للحصول على معلومات تجارية موثقة.'],
  id: ['Gambaran produk', 'Produk dan kemasan', 'Hubungi kami untuk informasi terverifikasi', 'Kenali produk dan kemasannya. Hubungi kami untuk informasi komersial yang telah diverifikasi.'],
  vi: ['Tổng quan sản phẩm', 'Sản phẩm và bao bì', 'Liên hệ để nhận thông tin đã xác minh', 'Khám phá sản phẩm và bao bì. Liên hệ để nhận thông tin thương mại đã được xác minh.'],
  ja: ['製品概要', '製品とパッケージの紹介', '確認済みの情報についてお問い合わせください', '製品とパッケージをご紹介します。確認済みの取引情報についてはお問い合わせください。'],
  ko: ['제품 소개', '제품 및 포장 소개', '확인된 정보는 문의해 주세요', '제품과 포장을 확인해 보세요. 확인된 거래 정보는 문의해 주세요.'],
  ru: ['Обзор продукта', 'Продукт и упаковка', 'Свяжитесь с нами для получения проверенных сведений', 'Ознакомьтесь с продуктом и его упаковкой. Свяжитесь с нами для получения проверенной коммерческой информации.'],
  it: ['Presentazione del prodotto', 'Prodotto e confezione', 'Contattaci per informazioni verificate', 'Scopri il prodotto e la sua confezione. Contattaci per informazioni commerciali verificate.'],
};

export function neutralSocialImageCopy(language: ImageLanguage) {
  const [headline, subheadline, cta, caption] = COPY[language];
  return { headline, subheadline, cta, caption };
}
