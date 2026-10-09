import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SocialCreationWorkbench, { assignReplicationDefaultProduct, resolveReplicationProductMappings } from './SocialCreationWorkbench';

const slots = [
  { shotId: 'spoken-product-serum', sourceLabel: 'serum' },
  { shotId: 'spoken-product-lotion', sourceLabel: 'lotion' },
];
const products = [
  { id: 'enterprise-a', name: '企业产品 A' },
  { id: 'enterprise-b', name: '企业产品 B' },
];

assert.deepEqual(resolveReplicationProductMappings(slots, products, 'enterprise-a', {}), [
  { sourceTerm: 'serum', productId: 'enterprise-a', productName: '企业产品 A' },
  { sourceTerm: 'lotion', productId: 'enterprise-a', productName: '企业产品 A' },
], 'all source terms default to the same selected enterprise product');
assert.deepEqual(resolveReplicationProductMappings(slots, products, 'enterprise-a', { 'spoken-product-lotion': 'enterprise-b' }), [
  { sourceTerm: 'serum', productId: 'enterprise-a', productName: '企业产品 A' },
  { sourceTerm: 'lotion', productId: 'enterprise-b', productName: '企业产品 B' },
], 'an explicit per-term override remains available');
assert.deepEqual(resolveReplicationProductMappings(slots, products, 'enterprise-a', { 'spoken-product-lotion': '' })[1],
  { sourceTerm: 'lotion', productId: '', productName: '' },
  'clearing an override must not silently restore the default product');
const restoredAssignments = { 'spoken-product-serum': 'enterprise-a', 'spoken-product-lotion': 'enterprise-b' };
assert.equal(resolveReplicationProductMappings(slots, products, 'enterprise-b', restoredAssignments)[0]?.productId, 'enterprise-a',
  'a restored per-term assignment takes precedence until the user changes the default');
const changedDefaultAssignments = assignReplicationDefaultProduct(slots, 'enterprise-b');
assert.deepEqual(resolveReplicationProductMappings(slots, products, 'enterprise-b', changedDefaultAssignments), [
  { sourceTerm: 'serum', productId: 'enterprise-b', productName: '企业产品 B' },
  { sourceTerm: 'lotion', productId: 'enterprise-b', productName: '企业产品 B' },
], 'changing the default replaces restored mappings for every source term');
assert.deepEqual(resolveReplicationProductMappings([], products, 'enterprise-a', {}), [],
  'a reference without source products produces no product mappings');

const workbenchSource = fs.readFileSync(new URL('./SocialCreationWorkbench.tsx', import.meta.url), 'utf8');
assert.match(workbenchSource, /const chooseDefaultProduct = \(id: string\) => \{[\s\S]*?setProductAssignments\(assignReplicationDefaultProduct\(productSlots, id\)\)/,
  'changing the default must replace the restored assignments');
assert.match(workbenchSource, /onChange=\{\(\) => chooseDefaultProduct\(item\.id\)\}/,
  'the primary product picker must apply the replacement assignments');
assert.match(workbenchSource, /全部使用默认产品/,
  'a restored override can be reset even when the default radio is already selected');
assert.match(workbenchSource, /if \(productSelectionChanged \|\| !seed\?\.productMappings\?\.length/,
  'a later catalog refresh must not restore stale seed assignments');
assert.match(workbenchSource, /if \(!isReplication \|\| productSelectionChanged \|\| !saved\?\.length/,
  'old confirmed speech must not be restored after product mappings change');

const noProductHtml = renderToStaticMarkup(<SocialCreationWorkbench
  mode="viral_replication"
  seed={{ referenceShots: [{ time: '0–1s', dialogue: 'Hello, boss!', visual: '城市街景' }] }}
  onOpenChooser={() => {}} onShowCreations={() => {}} onGenerate={() => {}}
/>);
assert.ok(noProductHtml.includes('无需选择企业产品'));
assert.ok(!noProductHtml.includes('aria-label="选择企业知识库产品"'));
assert.ok(!noProductHtml.includes('aria-label="产品映射设置"'));

const multipleProductHtml = renderToStaticMarkup(<SocialCreationWorkbench
  mode="viral_replication"
  seed={{ referenceShots: [{ time: '0–3s', dialogue: 'Try our serum and lotion.', visual: '产品展示' }] }}
  onOpenChooser={() => {}} onShowCreations={() => {}} onGenerate={() => {}}
/>);
assert.ok(multipleProductHtml.includes('选择默认产品会将所有对象设为同一款'));
assert.ok(multipleProductHtml.includes('aria-label="选择企业知识库产品"'));
assert.ok(multipleProductHtml.includes('产品映射 · 2 项'));
