import assert from 'node:assert/strict';
import test from 'node:test';
import {assertWeeklyOriginalDatasetAccountRows} from './weeklyAccountCollectionDatasetContinuation.js';
import {weeklyOriginalDatasetDirectMediaUrl} from './weeklyOriginalDatasetDirectMedia.js';

const account='https://www.tiktok.com/@fixture_factory';
const row={id:'1234567890123456789',webVideoUrl:`${account}/video/1234567890123456789`,videoMeta:{downloadAddr:'https://v16-webapp-prime.us.tiktok.com/video/tos/useast2a/file.mp4'}};

test('original Dataset requires an exact account video and accepts a missing direct URL for bounded page download',()=>{
 assert.equal(weeklyOriginalDatasetDirectMediaUrl(row),row.videoMeta.downloadAddr);
 assert.deepEqual(assertWeeklyOriginalDatasetAccountRows([row],account),[row]);
 const pageFallback={...row,videoMeta:{downloadAddr:'https://attacker.example/video.mp4'}};
 assert.equal(weeklyOriginalDatasetDirectMediaUrl(pageFallback),null);
 assert.deepEqual(assertWeeklyOriginalDatasetAccountRows([pageFallback],account),[pageFallback]);
 assert.throws(()=>assertWeeklyOriginalDatasetAccountRows([{...row,webVideoUrl:'https://www.tiktok.com/@other/video/1234567890123456789'}],account),/dataset_account_or_video_identity_unverified/);
});

test('nested mediaUrls are accepted but page URLs are not treated as media',()=>{
 const nested={...row,videoMeta:{},mediaUrls:['https://www.tiktok.com/@fixture_factory/video/1234567890123456789','https://v19.tiktokcdn-us.com/a/b/video.mp4']};
 assert.equal(weeklyOriginalDatasetDirectMediaUrl(nested),'https://v19.tiktokcdn-us.com/a/b/video.mp4');
});
