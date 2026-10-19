import assert from 'node:assert/strict';
import test from 'node:test';
import { discoveryVideoRecordId, loadKnownVideoSourceIdentities, sourceAccountFromProviderMetadata, sourceAccountFromVideoUrl, sourceAccountFromYouTubeRenderer, videoSourceIdentity } from './videoSourceIdentity.js';

test('provider creator URLs are normalized only for real account paths on their platform',()=>{
 assert.equal(sourceAccountFromProviderMetadata('instagram','https://www.instagram.com/oem_factory/'),'https://www.instagram.com/oem_factory');
 assert.equal(sourceAccountFromProviderMetadata('tiktok','https://www.tiktok.com/@oem_factory'),'https://www.tiktok.com/@oem_factory');
 assert.equal(sourceAccountFromProviderMetadata('tiktok','https://www.tiktok.com/@oem_factory/video/123456'),null);
 assert.equal(sourceAccountFromProviderMetadata('facebook','https://www.facebook.com/oem_factory?utm_source=share'),'https://www.facebook.com/oem_factory');
 assert.equal(sourceAccountFromProviderMetadata('youtube','https://www.youtube.com/@oem_factory/videos'),null);
 assert.equal(sourceAccountFromProviderMetadata('youtube','https://www.youtube.com/@oem_factory'),'https://www.youtube.com/@oem_factory');
 assert.equal(sourceAccountFromProviderMetadata('instagram','https://www.instagram.com/reel/OemFactory1'),null);
 assert.equal(sourceAccountFromProviderMetadata('facebook','https://www.facebook.com/reel/12345'),null);
 assert.equal(sourceAccountFromProviderMetadata('instagram','https://instagram.com.evil.test/oem_factory'),null);
 assert.equal(sourceAccountFromYouTubeRenderer({ownerText:{runs:[{text:'Factory',navigationEndpoint:{browseEndpoint:{browseId:'UC1234567890123456789012'}}}]}}),'https://www.youtube.com/channel/UC1234567890123456789012');
 assert.equal(sourceAccountFromYouTubeRenderer({ownerText:{runs:[{text:'Factory'}]}}),null);
});

test('only a TikTok video URL containing a creator handle supplies account provenance', () => {
 assert.equal(sourceAccountFromVideoUrl('tiktok','https://www.tiktok.com/@oem_factory/video/7656562868334136589?utm_source=share'),'https://www.tiktok.com/@oem_factory');
 assert.equal(sourceAccountFromVideoUrl('tiktok','https://m.tiktok.com/@oem_factory/video/7656562868334136589'),'https://www.tiktok.com/@oem_factory');
 assert.equal(sourceAccountFromVideoUrl('tiktok','https://tiktok.com/@oem_factory/video/7656562868334136589'),'https://www.tiktok.com/@oem_factory');
 assert.equal(sourceAccountFromVideoUrl('tiktok','https://www.tiktok.com/video/7656562868334136589'),null);
 assert.equal(sourceAccountFromVideoUrl('tiktok','https://evil.example/@oem_factory/video/7656562868334136589'),null);
 assert.equal(sourceAccountFromVideoUrl('tiktok','http://www.tiktok.com/@oem_factory/video/7656562868334136589'),null);
 assert.equal(sourceAccountFromVideoUrl('tiktok','https://someone@www.tiktok.com/@oem_factory/video/7656562868334136589'),null);
 assert.equal(sourceAccountFromVideoUrl('tiktok','https://www.tiktok.com:8443/@oem_factory/video/7656562868334136589'),null);
 assert.equal(sourceAccountFromVideoUrl('instagram','https://www.instagram.com/reel/ABC123'),null);
});

test('platform video identity ignores account handle and tracking-link variants without model tokens', () => {
 assert.equal(videoSourceIdentity('tiktok','https://www.tiktok.com/@old/video/7656562868334136589'),videoSourceIdentity('tiktok','https://www.tiktok.com/@new/video/7656562868334136589?utm_source=share'));
 assert.equal(videoSourceIdentity('youtube','https://youtu.be/abc123'),videoSourceIdentity('youtube','https://www.youtube.com/shorts/abc123?si=share'));
 assert.equal(videoSourceIdentity('instagram','https://www.instagram.com/reel/ABC123/?igshid=share'),videoSourceIdentity('instagram','https://instagram.com/reel/ABC123'));
 assert.equal(videoSourceIdentity('facebook','https://www.facebook.com/reel/123456/'),videoSourceIdentity('facebook','https://facebook.com/videos/123456?fbclid=share'));
 assert.notEqual(videoSourceIdentity('tiktok','https://www.tiktok.com/@old/video/1'),videoSourceIdentity('tiktok','https://www.tiktok.com/@old/video/2'));
 assert.notEqual(videoSourceIdentity('youtube','https://www.youtube.com/shorts/AbC'),videoSourceIdentity('youtube','https://www.youtube.com/shorts/abc'));
 assert.notEqual(videoSourceIdentity('instagram','https://www.instagram.com/reel/AbC'),videoSourceIdentity('instagram','https://www.instagram.com/reel/abc'));
 assert.equal(discoveryVideoRecordId('tenant-a','tiktok','https://www.tiktok.com/@old/video/7656562868334136589'),discoveryVideoRecordId('tenant-a','tiktok','https://www.tiktok.com/@new/video/7656562868334136589'));
 assert.notEqual(discoveryVideoRecordId('tenant-a','tiktok','https://www.tiktok.com/@old/video/7656562868334136589'),discoveryVideoRecordId('tenant-b','tiktok','https://www.tiktok.com/@old/video/7656562868334136589'));
});

test('pre-ingest duplicate lookup reads beyond the first page and remains tenant scoped', async () => {
 const rows=Array.from({length:201},(_,index)=>({tenantId:'tenant-a',platform:'tiktok',sourceUrl:`https://www.tiktok.com/@factory/video/${index+1000}`}));
 rows.push({tenantId:'tenant-b',platform:'tiktok',sourceUrl:'https://www.tiktok.com/@factory/video/9999'});
 const known=await loadKnownVideoSourceIdentities({list:async<T>(_collection:string,query:any)=>{
  const matching=rows.filter(row=>row.tenantId===query.where.tenantId),page=query.page??1,perPage=query.perPage??200;
  return{items:matching.slice((page-1)*perPage,page*perPage) as T[],totalItems:matching.length,totalPages:Math.ceil(matching.length/perPage),page,perPage};
 }} as any,'trend_videos','tenant-a');
 assert.equal(known.size,201);
 assert.ok(known.has(videoSourceIdentity('tiktok','https://www.tiktok.com/@renamed/video/1200')));
 assert.ok(!known.has(videoSourceIdentity('tiktok','https://www.tiktok.com/@factory/video/9999')));
});
