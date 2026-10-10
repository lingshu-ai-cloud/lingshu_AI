import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import { getFacebookVideos, getInstagramMedia, getTikTokVideos } from '../integrations/social.js';
import { getMyVideos } from '../integrations/youtube.js';
import { normalizeMetricValues } from './aggregation.js';

test('platform video adapters preserve unavailable metrics and explicit zeroes', async () => {
  const originalGet = axios.get, originalPost = axios.post;
  const rows = [
    { id: 'missing', snippet: { title: 'Missing' }, contentDetails: { duration: 'PT8S' } },
    { id: 'zero', view_count: 0, like_count: '0', comment_count: 0, share_count: '0', views: 0,
      likes: { summary: { total_count: 0 } }, comments: { summary: { total_count: '0' } }, comments_count: 0,
      snippet: { title: 'Zero' }, contentDetails: { duration: 'PT8S' }, statistics: { viewCount: '0', likeCount: '0', commentCount: '0' } },
  ];
  try {
    axios.post = (async () => ({ data: { data: { videos: rows } } })) as typeof axios.post;
    axios.get = (async (url: string) => {
      if (url.endsWith('/channels')) return { data: { items: [{ contentDetails: { relatedPlaylists: { uploads: 'uploads' } } }] } };
      if (url.endsWith('/playlistItems')) return { data: { items: rows.map(row => ({ contentDetails: { videoId: row.id } })) } };
      return { data: { data: rows, items: rows } };
    }) as typeof axios.get;
    const results = [
      await getTikTokVideos('local-fixture'), await getFacebookVideos('page', 'local-fixture', 'v1'),
      await getInstagramMedia('ig', 'local-fixture', 'v1'),
      await getMyVideos({ clientId: 'fixture', clientSecret: 'fixture', accessToken: 'local-fixture' }),
    ];
    for (const videos of results) {
      const [missing, zero] = videos;
      assert.deepEqual(normalizeMetricValues({ views: missing.viewCount, likes: missing.likeCount, comments: missing.commentCount }), {});
      assert.equal(zero.likeCount, 0);
      assert.equal(zero.commentCount, 0);
    }
    assert.equal(results[0][0].shareCount, undefined);
    assert.equal(results[0][1].shareCount, 0);
    assert.equal(results[1][1].viewCount, 0);
    assert.equal(results[2][1].viewCount, undefined, 'Instagram listing does not report plays');
    assert.equal(results[3][1].viewCount, 0);
  } finally {
    axios.get = originalGet; axios.post = originalPost;
  }
});
