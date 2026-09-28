import '../server/loadEnvironment.js';
import fs from 'node:fs';
import path from 'node:path';
import { runWithDataAuthority } from '../server/storage/dataAuthority.js';
import { readTenantEnterpriseProfile, updateTenantEnterpriseProfile } from '../server/routes/enterprise.js';
const tenant = 'local_tenant_customer_1b2913131e2c46deab66172228c4df0a';
const catalog = JSON.parse(fs.readFileSync('fixtures/beauty-showcase/product-catalog.json', 'utf8'));
const assetSource = 'fixtures/beauty-showcase/media/tenants/local_tenant_customer_aurelia_beauty';
const assetTarget = `data/media/tenants/${tenant}/rongshang-products`;
await runWithDataAuthority('local', async () => {
  const before = await readTenantEnterpriseProfile(tenant);
  fs.mkdirSync('output/rongshang-import-20260928', { recursive: true });
  const backup = 'output/rongshang-import-20260928/profile-before.json';
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, JSON.stringify(before, null, 2));
  fs.mkdirSync(assetTarget, { recursive: true });
  const incoming = catalog.products.map((p: any) => {
    if (p.imageFile) fs.copyFileSync(path.join(assetSource, p.imageFile), path.join(assetTarget, p.imageFile));
    return { sku: p.sku, name: p.name, category: p.category, brand: p.brand,
      retailPrice: `¥${p.retailPriceCny}`, priceRange: `¥${p.retailPriceCny} / US$${p.retailPriceUsd}`,
      certifications: p.certifications, highlights: p.highlights.join('；'),
      ...(p.imageFile ? { imageUrl: `/media/tenants/${tenant}/rongshang-products/${p.imageFile}` } : {}),
      attributes: { 货盘序号: p.number, 净含量: p.netContent || '附件未标注', 美元建议零售价: `US$${p.retailPriceUsd}`, 核心场景: p.scene, 来源文件: catalog.source.fileName, 来源页码: p.sourcePage, 原图状态: p.imageFile ? '已从附件直接提取' : '附件未嵌入产品图' } };
  });
  const merged = [...(before.products?.items || []).filter((item: any) => !incoming.some((p: any) => p.sku === item.sku)), ...incoming];
  await updateTenantEnterpriseProfile(tenant, {
    products: { ...before.products, categories: [...new Set(merged.map((p: any) => p.category).filter(Boolean))].join('、'), items: merged },
    ...(!before.brand?.name ? { brand: { ...before.brand, name: catalog.source.brand } } : {}),
  }, 'local-rongshang-catalog-import');
  const after = await readTenantEnterpriseProfile(tenant);
  if (after.products.items.filter((p: any) => incoming.some((i: any) => i.sku === p.sku)).length !== 41) throw new Error('catalog_count_mismatch');
  if (JSON.stringify(after.socialStrategy) !== JSON.stringify(before.socialStrategy)) throw new Error('social_strategy_changed');
  console.log(JSON.stringify({ tenant, imported: incoming.length, total: after.products.items.length, images: incoming.filter((p: any) => p.imageUrl).length, brand: after.brand.name, ctaPreserved: true }));
});
