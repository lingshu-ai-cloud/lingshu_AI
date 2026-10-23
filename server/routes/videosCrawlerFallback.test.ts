import { readVideoApplicationSources } from '../../tests/fixtures/videoApplicationSources.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crawlFailureMessage, youtubeHtmlSearchUrl } from './videos.js';

const quota = 'Apify TikTok HTTP 403: platform-feature-disabled: Monthly usage hard limit exceeded';
assert.match(crawlFailureMessage('TikTok', ['local search failed', quota], 'no videos'), /HTTP 403/);
assert.match(crawlFailureMessage('TikTok', ['local search failed', quota], 'no videos'), /Monthly usage hard limit exceeded/);
assert.equal((crawlFailureMessage('Instagram', [quota, quota], 'no videos').match(/Monthly usage/g) || []).length, 1);

const weekly = youtubeHtmlSearchUrl('face cleanser supplier', '2026-10-04', '2026-10-11');
assert.match(weekly.url, /search_query=face%20cleanser%20supplier/);
assert.match(weekly.url, /sp=EgIIAw%253D%253D/);
assert.equal(weekly.dateEvidence, 'youtube-upload-filter');

const route = readVideoApplicationSources();
const publicDiscovery = readFileSync(new URL('./videoCrawlerPublicDiscovery.ts', import.meta.url), 'utf8');
assert.match(route, /crawlYouTubePublicSearch\(\{ keyword, limit, dateFrom, dateTo, crawlFlatSearch: crawlYtDlpSearch \}\)/);
assert.match(publicDiscovery, /YouTube yt-dlp search failed, trying HTML search/);
assert.match(publicDiscovery, /dateEvidence,/);

console.log('crawler fallback tests passed');
