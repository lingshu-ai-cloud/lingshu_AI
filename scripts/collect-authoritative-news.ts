import { collectAuthoritativeNews } from '../server/externalInformation/authoritativeNews.js';

if (process.env.NODE_ENV === 'production') throw Error('This collector is local-development only.');
const snapshot = await collectAuthoritativeNews();
console.log(JSON.stringify({ fetchedAt: snapshot.fetchedAt, count: snapshot.items.length,
  items: snapshot.items.map(({ publisher, title, url, publishedAt }) => ({ publisher, title, url, publishedAt })), failures: snapshot.failures }, null, 2));
