/** Add alpha-verified cutout candidates to an ignored private product migration bundle. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { runLocalProductCutout } from '../server/lib/productCutoutPipeline.js';
import { isVerifiedTransparentProductCutout } from '../server/lib/productIdentityPreparation.js';

type BundleAsset = {
  productIndex: number;
  field: string;
  name: string;
  mimeType: string;
  sha256: string;
  dataBase64: string;
  cutoutSourceSha256?: string;
  kind?: string;
};
type Bundle = {
  schemaVersion: string;
  productCount: number;
  assetCount: number;
  products: Array<{ id?: string; sku?: string; name?: string }>;
  assets: BundleAsset[];
  [key: string]: unknown;
};

const [sourceArg, outputArg, limitArg] = process.argv.slice(2);
if (!sourceArg || !outputArg) throw Error('Usage: tsx scripts/complete-private-product-bundle-cutouts.ts <source.json> <output.json> [limit]');
const root = path.resolve('data/private-product-bundles');
const sourcePath = path.resolve(sourceArg);
const outputPath = path.resolve(outputArg);
if (!sourcePath.startsWith(root + path.sep) || !outputPath.startsWith(root + path.sep) || sourcePath === outputPath)
  throw Error('product_bundle_private_path_required');
if (fs.existsSync(outputPath)) throw Error('product_bundle_output_already_exists');
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8')) as Bundle;
if (source.schemaVersion !== 'lingshu-product-bundle.v1' || source.productCount !== source.products.length || source.assetCount !== source.assets.length)
  throw Error('product_bundle_invalid');
const limit = limitArg === undefined ? Number.POSITIVE_INFINITY : Number(limitArg);
if (!(limit > 0 && (Number.isSafeInteger(limit) || limit === Number.POSITIVE_INFINITY))) throw Error('product_bundle_limit_invalid');
const outputDir = path.join(root, 'generated-cutouts');
fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const sourceAssets = source.assets.filter(asset => asset.field === 'imageUrl');
const missingSourceProducts = source.products.flatMap((product, index) =>
  sourceAssets.some(asset => asset.productIndex === index) ? [] : [product.id || product.sku || `index-${index}`]);
const cutouts: BundleAsset[] = [];
let generated = 0;
for (const asset of sourceAssets) {
  const product = source.products[asset.productIndex];
  if (!product) throw Error('product_bundle_asset_product_missing');
  const id = String(product.id || product.sku || '').trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw Error('product_bundle_product_id_invalid');
  const input = Buffer.from(asset.dataBase64, 'base64');
  if (digest(input) !== asset.sha256 || input.length > 20 * 1024 * 1024) throw Error(`product_bundle_source_invalid:${id}`);
  const cutoutPath = path.join(outputDir, `${id}-${asset.sha256.slice(0, 12)}-cutout.png`);
  let bytes: Buffer;
  if (fs.existsSync(cutoutPath)) bytes = fs.readFileSync(cutoutPath);
  else {
    if (generated >= limit) continue;
    bytes = await runLocalProductCutout(input);
    if (!await isVerifiedTransparentProductCutout(bytes)) throw Error(`product_bundle_cutout_invalid:${id}`);
    fs.writeFileSync(cutoutPath, bytes, { mode: 0o600, flag: 'wx' });
    generated++;
  }
  const metadata = await sharp(bytes).metadata();
  if (metadata.format !== 'png' || !metadata.hasAlpha || !await isVerifiedTransparentProductCutout(bytes))
    throw Error(`product_bundle_cutout_invalid:${id}`);
  cutouts.push({ productIndex: asset.productIndex, field: 'packagingImages', kind: 'transparent_cutout',
    name: `${id}-transparent-cutout.png`, mimeType: 'image/png', sha256: digest(bytes),
    cutoutSourceSha256: asset.sha256, dataBase64: bytes.toString('base64') });
  console.log(JSON.stringify({ productId: id, cutout: cutoutPath, bytes: bytes.length }));
}
if (generated >= limit && cutouts.length < sourceAssets.length) {
  console.log(JSON.stringify({ status: 'partial', alphaVerifiedCutouts: cutouts.length, missingSourceProducts }));
  process.exit(0);
}
const result: Bundle = { ...source, exportedAt: new Date().toISOString(),
  assetCount: source.assets.length + cutouts.length, assets: [...source.assets, ...cutouts],
  cutoutAudit: { alphaVerifiedCutouts: cutouts.length, visualReview: 'required',
    missingSourceProducts, complete: false } };
if (Buffer.byteLength(JSON.stringify(result)) > 60 * 1024 * 1024) throw Error('product_bundle_upload_limit_exceeded');
fs.writeFileSync(outputPath, JSON.stringify(result), { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({ output: outputPath, products: source.products.length,
  alphaVerifiedCutouts: cutouts.length, visualReview: 'required', missingSourceProducts,
  bytes: fs.statSync(outputPath).size }));
