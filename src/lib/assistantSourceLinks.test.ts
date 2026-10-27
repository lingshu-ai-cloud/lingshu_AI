import assert from 'node:assert/strict';
import test from 'node:test';
import { replyVideoPreview, safeSourceUrl, trustedReplyUrl } from './assistantSourceLinks';

test('only safe sourced URLs or exact fixed indexes become navigation actions', () => {
  assert.equal(trustedReplyUrl('https://about.fb.com/news/tag/reels/'), true);
  assert.equal(trustedReplyUrl('https://about.fb.com/invented'), false);
  assert.equal(trustedReplyUrl('https://news.example/article', [{ title: 'News', uri: 'https://news.example/verified' }]), true);
  assert.equal(trustedReplyUrl('https://news.example/article'), false, 'source trust is scoped to this reply');
  for (const value of ['javascript:alert(1)', 'data:text/html,x', 'https://user:secret@news.example/video.mp4']) {
    assert.equal(safeSourceUrl(value), null);
    assert.equal(replyVideoPreview(value), null);
  }
});

test('video previews distinguish playable links from ordinary pages and never autoplay', () => {
  assert.deepEqual(replyVideoPreview('https://media.example/demo.mp4?version=1'), { kind: 'video', url: 'https://media.example/demo.mp4?version=1' });
  const youtube = replyVideoPreview('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(youtube?.kind, 'embed');
  assert.match(youtube?.url || '', /^https:\/\/www\.youtube-nocookie\.com\/embed\//);
  assert.equal(new URL(youtube!.url).searchParams.get('autoplay'), '0');
  assert.equal(replyVideoPreview('https://www.tiktok.com/@brand/video/123456789')?.kind, 'embed');
  assert.equal(replyVideoPreview('https://www.instagram.com/reel/abc/')?.kind, 'embed');
  assert.equal(replyVideoPreview('https://about.fb.com/news/tag/reels/'), null);
  assert.equal(replyVideoPreview('https://www.youtube.com/@brand'), null);
  assert.equal(replyVideoPreview('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ'), null);
});
