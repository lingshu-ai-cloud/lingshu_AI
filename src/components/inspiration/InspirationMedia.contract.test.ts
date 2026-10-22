import assert from 'node:assert/strict';
import fs from 'node:fs';

const media = fs.readFileSync(new URL('./InspirationMedia.tsx', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../InspirationDashboard.tsx', import.meta.url), 'utf8');
const cards = fs.readFileSync(new URL('../InspirationVideoCards.tsx', import.meta.url), 'utf8');

assert.match(page, /export \{ AuthenticatedVideo, ThumbnailImage, VideoThumbnail \} from '\.\/inspiration\/InspirationMedia'/,
  'existing page media exports must remain available');
assert.match(cards, /from '\.\/inspiration\/InspirationMedia'/,
  'video cards must import media directly');
assert.doesNotMatch(cards, /from '\.\/InspirationDashboard'/,
  'video cards must not import the page and recreate the circular dependency');
assert.match(media, /isRemoteSignedUrl[\s\S]*if \(isRemoteSignedUrl\) return <LsProgressiveMedia/,
  'signed remote images must continue to load directly');
assert.match(media, /fetch\(src, \{ headers: authHeader\(\), cache: 'no-store'/,
  'protected images must still fetch with authentication');
assert.match(media, /resolveInspirationPlaybackUrl\(apiUrl, \{ signal: controller\.signal, headers: authHeader\(\) \}\)/,
  'protected videos must still resolve playback with authentication and cancellation');
assert.match(media, /resolverTimer = window\.setTimeout\([\s\S]*15_000/,
  'video playback resolution must still have a timeout');
assert.match(media, /generation === generationRef\.current[\s\S]*mediaRetryRef\.current < 1/,
  'late media responses must be fenced and media failures retried at most once');
assert.match(media, /onNaturalAspectRatio\?\.\(image\.naturalWidth \/ image\.naturalHeight\)/,
  'image intrinsic proportions must still reach the card layout');

console.log('inspiration media boundary and compatibility passed');
