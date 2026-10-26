// Public publishers only. No user URLs, credentials, redirects, cookies or browser sessions.
const PUBLISHERS = ['basf.com', 'croda.com', 'dsm-firmenich.com', 'loreal.com', 'loreal-finance.com', 'bloomagebio.com', 'proya.com', 'seppic.com', 'about.fb.com', 'blog.youtube', 'blog.google', 'dav.gov.vn', 'moh.gov.vn', 'moit.gov.vn', 'customs.gov.cn', 'mofcom.gov.cn', 'wto.org', 'worldbank.org',
  'supplier.alibaba.com', 'rule.alibaba.com', 'service.alibaba.com', 'peixun.alibaba.com', 'onetouch.alibaba.com',
  'fda.gov', 'cbp.gov', 'trade.gov', 'commerce.gov', 'ftc.gov', 'europa.eu', 'gov.uk',
  'shfe.com.cn', 'lme.com', 'cmegroup.com', 'tiktok.com', 'tiktokglobalshop.com',
  'facebook.com', 'instagram.com', 'meta.com', 'youtube.com', 'google.com', 'chanmama.com', 'static.cninfo.com.cn'];
export function publicSourceUrl(value) {
  const url = new URL(value);
  if (value.length > 900 || url.protocol !== 'https:' || url.username || url.password || url.port || url.hash
    || url.pathname === '/' || /\/(?:index|default)(?:_\d+)?\.(?:s?html?|aspx?)$/iu.test(url.pathname)
    || /^(?:graph|api|accounts|oauth)\./iu.test(url.hostname) || /\/(?:api|oauth|messages|send|publish)(?:\/|$)/iu.test(url.pathname)
    || !PUBLISHERS.some(host => url.hostname === host || url.hostname.endsWith('.' + host))
    || [...url.searchParams.keys()].some(key => /token|key|secret|auth|password/iu.test(key))) throw Error('source_url_not_public');
  return url;
}

// Publisher website's two read-only form searches, not a general POST capability.
export function publicDisclosureQueryAllowed(value, method, body) {
  try {
    const url = new URL(value);
    if (method !== 'POST' || url.origin !== 'https://www.cninfo.com.cn' || url.hash || url.username || url.password) return false;
    if (url.pathname === '/new/information/topSearch/query') return !body && [...url.searchParams.keys()].length === 2
      && /^\d{6}$/.test(url.searchParams.get('keyWord') || '') && url.searchParams.get('maxNum') === '10';
    if (url.pathname !== '/new/hisAnnouncement/query' || url.search || typeof body !== 'string' || body.length > 1200) return false;
    const params = new URLSearchParams(body);
    const fields = ['pageNum', 'pageSize', 'column', 'tabName', 'stock', 'searchkey', 'category', 'seDate', 'isHLtitle'];
    return [...params.keys()].length === fields.length && fields.every(key => params.getAll(key).length === 1)
      && /^[1-4]$/.test(params.get('pageNum') || '') && params.get('pageSize') === '30'
      && ['sse', 'szse'].includes(params.get('column')) && params.get('tabName') === 'fulltext'
      && /^\d{6},[\w-]{2,40}$/.test(params.get('stock') || '') && ['', '更正', '修订'].includes(params.get('searchkey'))
      && ['', 'category_ndbg_szsh;category_bndbg_szsh;category_yjdbg_szsh;category_sjdbg_szsh'].includes(params.get('category'))
      && /^20\d{2}-\d{2}-\d{2}~20\d{2}-\d{2}-\d{2}$/.test(params.get('seDate') || '') && params.get('isHLtitle') === 'false';
  } catch { return false; }
}
