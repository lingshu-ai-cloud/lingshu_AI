import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CreationMaterialHistory from './CreationMaterialHistory';
import type { StudioProject } from '../../lib/studioApi';

test('history shows persisted acceptance and canonical creation-mode labels in creation order', () => {
  const projects: StudioProject[] = [
    { id: 'old', title: '较早创作', status: 'draft', spec: { creationPath: 'free_creation' }, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-08T00:00:00Z' },
    { id: 'new', title: '最新创作', status: 'draft', spec: { creationPath: 'viral_replication', renderOutputPreviewUrl: '/video.mp4', renderAcceptance: { accepted: true, renderPath: '/video.mp4' } }, createdAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z' },
  ];
  const html = renderToStaticMarkup(<CreationMaterialHistory projects={projects} loading={false} error="" onBack={() => {}} onOpenProject={() => {}} />);
  assert.match(html, /<table/);
  assert.ok(html.indexOf('最新创作') < html.indexOf('较早创作'));
  assert.match(html, /已验收成片/);
  assert.match(html, /爆款复刻模式/);
  assert.match(html, /自由创作模式/);
  assert.match(html, /尚无原片分析/);
});
