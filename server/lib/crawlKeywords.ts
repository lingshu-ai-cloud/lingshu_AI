type Product = { name?: string; category?: string };
type Profile = {
  products?: { categories?: string; searchKeywords?: string; items?: Product[] };
  strategy?: { focusProducts?: string };
};

const split = (value: string) => value.split(/[\n,，;；、]+/).map(s => s.trim()).filter(Boolean);
const meaningful = (value: string) => !/^(?:产品|商品|测试产品|示例产品|product|item|test\s*product|sample\s*product)[\s_#-]*\d*$|^\d+$|^(?:待填写|暂无|未设置)$/i.test(value.trim());
// Translation only: never add product capabilities or infer a SKU from a generic name.
const categoryEnglish: Record<string, string> = {
  '服装': 'clothing', '服饰': 'apparel', '女装': "women clothing", '男装': 'men clothing',
  '童装': 'kids clothing', '鞋': 'shoes', '鞋类': 'footwear', '箱包': 'bags',
  '家具': 'furniture', '家居': 'home decor', '灯具': 'lighting', '玩具': 'toys',
  '护肤品': 'skincare', '化妆品': 'cosmetics', '智能开关': 'smart switch',
};

export function resolveCrawlKeywords(explicit: string, profile: Profile): {
  keywords: string[]; source: 'knowledge' | 'explicit' | 'product' | 'category'; evidence: string[];
} {
  const configured = split(profile.products?.searchKeywords || '').filter(meaningful);
  if (configured.length) return { keywords: [...new Set(configured)], source: 'knowledge', evidence: configured };
  const supplied = split(explicit);
  const valid = supplied.filter(meaningful);
  if (valid.length) return { keywords: valid, source: 'explicit', evidence: valid };
  const items = profile.products?.items || [];
  const focus = supplied.length ? supplied : split(profile.strategy?.focusProducts || '');
  const selected = items.filter(item => focus.includes(String(item.name || '')));
  const candidates = selected.length ? selected : items;
  const names = candidates.map(item => item.name || '').filter(name => name && meaningful(name));
  if (names.length) return { keywords: [...new Set(names)].slice(0, 3), source: 'product', evidence: names };
  const categories = candidates.flatMap(item => split(item.category || ''));
  if (!categories.length) categories.push(...split(profile.products?.categories || ''));
  const usable = [...new Set(categories.filter(meaningful))].slice(0, 3);
  if (usable.length) return { keywords: usable.map(value => categoryEnglish[value] || value), source: 'category', evidence: usable };
  throw new Error('缺少可识别的产品名称或品类，不能使用占位名称生成采集任务。请补全企业产品资料。');
}
