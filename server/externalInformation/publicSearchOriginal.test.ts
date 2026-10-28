import assert from 'node:assert/strict';
import test from 'node:test';
import { lookup } from 'node:dns/promises';
import { isPublicSearchAddress, parseTrustedDnsAnswer, publicSearchOriginalUrl, readPublicSearchOriginal, resolvePublicSearchHost } from './publicSearchOriginal';

test('public search originals allow non-allowlisted articles but reject dangerous URL forms', () => {
  assert.equal(publicSearchOriginalUrl('https://news.publisher.com/article/123').hostname, 'news.publisher.com');
  for (const value of ['http://news.publisher.com/article', 'https://127.0.0.1/article', 'https://[::1]/article', 'https://x.local/article', 'https://user:pass@news.publisher.com/a', 'https://news.publisher.com:444/a', 'https://news.publisher.com/api/a', 'https://news.publisher.com/a?token=x']) assert.throws(() => publicSearchOriginalUrl(value), value);
});

test('DNS checks reject private, reserved, mapped, or mixed answers', async () => {
  for (const ip of ['127.0.0.1','10.1.2.3','169.254.169.254','100.64.0.1','192.168.1.1','203.0.113.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1']) assert.equal(isPublicSearchAddress(ip), false, ip);
  assert.equal(isPublicSearchAddress('8.8.8.8'), true);
  assert.equal(isPublicSearchAddress('2606:4700:4700::1111'), true);
  const resolver = (addresses: Array<{address:string;family:number}>) => (async () => addresses) as unknown as typeof lookup;
  assert.deepEqual(await resolvePublicSearchHost('news.publisher.com', resolver([{address:'8.8.8.8',family:4}])), {address:'8.8.8.8',family:4});
  await assert.rejects(resolvePublicSearchHost('news.publisher.com', resolver([{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}])));
});

test('original reads never automatically follow unvalidated redirects', async () => {
  let redirect: RequestRedirect | undefined;
  const fetcher: typeof fetch = async (_url, init) => { redirect = init?.redirect; return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/' } }); };
  await assert.rejects(readPublicSearchOriginal(publicSearchOriginalUrl('https://news.publisher.com/article'), {fetcher}));
  assert.equal(redirect, 'manual');
});

test('local synthetic DNS can resolve through the fixed trusted service without accepting private answers', async () => {
  const resolver = (address: string) => (async () => [{ address, family: 4 }]) as unknown as typeof lookup;
  let queries = 0;
  const queryDns = async (hostname: string, type: 1 | 28) => {
    queries++;
    return { Status: 0, TC: false, Question: [{ name: hostname + '.', type }], Answer: type === 1 ? [{ name: hostname, type: 1, data: '8.8.8.8' }] : [] };
  };
  const result = await resolvePublicSearchHost('news.publisher.com', resolver('198.18.0.1'), { allowSyntheticDns: true, queryDns });
  assert.deepEqual(result, { address: '8.8.8.8', family: 4 }); assert.equal(queries, 1);
  await assert.rejects(resolvePublicSearchHost('news.publisher.com', resolver('198.18.0.1'), { allowSyntheticDns: false, queryDns }));
  await assert.rejects(resolvePublicSearchHost('news.publisher.com', resolver('10.0.0.1'), { allowSyntheticDns: true, queryDns }));
  assert.equal(queries, 1);
  const answer = { Status: 0, TC: false, Question: [{ name: 'news.publisher.com.', type: 1 }], Answer: [{ name: 'news.publisher.com.', type: 5, data: 'cdn.publisher.com.' }, { name: 'cdn.publisher.com.', type: 1, data: '8.8.8.8' }] };
  assert.equal(parseTrustedDnsAnswer(answer, 'news.publisher.com', 1)[0].address, '8.8.8.8');
  for (const modified of [{ ...answer, TC: true }, { ...answer, Status: 2 }, { ...answer, Question: [{ name: 'different.com.', type: 1 }] }, { ...answer, Answer: [{ name: 'news.publisher.com.', type: 1, data: '127.0.0.1' }] }, { ...answer, Answer: [{ name: 'unrelated.com.', type: 1, data: '8.8.8.8' }] }]) assert.throws(() => parseTrustedDnsAnswer(modified, 'news.publisher.com', 1));
});

test('valid public redirects stay bounded and consume one shared request budget per hop', async () => {
 const visited:string[]=[];
 const fetcher:typeof fetch=async(input,init)=>{assert.equal(init?.redirect,'manual');visited.push(String(input));return visited.length===1?new Response(null,{status:301,headers:{location:'/article/final'}}):new Response('<article>Readable original</article>',{headers:{'content-type':'text/html'}});};
 const budget={remaining:2};
 const body=await readPublicSearchOriginal(new URL('https://news.publisher.com/article/old'),{fetcher,articleRequestBudget:budget});
 assert.match(body,/Readable/);assert.equal(budget.remaining,0);assert.equal(visited.length,2);
 let calls=0;
 await assert.rejects(readPublicSearchOriginal(new URL('https://news.publisher.com/article/old'),{fetcher:async()=>{calls++;return new Response(null,{status:302,headers:{location:'/article/next'}});},articleRequestBudget:{remaining:1}}),/budget/);
 assert.equal(calls,1);
});
test('redirects reject credentials, API paths, private addresses, loops, and excessive chains before fetching them', async()=>{
 for(const location of ['https://127.0.0.1/article','http://news.publisher.com/article','https://name:password@news.publisher.com/article','https://api.publisher.com/article','https://news.publisher.com/article/start']){
  let calls=0;
  await assert.rejects(readPublicSearchOriginal(new URL('https://news.publisher.com/article/start'),{fetcher:async()=>{calls++;return new Response(null,{status:302,headers:{location}});}}));assert.equal(calls,1);
 }
 let calls=0;
 await assert.rejects(readPublicSearchOriginal(new URL('https://news.publisher.com/article/start'),{fetcher:async()=>{calls++;return new Response(null,{status:302,headers:{location:`/article/${calls}`}});}}),/redirect_limit/);assert.equal(calls,3);
});
test('usable IPv4 DNS does not depend on an unavailable AAAA service', async()=>{
 let queries=0;
 const resolver=(async()=>[{address:'198.18.0.1',family:4}]) as unknown as typeof lookup;
 const chosen=await resolvePublicSearchHost('news.publisher.com',resolver,{allowSyntheticDns:true,queryDns:async(host,type)=>{queries++;if(type===28)throw Error('unavailable');return {Status:0,TC:false,Question:[{name:host,type}],Answer:[{name:host,type:1,data:'8.8.8.8'}]};}});
 assert.equal(chosen.address,'8.8.8.8');assert.equal(queries,1);
});
