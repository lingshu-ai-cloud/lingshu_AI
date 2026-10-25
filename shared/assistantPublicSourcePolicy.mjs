// Public publishers only. No user URLs, credentials, redirects, cookies or browser sessions.
const PUBLISHERS = ['customs.gov.cn', 'mofcom.gov.cn', 'wto.org', 'worldbank.org',
  'supplier.alibaba.com', 'rule.alibaba.com', 'service.alibaba.com', 'peixun.alibaba.com', 'onetouch.alibaba.com',
  'fda.gov', 'cbp.gov', 'trade.gov', 'commerce.gov', 'ftc.gov', 'europa.eu', 'gov.uk',
  'shfe.com.cn', 'lme.com', 'cmegroup.com', 'tiktok.com', 'tiktokglobalshop.com',
  'facebook.com', 'instagram.com', 'meta.com', 'youtube.com', 'google.com', 'chanmama.com'];
export function publicSourceUrl(value) {
  const url = new URL(value);
  if (value.length > 900 || url.protocol !== 'https:' || url.username || url.password || url.port || url.hash
    || url.pathname === '/' || /\/(?:index|default)(?:_\d+)?\.(?:s?html?|aspx?)$/iu.test(url.pathname)
    || /^(?:graph|api|accounts|oauth)\./iu.test(url.hostname) || /\/(?:api|oauth|messages|send|publish)(?:\/|$)/iu.test(url.pathname)
    || !PUBLISHERS.some(host => url.hostname === host || url.hostname.endsWith('.' + host))
    || [...url.searchParams.keys()].some(key => /token|key|secret|auth|password/iu.test(key))) throw Error('source_url_not_public');
  return url;
}
