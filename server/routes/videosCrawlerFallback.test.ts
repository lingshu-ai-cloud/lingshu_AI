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

const source = readFileSync(new URL('./videos.ts', import.meta.url), 'utf8');
const youtube = source.slice(source.indexOf('async function crawlYouTubeSearch'), source.indexOf('async function crawlYouTubeUploadDateFilteredSearch'));
assert.doesNotMatch(youtube, /catch \(e\) \{\s*throw new Error\(`YouTube Shorts search failed/,
  'yt-dlp failure must not make the existing HTML parser unreachable');
assert.match(youtube, /YouTube yt-dlp search failed, trying HTML search/);
assert.match(youtube, /dateEvidence,/);

console.log('crawler fallback tests passed');
