import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentProps } from 'react';
import InspirationVideoResults from './InspirationVideoResults';

const baseProps: ComponentProps<typeof InspirationVideoResults> = {
  videos: [], visibleVideoCount: 0, loaded: false, loading: true,
  search: '', platformFiltered: false, contentFormat: 'video',
  localMaterialCount: 0, launchingReferences: [], replicationTasks: {},
  creationAccountId: '', favoritingMaterialIds: [], favoritedVideoIds: [],
  favoriteSourceUrls: new Set<string>(), showPagination: false,
  page: 1, totalPages: 1, pageSize: 100,
  onReset: () => {}, onOpenLibrary: () => {}, onSelect: () => {},
  onCreate: () => {}, onWatch: () => {}, onFavorite: () => {},
  onManage: () => {}, onPageChange: () => {},
};

test('initial inventory load does not flash an empty state', () => {
  const markup = renderToStaticMarkup(<InspirationVideoResults {...baseProps} />);
  assert.match(markup, /正在读取真实视频库存/);
  assert.doesNotMatch(markup, /暂无真实视频数据/);
});

test('a completed empty inventory shows the real no-data state', () => {
  const markup = renderToStaticMarkup(<InspirationVideoResults {...baseProps} loaded loading={false} />);
  assert.match(markup, /暂无真实视频数据/);
});
