import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { InspirationImageCrawlResult } from '../../lib/inspirationImageCrawl';
import { runInspirationImageCrawl } from './inspirationImageCrawlAction';

function fixture(items: InspirationImageCrawlResult['items']): InspirationImageCrawlResult {
  return {
    platform: 'instagram', keyword: 'factory', imported: items.length, skipped: 0,
    returnedExisting: 0, requested: 10, total: items.length, message: '', items,
  };
}

function contextFor(result: InspirationImageCrawlResult) {
  const events: string[] = [];
  const searchRef = { current: 'factory' };
  const context: Parameters<typeof runInspirationImageCrawl>[0] = {
    busy: false, platform: 'instagram', keyword: 'factory', limit: 10,
    setBusy: value => events.push(`busy:${value}`),
    setError: value => events.push(`error:${value}`),
    setContentFormat: value => events.push(`format:${value}`),
    setPlatform: value => events.push(`platform:${value}`),
    setCrawlTimeRange: value => events.push(`range:${value}`),
    setSearch: value => events.push(`search:${value}`),
    searchRef,
    setSortMode: value => events.push(`sort:${value}`),
    setLastCrawlVideoIds: value => events.push(`ids:${value.join(',')}`),
    setOpen: value => events.push(`open:${value}`),
    setMaterialMessage: value => events.push(`message:${value}`),
    refreshInventory: async format => { events.push(`inventory:${format}`); },
    refreshVideos: async (page, quiet, filters) => { events.push(`videos:${page}:${quiet}:${filters.contentFormat}:${filters.platform}:${filters.search}`); },
    crawl: async () => result,
    authorization: () => ({ Authorization: 'Bearer test' }),
  };
  return { context, events, searchRef };
}

test('successful crawl selects persisted image records and refreshes both inventories', async () => {
  const { context, events, searchRef } = contextFor(fixture([{ id: 'image-1', platform: 'instagram', title: 'Factory' }]));
  await runInspirationImageCrawl(context);
  assert.deepEqual(events, [
    'busy:true', 'error:', 'format:image', 'platform:instagram', 'range:all', 'search:',
    'sort:crawlTime', 'ids:crawl-image-1', 'open:false', 'message:图片采集完成，共返回 1 条',
    'inventory:image', 'videos:1:false:image:instagram:', 'busy:false',
  ]);
  assert.equal(searchRef.current, '');
});

test('empty and busy crawls do not replace the visible inventory', async () => {
  const { context, events } = contextFor(fixture([]));
  await runInspirationImageCrawl(context);
  assert.deepEqual(events, ['busy:true', 'error:', 'error:未找到可入库图片，请换一个关键词或平台', 'busy:false']);
  events.length = 0;
  await runInspirationImageCrawl({ ...context, busy: true });
  assert.deepEqual(events, []);
});

test('an old account response cannot write image results into a new account view', async () => {
  const { context, events } = contextFor(fixture([{ id: 'image-1', platform: 'instagram' }]));
  let token = 'old';
  context.authorization = () => ({ Authorization: `Bearer ${token}` });
  context.crawl = async () => {
    token = 'new';
    return fixture([{ id: 'image-1', platform: 'instagram' }]);
  };
  await runInspirationImageCrawl(context);
  assert.deepEqual(events, ['busy:true', 'error:', 'busy:false']);
});
