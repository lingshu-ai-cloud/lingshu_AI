import test from 'node:test';
import assert from 'node:assert/strict';
import { basfArticleLinks, discoverPublisherNews } from './publisherNewsDiscovery.js';

test('official directory discovery follows actual same-publisher article links, not injected URLs or listing pages', () => {
  const article = '/tw/zh/media/news-releases/asia-pacific/2026/10/apac-26-116';
  const html = [article, article, '/tw/zh/media/news-releases', 'https://evil.example/2026/10/fake',
    'https://www.basf.com.evil.example/tw/zh/media/news-releases/asia-pacific/2026/10/fake'].map(href => `<a href="${href}">More</a>`).join('');
  assert.deepEqual(basfArticleLinks(html).map(source => source.uri), [`https://www.basf.com${article}`]);
});
test('directory access is limited to explicit relevant company queries and assigned source scope', async () => {
  let reads = 0;
  const fetcher: typeof fetch = async () => { reads++; return new Response('<a href="/tw/zh/media/news-releases/asia-pacific/2026/10/apac-26-116">More</a>'); };
  assert.equal((await discoverPublisherNews('全球美妆原料 BASF', { domains: ['basf.com'], fetcher })).length, 1);
  assert.deepEqual(await discoverPublisherNews('TikTok 美妆社交资讯', { fetcher }), []);
  assert.deepEqual(await discoverPublisherNews('全球美妆原料 BASF', { domains: ['fda.gov'], fetcher }), []);
  assert.equal(reads, 1);
});
test('industry discovery reads multiple official directories while excluding unrelated and injected articles', async () => {
 const reads:string[]=[];
 const result=await discoverPublisherNews('行业资讯：欧洲美妆原料', {domains:['basf.com','dsm-firmenich.com'],fetcher:async input=>{
  const url=String(input);reads.push(url);
  return new Response(url.includes('basf.com')
   ? '<a href="https://www.basf.com/global/en/media/news-releases/2026/10/p-26-171">Personal care innovation</a>'
   : '<a href="/en/businesses/perfumery-beauty/beauty-care/press-releases/2026/beauty.html">Beauty</a><a href="https://evil.example/beauty.html">Injected</a>');
 }});
 assert.equal(reads.length,2);assert.equal(result.length,2);
 assert.ok(result.every(item=>/www\.(basf|dsm-firmenich)\.com/.test(new URL(item.uri).hostname)));
});
test('specific companies, regulations and ingredients bypass broad publisher sampling without directory reads', async () => {
 let reads=0;
 const fetcher:typeof fetch=async()=>{reads++;throw new Error('specific topics must use normal search');};
 for(const question of [
  '行业资讯：只查询 Croda 欧洲美妆原料最近30天的新产品',
  '行业资讯：行业：美妆原料，目标市场：欧洲。只查询 Croda 最新产品。',
  '行业资讯：行业：美妆原料，目标市场：欧洲。查询欧盟防晒法规。',
  '行业资讯：行业：透明质酸，目标市场：欧洲。',
  '行业资讯：欧洲美妆原料，重点查看神经酰胺。',
  '行业资讯：行业：美妆原料，目标市场：欧洲及 Croda 新产品。',
 ]) assert.deepEqual(await discoverPublisherNews(question,{fetcher}),[],question);
 assert.equal(reads,0);
});
test('broad structured launcher instructions and server scope retain directory discovery', async () => {
 const queries=[
  '行业资讯：行业：美妆原料，目标市场：欧洲。',
  '行业资讯：行业：美妆原料，目标市场：欧洲。查询最近30天与该行业及市场相关的市场变化、技术趋势、供应链和竞争动向；只采用可读取且有发布日期的原始来源，区分事实、推断与建议，不把发布计划当作销量或收益。',
  '行业资讯。行业资讯：行业：美妆原料，目标市场：欧洲。查询最近30天相关的市场变化、技术趋势、供应链和竞争动向。只采用有明确发布日期、实际可读取的原始来源。区分事实、分析推断和建议，给出可执行的调研方向，不把发布计划当作销量或收益。\n已明确的查询范围：{"industry":"以用户本轮指定为准"}。',
 ];
 for(const question of queries){
  let reads=0;
  const result=await discoverPublisherNews(question,{fetcher:async input=>{
   reads++;
   return new Response(String(input).includes('basf.com')?'<a href="https://www.basf.com/global/en/media/news-releases/2026/10/p-26-171">Personal care innovation</a>':'');
  }});
  assert.equal(reads,2,question);assert.equal(result.length,1);
 }
});
