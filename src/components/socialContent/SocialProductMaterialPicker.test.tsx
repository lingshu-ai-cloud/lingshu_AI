import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SocialProductMaterialPicker } from './SocialProductMaterialPicker';
import type { useSocialProductMaterials } from './useSocialProductMaterials';

const productA = { id: 'product-a', name: '产品 A' };
const productB = { id: 'product-b', name: '产品 B' };
const selection = (patch: Partial<ReturnType<typeof useSocialProductMaterials>> = {}): ReturnType<typeof useSocialProductMaterials> => ({
  candidates: [{ id: 'image-a', name: '产品 A 正面图', folder: 'product', type: 'image', duration: 0, size: '1 MB', url: '/fixture/a.png', productId: productA.id, scope: 'own' }],
  selectedIds: ['image-a'], selectedMaterials: [], error: '', loading: false,
  toggle: () => {}, retry: () => {}, restore: () => {}, selectionSpec: { selected: ['image-a'], materialSnapshots: [], productMaterialSelection: null }, ...patch,
});

test('selected product materials are visible as checked choices and missing product assets are named', () => {
  const html = renderToStaticMarkup(<SocialProductMaterialPicker selection={selection()} products={[productA, productB]} />);
  assert.match(html, /选用素材 产品 A 正面图/);
  assert.match(html, /checked=""/);
  assert.match(html, /产品 B · 0 项/);
  assert.match(html, /暂无可用产品图片或视频/);
  assert.match(html, /当前企业/);
});

test('manual opt-out is rendered unchecked and busy state disables selection', () => {
  const html = renderToStaticMarkup(<SocialProductMaterialPicker selection={selection({ selectedIds: [] })} products={[productA]} disabled />);
  assert.doesNotMatch(html, /checked=""/);
  assert.match(html, /disabled=""/);
});

test('read failures expose retry instead of pretending there are no product assets', () => {
  const html = renderToStaticMarkup(<SocialProductMaterialPicker selection={selection({ error: '素材连接中断' })} products={[productA]} />);
  assert.match(html, /产品素材暂时无法读取/);
  assert.match(html, /素材连接中断/);
  assert.match(html, /重\s*试/);
  assert.doesNotMatch(html, /暂无可用/);
});
