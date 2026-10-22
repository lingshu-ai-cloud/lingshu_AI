import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TrendVideo } from '../../lib/inspirationTypes';
import { buildShootingNeeds, shootingCreationDate } from './inspirationShootingNeeds';

const video = { id: 'video-a', platform: 'tiktok', title: '工厂产品展示', thumbnail: '',
  duration: 15, tags: [], views: '100', trend: 'stable', contentFormat: 'video',
  crawledAt: '2026-10-22T08:00:00Z', aiAnalysis: { gemini: { scriptDetails15s: [
    { time: '0-2s', visual: '产品包装特写', subtitle: '', audio: '', note: '' },
  ] } } } as TrendVideo;

test('shooting gaps use observed analysis and preserve first-three-second priority', () => {
  assert.deepEqual(buildShootingNeeds([], []), []);
  const needs = buildShootingNeeds([video], []);
  assert.equal(needs.length, 1);
  assert.equal(needs[0]?.title, '产品包装/质地特写');
  assert.equal(needs[0]?.priority, '高');
  assert.equal(needs[0]?.count, 1);
  assert.equal(needs[0]?.ratio, '9:16');
  assert.equal(needs[0]?.createdAt, video.crawledAt);
});

test('shooting creation date retains explicit unknown state', () => {
  assert.equal(shootingCreationDate(), '待补录');
  assert.match(shootingCreationDate('2026-10-22T08:00:00Z'), /2026/);
});
