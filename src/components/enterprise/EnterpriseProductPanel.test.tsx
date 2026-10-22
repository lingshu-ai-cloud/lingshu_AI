import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import EnterpriseProductPanel from './EnterpriseProductPanel';
import type { ProductItem, Profile } from './enterpriseProfileTypes';

const noOp = () => {};
const product: ProductItem = { name: '精华液 A', category: '美妆', documents: [{ name: '检测报告.pdf', type: 'application/pdf', size: 2048, updatedAt: '2026-10-22' }] };
const profileProducts: Profile['products'] = { categories: '', priceRange: '', moq: '', certifications: '', highlights: '', items: [] };

function props(overrides: Partial<ComponentProps<typeof EnterpriseProductPanel>> = {}): ComponentProps<typeof EnterpriseProductPanel> {
  return {
    profileProducts,
    products: [],
    visibleProducts: [],
    completed: false,
    assetStats: { documents: 0, creative: 0 },
    productsDeepLink: null,
    productsDeepLinkResolved: false,
    deepLinkedProduct: null,
    deepLinkMaterialCount: 0,
    openProductMaterials: noOp,
    openMaterialLibrary: noOp,
    onProductFieldChange: noOp,
    productImporting: false,
    productImportMessage: '',
    importProductSheet: async () => {},
    addProduct: noOp,
    productPage: 1,
    pageSize: 5,
    expandedProductIndexes: new Set(),
    setExpandedProductIndexes: noOp,
    removeProduct: noOp,
    updateProduct: noOp,
    addProductDocuments: async () => {},
    removeProductDocument: noOp,
    maxProductDocuments: 3,
    setProductPage: noOp,
    ...overrides,
  };
}

test('empty product panel retains the unique material-library entry and import controls', () => {
  const html = renderToStaticMarkup(<EnterpriseProductPanel {...props()} />);
  assert.match(html, /产品素材统一在“我的素材”管理/);
  assert.match(html, /还没有产品，先添加一个产品或导入产品表/);
  assert.match(html, /导入产品表/);
  assert.match(html, /添加产品/);
});

test('product deep link distinguishes a unique match from an ambiguous fallback', () => {
  const link = { productName: product.name, materialIds: ['asset-1'], contentItemId: 'content-1' };
  const matched = renderToStaticMarkup(<EnterpriseProductPanel {...props({
    products: [product], visibleProducts: [product], assetStats: { documents: 1, creative: 0 },
    productsDeepLink: link, productsDeepLinkResolved: true, deepLinkedProduct: product, deepLinkMaterialCount: 1,
  })} />);
  assert.match(matched, /已定位到/);
  assert.match(matched, /不会把素材 ID 伪装成页内文件定位/);
  assert.match(matched, /检测报告\.pdf/);
  assert.match(matched, /2KB/);

  const missing = renderToStaticMarkup(<EnterpriseProductPanel {...props({ productsDeepLink: link, productsDeepLinkResolved: true, deepLinkMaterialCount: 1 })} />);
  assert.match(missing, /未能可靠定位任务产品/);
  assert.match(missing, /打开我的素材/);
});

test('upload receipts, pagination and card expansion state remain owned by the page', () => {
  const page = readFileSync(new URL('../EnterprisePage.tsx', import.meta.url), 'utf8');
  assert.match(page, /const \[expandedProductIndexes, setExpandedProductIndexes\] = useState/);
  assert.match(page, /const confirmProductImport = async/);
  assert.match(page, /<EnterpriseProductPanel[\s\S]*?profileProducts=\{profile\.products\}/);
  assert.match(page, /addProductDocuments=\{addProductDocuments\}/);
});
