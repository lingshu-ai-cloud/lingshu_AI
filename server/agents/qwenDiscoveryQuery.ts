type Scope = { industry?: string; products?: string; market?: string; platforms?: string };
const clean = (value: unknown) => typeof value === 'string' && !value.includes('以用户本轮指定为准') ? value.trim() : '';
/** Retrieval gets a compact topic and geography; merchant identity and report instructions stay in synthesis. */
export function qwenDiscoveryQuery(question: string, freshnessDays?: number, supplementInstruction?: string): string {
  let scope: Scope = {};
  const embedded = question.match(/已明确的查询范围：\s*(\{[^\n]*?\})/u)?.[1];
  try { if (embedded) scope = JSON.parse(embedded) as Scope; } catch { /* Explicit user text remains authoritative. */ }
  const user = question.split('已明确的查询范围：')[0];
  const explicitIndustry = user.match(/(?:行业|产品|品类)[：:]([^，。；\n]+)/u)?.[1]?.trim();
  const industry = explicitIndustry || clean(scope.industry);
  const explicitMarket = user.match(/(?:目标市场|市场)[：:]([^，。；\n]+)/u)?.[1]?.trim();
  const geographic = (value: string) => {
    const mappings: Array<[RegExp, string]> = [
      [/北美|north\s*america/iu, 'North America (US, Canada)'], [/美国|\bUSA?\b|United States/iu, 'United States'], [/加拿大|Canada/iu, 'Canada'],
      [/法国|France/iu, 'France'], [/德国|Germany/iu, 'Germany'], [/欧洲|欧盟|Europe|European Union/iu, 'Europe EU'], [/英国|United Kingdom|\bUK\b/iu, 'United Kingdom'],
      [/越南|Vietnam/iu, 'Vietnam'], [/泰国|Thailand/iu, 'Thailand'], [/印尼|印度尼西亚|Indonesia/iu, 'Indonesia'], [/马来西亚|Malaysia/iu, 'Malaysia'], [/新加坡|Singapore/iu, 'Singapore'], [/菲律宾|Philippines/iu, 'Philippines'], [/沙特|Saudi/iu, 'Saudi Arabia'], [/阿联酋|UAE/iu, 'UAE'], [/澳大利亚|Australia/iu, 'Australia'], [/巴西|Brazil/iu, 'Brazil'], [/墨西哥|Mexico/iu, 'Mexico'], [/印度(?!尼)|India\b/iu, 'India'], [/非洲|Africa/iu, 'Africa'], [/中东|Middle East/iu, 'Middle East'],
      [/日本|Japan/iu, 'Japan'], [/韩国|Korea/iu, 'South Korea'], [/东南亚|Southeast Asia/iu, 'Southeast Asia'], [/中国|国内|China/iu, 'China'], [/全球|global/iu, 'global'],
    ];
    if (/北美|north\s*america/iu.test(value)) return ['North America (US, Canada)'];
    return mappings.filter(([pattern]) => pattern.test(value)).map(([, name]) => name);
  };
  // An explicit named market in the user question overrides profile defaults, even without a field label.
  const userMarkets = geographic(user);
  const marketScope = explicitMarket || (userMarkets.length ? userMarkets.join(', ') : clean(scope.market));
  const markets = geographic(marketScope);
  const market = [...new Set(markets.length ? markets : [marketScope.replace(/B\s*(?:2|to)\s*B[^，。；\n]*/iu, '').trim() || 'global'])].join(', ');
  const productScope = explicitIndustry || clean(scope.products) || industry || user.split(/[。\n]/u).filter(line => !/每条|整理|报告|建议|请结合/u.test(line)).slice(0, 1).join(' ');
  const themes: Array<[RegExp, string]> = [
    [/防晒|sunscreen/iu, 'sunscreen'], [/原料|成分|ingredient/iu, /美妆|化妆品|护肤|cosmetic|skincare/iu.test(industry + productScope) ? 'cosmetic ingredients' : 'ingredients'],
    [/香水|香氛|fragrance|perfume/iu, 'fragrance'], [/洗发|护发|haircare|hair care/iu, 'haircare'], [/包材|包装|packaging/iu, 'packaging'], [/护肤|精华|面霜|面膜|洁面|乳液|眼霜|身体乳|skincare|skin care|serum|cleanser/iu, 'skincare'], [/彩妆|口红|粉底|眼影|美妆|化妆品|cosmetic|makeup/iu, 'cosmetics'],
    [/家具|家居|furniture/iu, 'furniture'], [/纺织|textile/iu, 'textiles'], [/服装|apparel/iu, 'apparel'], [/机械|machinery/iu, 'machinery'],
    [/电子|electronics/iu, 'electronics'], [/食品|food/iu, 'food'], [/玩具|toys/iu, 'toys'], [/汽车|automotive/iu, 'automotive'],
  ];
  const products = themes.map(([pattern, term]) => ({ term, position: productScope.search(pattern) })).filter(item => item.position >= 0).sort((left, right) => left.position - right.position).slice(0, 2).map(item => item.term);
  const topic = products.length ? products.join(' ') : (industry || productScope).replace(/B\s*(?:2|to)\s*B/giu, '').slice(0, 60) || 'industry';
  const dates = [...question.matchAll(/最近\s*\d+\s*天|20\d{2}-\d{2}-\d{2}(?:\s*(?:至|到)\s*20\d{2}-\d{2}-\d{2})?|20\d{2}年\d{1,2}月(?:至|到|-)(?:20\d{2}年)?\d{1,2}月/gu)].map(match => match[0]);
  const dailyDate = question.match(/今日资讯发布日期范围：(20\d{2}-\d{2}-\d{2})/u)?.[1];
  const period = dailyDate ? `${dailyDate} Asia/Shanghai publication date only` : [...new Set(dates)].join(', ') || `最近${freshnessDays || 30}天`;
  const englishPeriod = period.replace(/(20\d{2})年(\d{1,2})月(?:至|到|-)(?:(20\d{2})年)?(\d{1,2})月/gu, (_match, year: string, month: string, endYear: string | undefined, endMonth: string) => `${year}-${month.padStart(2, '0')} to ${endYear || year}-${endMonth.padStart(2, '0')}`).replace(/最近\s*(\d+)\s*天/gu, 'past $1 days').replace(/至|到/gu, ' to ');
  const supplementary = Boolean(supplementInstruction);
  // Keep the internal repair evidence when shortening the discovery prompt. Never use a site allowlist.
  const missing = supplementInstruction?.match(/需补充的议题[：:]\s*([^；。\n]{1,240})/u)?.[1]?.trim() || '';
  const hosts = (label: string) => {
    const values = supplementInstruction?.match(new RegExp(`${label}[：:]\\s*([^；。\\n]{1,500})`, 'u'))?.[1] || '';
    return [...new Set(values.split(/[、,，\s]+/u).filter(host => /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/iu.test(host)))].slice(0, 12);
  };
  const failedHosts = hosts('首轮不可读取或日期不合格的域名');
  const coveredHosts = hosts('已成功域名');
  const missingAngles = [
    [/监管与行业标准/u, 'regulation standards'], [/技术与研究/u, 'research technology'],
    [/市场与竞争动作/u, 'market competition'], [/供应链与生产/u, 'manufacturing supply chain partnerships'],
  ] as const;
  const selectedAngles = missingAngles.filter(([pattern]) => pattern.test(missing)).map(([, angle]) => angle);
  const repairAngles = selectedAngles.length > 2 ? [selectedAngles[0], selectedAngles.at(-1)!] : selectedAngles;
  const angles = supplementary ? repairAngles.length ? repairAngles : ['manufacturing capacity partnerships', 'research technology regulation'] : ['product launch market news', 'supply chain pricing'];
  const namedEntity = user.match(/(?:关注[：:]?\s*|(?:企业|品牌|公司)[：:]\s*)([^，。；\n]+)/u)?.[1]?.trim();
  const entity = (namedEntity && !/资料|资讯|动态|当前|主推|目标市场|新闻|哪些|什么/u.test(namedEntity) ? namedEntity.slice(0, 60) : '') || clean(scope.platforms).slice(0, 40);
  const northAmerica = market === 'North America (US, Canada)';
  // Avoid conjunctive US+Canada+several product families starving actual local article discovery.
  const queries = angles.map((angle, index) => `${northAmerica ? index === 0 ? 'United States' : 'Canada' : market} ${entity ? entity + ' ' : ''}${northAmerica && products.length ? products[index % products.length] : topic} ${angle} ${englishPeriod}`);
  const cosmetics = /cosmetic|skincare|sunscreen|fragrance|haircare/u.test(topic);
  const localLanguage = cosmetics && /France/u.test(market) ? '法语关键词：cosmétiques soins ingrédients'
    : cosmetics && /Europe EU/u.test(market) ? '英语及德语/法语关键词：cosmetics Kosmetik cosmétiques'
    : cosmetics && /Germany/u.test(market) ? '德语关键词：Kosmetik Hautpflege Inhaltsstoffe'
      : cosmetics && /Japan/u.test(market) ? '日语关键词：化粧品 スキンケア 原料'
        : cosmetics && /Korea/u.test(market) ? '韩语关键词：화장품 스킨케어 원료' : '英语本地查询优先';
  const repairContext = supplementary ? [
    missing ? `本轮需补充的实质议题：${missing}。` : '',
    failedHosts.length ? `本轮未读成或日期不合格的域名：${failedHosts.join('、')}；回避重复失败候选，优先寻找其他可读发布者。` : '',
    coveredHosts.length ? `本轮已读来源域名：${coveredHosts.join('、')}；不重复已覆盖页面，同主题优先补独立发布者的原文。` : '',
    `以上域名仅描述本轮读取结果，不是固定站点范围。仍检索开放网络；候选正文的事实主体、实际发生地点或业务关系必须直接支持${market}，不要用不属于该目标市场的零售统计或其他地区峰会填补该市场缺口。只返回工具检索到的具体文章元数据，不把检索器正文自称命中数量当作来源。`,
  ].filter(Boolean).join('\n') : '';
  return `${northAmerica ? `Scope: industry=${topic}; region=${market}; period=${englishPeriod}. Search English-language local reporting; do not translate queries into Chinese.` : `范围：行业=${industry || topic}；地域=${market}；期间=${period}。`}\n${supplementary ? '补轮改查新议题，勿重复首轮文章；' : ''}${localLanguage}。依次使用以下短查询检索具体文章：\n${queries.map((query, index) => `${index + 1}. ${query}`).join('\n')}\n仅采用与上述地域和行业直接相关、有发布日期的原文。不要把商户身份或完整产品目录加入检索词。${repairContext ? '\n'+repairContext : ''}`;
}
