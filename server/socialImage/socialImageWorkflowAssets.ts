import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { DataStore } from '../storage/datastore.js';
import { readTenantEnterpriseProfile } from '../routes/enterprise.js';
import { readTenantProductImageBytes } from '../lib/enterpriseProductImageBytes.js';
import { readMaterialLibrary } from '../lib/materialLibrary.js';
import { readTenantMaterialBytes } from '../lib/sentenceReplicationProduction.js';
import { imageRenderRoot } from './socialImageWorkflowCommands.js';
export function imageWorkflowAssets(store: DataStore) {
    function productIdentity(product: Record<string, unknown>, index: number) {
        return String(product.id || product.productId || product.sku || `product-${index}-${String(product.name || '')}`);
    }
    async function enterpriseProductAsset(tenantId: string, productId: string): Promise<{
        name: string;
        bytes: Buffer;
    } | null> {
        const profile = await readTenantEnterpriseProfile(tenantId);
        const products = profile.products.items || [];
        const index = products.findIndex((item, itemIndex) => productIdentity(item as unknown as Record<string, unknown>, itemIndex) === productId);
        const product = index >= 0 ? products[index] : undefined;
        if (!product)
            return null;
        const url = String(product.images?.[0]?.url || product.imageUrl || '');
        const bytes = await readTenantProductImageBytes(tenantId, url);
        return bytes ? { name: String(product.name || productId), bytes } : null;
    }
    async function outputImageBytes(tenantId: string, output: {
        mediaUrl?: string;
        materialId?: string;
    }): Promise<{
        bytes: Buffer;
        mimeType: string;
    } | null> {
        if (output.materialId) {
            const material = await store.getById('materials', output.materialId).catch(() => null)
                || (await readMaterialLibrary(tenantId)).items.find(item => item.id === output.materialId);
            if (material) {
                const loaded = await readTenantMaterialBytes(material as any, tenantId).catch(() => null);
                const expectedHash = String((material as {
                    contentSha256?: string;
                }).contentSha256 || '').toLowerCase();
                if (!loaded || (expectedHash && createHash('sha256').update(loaded.bytes).digest('hex') !== expectedHash))
                    return null;
                return loaded;
            }
        }
        const route = String(output.mediaUrl || '');
        const match = route.match(/^\/api\/overseas\/social-images\/renders\/([a-zA-Z0-9._-]+\.png)$/);
        if (!match)
            return null;
        const file = path.join(imageRenderRoot(tenantId), path.basename(match[1]!));
        return fs.existsSync(file) ? { bytes: fs.readFileSync(file), mimeType: 'image/png' } : null;
    }
    return { enterpriseProductAsset, outputImageBytes };
}
