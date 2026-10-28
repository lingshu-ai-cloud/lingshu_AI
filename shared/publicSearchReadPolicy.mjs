import { BlockList, isIP } from 'node:net';
const blockedV4 = new BlockList(), blockedV6 = new BlockList();
for (const [address, bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) blockedV4.addSubnet(address, bits, 'ipv4');
for (const [address, bits] of [['::',128],['::1',128],['::ffff:0:0',96],['2001:db8::',32],['2001::',23],['2002::',16],['3fff::',20],['fc00::',7],['fe80::',10],['ff00::',8]]) blockedV6.addSubnet(address, bits, 'ipv6');
const globalV6 = new BlockList(); globalV6.addSubnet('2000::', 3, 'ipv6');

export function isPublicSearchAddress(address) {
  const family = isIP(address);
  return family === 4 ? !blockedV4.check(address, 'ipv4') : family === 6 && globalV6.check(address, 'ipv6') && !blockedV6.check(address, 'ipv6');
}

/** Only public HTTPS article URLs returned by search; never an authenticated or local endpoint. */
export function publicSearchOriginalUrl(value) {
  const url = new URL(value);
  if (value.length > 900 || url.protocol !== 'https:' || url.username || url.password || url.port || url.hash
    || /[\[\]:]/u.test(url.hostname) || url.hostname.endsWith('.') || isIP(url.hostname) || !url.hostname.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|example|invalid)$/iu.test(url.hostname)
    || url.pathname === '/' || /\/(?:index|default)(?:_\d+)?\.(?:s?html?|aspx?)$/iu.test(url.pathname)
    || /^(?:graph|api|accounts|oauth)\./iu.test(url.hostname) || /\/(?:api|oauth|messages|send|publish)(?:\/|$)/iu.test(url.pathname)
    || [...url.searchParams.keys()].some(key => /token|key|secret|auth|password|signature|credential/iu.test(key))) throw Error('source_url_not_public');
  return url;
}

