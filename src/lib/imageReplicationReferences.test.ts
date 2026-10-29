import assert from 'node:assert/strict';
import test from 'node:test';
import { collectedImageReferences } from './imageReplicationReferences';

const collected = { id: 'post-1', title: 'Collected carousel', platform: 'instagram', sourceUrl: 'https://www.instagram.com/p/ABC/',
  crawledAt: '2026-10-26T00:00:00Z', aiAnalysis: JSON.stringify({ contentFormat: 'image', source: 'apify-image', caption: 'Original caption',
    imageUrls: ['/api/overseas/videos/post-1/image/0', '/api/overseas/videos/post-1/image/1'] }) };

test('collected carousel frames retain their own image index and the original post identity', () => {
  assert.deepEqual(collectedImageReferences([collected]), [0, 1].map(imageIndex => ({
    url: `/api/overseas/videos/post-1/image/${imageIndex}`, imageIndex,
    title: `${collected.title} · 第 ${imageIndex + 1} 张`, sourceRecordId: collected.id,
    sourceUrl: collected.sourceUrl, platform: 'instagram', caption: 'Original caption', collectedAt: collected.crawledAt,
  })));
});

test('generated assets, missing provenance, malformed records and unpersisted images never become benchmark candidates', () => {
  const analysis = JSON.parse(collected.aiAnalysis);
  const invalid = [
    { id: 'frame-1', name: 'Generated first frame', type: 'image', scope: 'own', url: '/media/frame.png' },
    { ...collected, aiAnalysis: JSON.stringify({ ...analysis, source: 'digital-human-target-first-frame' }) },
    { ...collected, aiAnalysis: JSON.stringify({ ...analysis, source: undefined }) },
    { ...collected, aiAnalysis: JSON.stringify({ ...analysis, contentFormat: 'video' }) },
    { ...collected, aiAnalysis: JSON.stringify({ ...analysis, imageUrls: ['https://cdn.test/photo.jpg'] }) },
    { ...collected, aiAnalysis: JSON.stringify({ ...analysis, imageUrls: ['/api/overseas/videos/another-post/image/1'] }) },
    { ...collected, sourceUrl: 'https://instagram.com.evil.test/p/ABC/' },
    { ...collected, sourceUrl: 'file:///tmp/generated.png' },
    { ...collected, aiAnalysis: 'invalid-json' }, null,
  ];
  assert.deepEqual(collectedImageReferences(invalid), []);
});

test('completed reanalysis notifies the inspiration card only after its persisted result is returned', async () => {
  const { reanalyzeCollectedImageReference, INSPIRATION_IMAGE_ANALYSIS_UPDATED_EVENT } = await import('./imageReplicationReferences');
  const previous = new Map(['window','localStorage','fetch'].map(key => [key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const events: unknown[] = []; let calls = 0;
  const target = new EventTarget();
  target.addEventListener(INSPIRATION_IMAGE_ANALYSIS_UPDATED_EVENT, event => events.push((event as CustomEvent).detail));
  Object.defineProperty(globalThis,'window',{configurable:true,value:target});
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>null}});
  Object.defineProperty(globalThis,'fetch',{configurable:true,value:async (url: string, options: RequestInit) => {
    calls++;assert.equal(url,'/api/overseas/videos/post-1/reanalyze-image');assert.equal(options.method,'POST');
    return Response.json({ok:true,record:collected});
  }});
  try {
    await reanalyzeCollectedImageReference('post-1');
    assert.equal(calls,1);assert.deepEqual(events,[{sourceRecordId:'post-1',record:collected}]);
    Object.defineProperty(globalThis,'fetch',{configurable:true,value:async(_url: string, options: RequestInit)=>{
      calls++; assert.deepEqual(JSON.parse(String(options.body)),{imageIndex:4});
      return Response.json({ok:true,record:collected});
    }});
    await reanalyzeCollectedImageReference('post-1','/api/overseas/videos/post-1/image/3');
    assert.equal(calls,2);
    await assert.rejects(reanalyzeCollectedImageReference('post-1','/api/overseas/videos/other/image/3'),/不一致/);
    assert.equal(calls,2,'foreign reference must not submit a supplier request');
    Object.defineProperty(globalThis,'fetch',{configurable:true,value:async()=>Response.json({ok:false,error:'image_post_analysis_provider_result_unknown'},{status:409})});
    await assert.rejects(reanalyzeCollectedImageReference('post-1'), error => (error as {payload?:{code?:string}}).payload?.code === 'image_post_analysis_provider_result_unknown');
    assert.equal(events.length,2,'an uncertain write must not refresh the card as analyzed');
  } finally {
    for(const [key,descriptor] of previous) { if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key); }
  }
});
