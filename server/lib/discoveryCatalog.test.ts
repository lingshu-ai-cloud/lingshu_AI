import { selectDiscoveryCatalog } from '../../shared/discoveryCatalog.js';
import assert from 'node:assert/strict';
import { discoveryCatalog } from './discoveryCatalog.js';
import type { EnterpriseProfile } from '../routes/enterprise.js';
const profile = { products: { items: [{ name: '面膜', category: '护肤', retailPrice: '99', documents: [
  { name: '产品表.pdf', size: 123, url: '/api/overseas/enterprise/assets/product.pdf' },
  { name: '外部.pdf', size: 456, url: 'https://untrusted.example/secret.pdf' },
] }] } } as EnterpriseProfile;
const items = discoveryCatalog(profile);
assert.equal(items.length, 1);
assert.equal(items[0].files[0].available, true);
assert.equal(items[0].files[1].available, false);
assert.equal(items[0].files[1].url, '');
assert.ok(!items[0].text.includes('retailPrice'));
assert.deepEqual(discoveryCatalog(profile), items);
assert.deepEqual(discoveryCatalog({ products: { items: [] } } as unknown as EnterpriseProfile), []);
console.log('Knowledge catalog references, stable IDs and file address restrictions passed');

const other = { ...items[0], id: 'other', name: '洗发水', text: '洗发水', files: [] };
assert.deepEqual(selectDiscoveryCatalog([...items, other], [other.id], []).products.map(product => product.name), ['洗发水']);
assert.equal(selectDiscoveryCatalog(items, [], [items[0].files[0].id]).products.length, 0);
assert.equal(selectDiscoveryCatalog(items, [], [items[0].files[0].id]).files.length, 1);
assert.throws(() => selectDiscoveryCatalog(items, ['stale'], []), /变化/);
assert.throws(() => selectDiscoveryCatalog(items, [], [items[0].files[1].id]), /不支持/);
console.log('Only selected products/files are included; stale selections fail explicitly');
