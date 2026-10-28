/** Export one tenant's product facts and owned product images. Never commit the output. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const tenantId = process.argv[2];
const output = process.argv[3];
if (!tenantId || !/^[a-zA-Z0-9_-]+$/.test(tenantId) || !output) {
  throw new Error('Usage: tsx scripts/export-product-bundle.ts <source-tenant-id> <private-output.json>');
}
const root = process.cwd();
const rows = JSON.parse(fs.readFileSync(path.join(root, 'data/local-store/tenant_profiles.json'), 'utf8')) as Array<Record<string, unknown>>;
const owned = rows.filter(row => row.tenant_id === tenantId);
if (owned.length !== 1) throw new Error(`Expected one source profile for ${tenantId}, found ${owned.length}`);
const profile = owned[0]!.profile as { products?: { items?: Array<Record<string, unknown>> } };
const products = profile.products?.items;
if (!Array.isArray(products) || !products.length) throw new Error('Source profile has no products');
const mediaRoot = path.resolve(root, 'data/media/tenants', tenantId);
type Asset = { productIndex: number; field: string; name: string; mimeType: string; sha256: string; dataBase64: string };
const assets: Asset[] = [];
const seen = new Set<string>();
const allowedFields = ['images', 'packagingImages', 'factoryImages', 'certificateImages', 'sceneImages', 'brandAssets'];
const add = (productIndex: number, field: string, url: string, name: string) => {
  if (!url) return;
  let file: string;
  if (url.startsWith('/media/tenants/')) file = path.resolve(root, 'data', url.slice(1));
  else if (url.startsWith('tenants/')) file = path.resolve(root, 'data/media', url);
  else throw new Error(`Non-local image cannot be bundled: ${name}`);
  if (!file.startsWith(mediaRoot + path.sep) || !fs.existsSync(file)) throw new Error(`Missing or foreign source image: ${name}`);
  const key = `${productIndex}\0${file}`;
  if (seen.has(key)) return;
  seen.add(key);
  const bytes = fs.readFileSync(file);
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error(`Invalid image size: ${name}`);
  const ext = path.extname(file).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) throw new Error(`Unsupported image: ${name}`);
  assets.push({ productIndex, field, name: name.slice(0, 160), mimeType: ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg',
    sha256: createHash('sha256').update(bytes).digest('hex'), dataBase64: bytes.toString('base64') });
};
const cleanProducts = products.map((source, index) => {
  const product = { ...source };
  if (typeof product.imageUrl === 'string') add(index, 'imageUrl', product.imageUrl, `${String(product.name || index)}-主图`);
  delete product.imageUrl;
  for (const field of allowedFields) {
    const list = Array.isArray(product[field]) ? product[field] as Array<Record<string, unknown>> : [];
    list.forEach((asset, assetIndex) => add(index, field, String(asset.url || ''), String(asset.name || `${product.name || index}-${assetIndex}`)));
    delete product[field];
  }
  return product;
});
const bundle = { schemaVersion: 'lingshu-product-bundle.v1', exportedAt: new Date().toISOString(),
  productCount: cleanProducts.length, assetCount: assets.length, products: cleanProducts, assets };
const target = path.resolve(output);
if (target.startsWith(root + path.sep) && !target.startsWith(path.join(root, 'data/private-product-bundles') + path.sep)) {
  throw new Error('Output inside repository must be under ignored data/private-product-bundles/');
}
fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
fs.writeFileSync(target, JSON.stringify(bundle), { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({ output: target, products: cleanProducts.length, images: assets.length, bytes: fs.statSync(target).size }));
