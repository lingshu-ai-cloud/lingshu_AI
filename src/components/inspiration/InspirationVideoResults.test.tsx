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
  assert.match(markup, /正在读取灵感库存/);
  assert.doesNotMatch(markup, /暂无真实视频数据/);
});

test('a completed empty inventory shows the real no-data state', () => {
  const markup = renderToStaticMarkup(<InspirationVideoResults {...baseProps} loaded loading={false} />);
  assert.match(markup, /暂无真实视频数据/);
});


test('filtered pagination uses exact result total, including a partial last page', () => {
  const markup = renderToStaticMarkup(<InspirationVideoResults {...baseProps} loaded loading={false}
    showPagination page={2} totalPages={2} totalItems={101} />);
  assert.match(markup, /共 101 条/);
  assert.match(markup, /第 2 \/ 2 页/);
  assert.match(markup, /aria-label="灵感发现分页"/);
  assert.doesNotMatch(markup, /共 200 条/);
});


test('an empty filtered result offers reset instead of claiming the inventory is empty', () => {
  const markup = renderToStaticMarkup(<InspirationVideoResults {...baseProps} loaded loading={false} platformFiltered />);
  assert.match(markup, /没有匹配当前筛选条件的结果/);
  assert.match(markup, /清除搜索并重置筛选/);
  assert.doesNotMatch(markup, /暂无真实视频数据/);
});
