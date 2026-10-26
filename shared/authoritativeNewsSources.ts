/** Fixed original-site entry points, shared by collection and reply navigation. */
export const AUTHORITATIVE_NEWS_SOURCES = [
  { id: 'basf', label: 'BASF 个护原料', kind: 'industry', index: 'https://personal-care-hygiene.basf.com/global/de/news-releases',
    article: /^https:\/\/www\.basf\.com\/global\/en\/media\/news-releases\/20\d{2}\/\d{2}\/p-[\d-]+$/u },
  { id: 'fda', label: 'FDA 化妆品监管', kind: 'policy', index: 'https://www.fda.gov/cosmetics/cosmetics-news-events',
    article: /^https:\/\/www\.fda\.gov\/cosmetics\/cosmetics-news-events\/[^/?#]+$/u },
  { id: 'meta', label: 'Meta 官方动态', kind: 'social', index: 'https://about.fb.com/news/tag/reels/',
    article: /^https:\/\/about\.fb\.com\/news\/20\d{2}\/\d{2}\/[^/?#]+\/$/u },
] as const;
