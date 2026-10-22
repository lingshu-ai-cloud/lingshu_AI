import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tiktokKeywordSources, verifiedKeywordSeedItems, verifiedSeedUrls } from './videoCrawlerSeedCatalog.js';

test('static public source catalog keeps platform and keyword selection stable', () => {
  assert.deepEqual(verifiedSeedUrls('facebook', 'makeup organizer'), [
    'https://www.facebook.com/reel/3780715202246518/',
    'https://www.facebook.com/reel/1107981953969038/',
    'https://www.facebook.com/reel/1289095572348297/',
  ]);
  assert.equal(verifiedSeedUrls('facebook', 'amazon gadgets').length, 6);
  assert.equal(verifiedSeedUrls('instagram', 'skincare').length, 5);
  assert.deepEqual(verifiedSeedUrls('linkedin', 'skincare'), []);
  assert.equal(tiktokKeywordSources('skincare routine').length, 6);
  assert.deepEqual(tiktokKeywordSources('makeup tutorial'), [
    'https://www.tiktok.com/@fentybeauty', 'https://www.tiktok.com/@nyxcosmetics',
  ]);
  assert.deepEqual(tiktokKeywordSources('amazon gadgets'), ['https://www.tiktok.com/@amazonhome']);
});

test('static fallback items keep source metadata without claiming downloaded evidence', () => {
  const skincare = verifiedKeywordSeedItems('instagram', 'skincare routine');
  assert.equal(skincare.length, 22);
  assert.equal(skincare[0]?.sourceUrl, 'https://www.instagram.com/reel/DaFQoIIy0Vj/');
  assert.ok(skincare.every(item => item.platform === 'instagram' && item.duration === 0));
  const generic = verifiedKeywordSeedItems('instagram', 'amazon gadgets');
  assert.equal(generic.length, 5);
  assert.equal(generic[0]?.title, 'Instagram public reel DTIaejUANMW');
  assert.ok(generic.every(item => item.platform === 'instagram' && item.duration === 0));
  assert.equal(verifiedKeywordSeedItems('tiktok', 'skincare routine').length, 6);
  assert.equal(verifiedKeywordSeedItems('youtube', 'skincare routine').length, 5);
  assert.equal(verifiedKeywordSeedItems('facebook', 'skincare routine').length, 16);
  assert.deepEqual(verifiedKeywordSeedItems('linkedin', 'skincare routine'), []);
});
