import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./InspirationDashboard.tsx', import.meta.url), 'utf8');
const watchModal = source.slice(source.indexOf('function WatchModal'), source.indexOf('interface DirectorReviewHandoff'));

assert.match(watchModal, /zIndex=\{2200\}/, 'the original-content preview must render above the Ant detail drawer');
assert.match(watchModal, /video\.videoUrl && !useEmbedPlayer/);
assert.match(watchModal, /embedUrl \?/);
assert.match(watchModal, />原站打开</);

console.log('Inspiration preview stacking and fallback contract passed');
