/// <reference path="../pb_data/types.d.ts" />
// Persist the crawl state already used by the account API and its worker receipt.
migrate((app) => {
  const competitorCrawlFields = [
    ['ca_crawl_mode', 'lastCrawlMode'], ['ca_crawl_status', 'crawlStatus'],
    ['ca_crawl_error', 'crawlError'], ['ca_crawl_start', 'crawlStartedAt'],
    ['ca_crawl_end', 'crawlCompletedAt'], ['ca_crawl_job', 'crawlJobId'],
  ];
  const collection = app.findCollectionByNameOrId('competitor_accounts');
  for (const [id, name] of competitorCrawlFields) {
    try { collection.fields.getByName(name); }
    catch { collection.fields.addAt(collection.fields.length, new Field({ id, name, type: 'text', required: false })); }
  }
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId('competitor_accounts');
  for (const id of ['ca_crawl_mode', 'ca_crawl_status', 'ca_crawl_error', 'ca_crawl_start', 'ca_crawl_end', 'ca_crawl_job']) {
    try { collection.fields.removeById(id); } catch {}
  }
  return app.save(collection);
});
