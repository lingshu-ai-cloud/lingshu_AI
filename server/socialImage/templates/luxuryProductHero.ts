import type { SocialImageCreationTask } from '../../../shared/contracts/socialImageCreation.js';
import type { SocialImageLayerGraph } from '../../../shared/contracts/socialImageLayerGraph.js';

const canvasFor = (ratio: string) => ratio === '1:1' ? { width: 1200, height: 1200 }
  : ratio === '9:16' ? { width: 1080, height: 1920 }
    : { width: 1200, height: 1500 };

export function compileLuxuryProductHero(input: {
  task: SocialImageCreationTask;
  productId: string;
  productName: string;
  logoAssetId?: string;
  now?: string;
}): SocialImageLayerGraph {
  const { task } = input;
  const canvas = canvasFor(task.deliverySpec.aspectRatio);
  const headline = task.imageTextContract.headline || task.renderBrief?.headline || input.productName;
  const supporting = task.imageTextContract.supportingText || task.renderBrief?.subheadline || task.contentBrief.coreClaim;
  const cta = task.imageTextContract.cta || task.renderBrief?.cta || task.contentBrief.targetAction || '';
  const layers: SocialImageLayerGraph['layers'] = [
    { id: 'background', kind: 'background', zIndex: 0, rect: { x: 0, y: 0, width: 1, height: 1 }, styleToken: 'luxury-black-gold-gradient' },
    { id: 'gold-glow', kind: 'decoration', zIndex: 5, rect: { x: .45, y: .08, width: .55, height: .78 }, opacity: .9, styleToken: 'gold-radial-glow' },
    { id: 'copy-overlay', kind: 'overlay', zIndex: 10, rect: { x: .055, y: .07, width: .42, height: .40 }, opacity: .72, styleToken: 'black-glass' },
    { id: 'headline', kind: 'text', zIndex: 20, rect: { x: .085, y: .105, width: .36, height: .17 }, content: headline, styleToken: 'luxury-serif-display' },
    ...(supporting ? [{ id: 'supporting', kind: 'text' as const, zIndex: 21, rect: { x: .085, y: .29, width: .34, height: .14 }, content: supporting, styleToken: 'body-light' }] : []),
    { id: 'product-hero', kind: 'product', zIndex: 30, rect: { x: .38, y: .18, width: .56, height: .70 }, sourceAssetId: input.productId, fit: 'contain', protectedAnchors: ['cap', 'brand', 'label', 'product_body'] },
    ...(input.logoAssetId ? [{ id: 'brand-logo', kind: 'logo' as const, zIndex: 40, rect: { x: .07, y: .035, width: .18, height: .055 }, sourceAssetId: input.logoAssetId, fit: 'contain' as const }] : []),
    ...(cta ? [{ id: 'cta', kind: 'cta' as const, zIndex: 50, rect: { x: .07, y: .88, width: .86, height: .065 }, content: cta, styleToken: 'gold-outline-cta' }] : []),
  ];
  return {
    schemaVersion: 'social-image-layer-graph.v1', canvas: { ...canvas, background: '#050505' }, templateId: 'luxury-product-hero-v1', layers,
    protectedRegions: [{ x: .38, y: .18, width: .56, height: .70 }],
    overlayAllowedRegions: [{ x: .055, y: .07, width: .42, height: .40 }, { x: .07, y: .88, width: .86, height: .065 }],
    fontManifest: [
      { token: 'luxury-serif-display', family: 'Georgia', fileHash: 'system-font-georgia-v1' },
      { token: 'body-light', family: 'Arial', fileHash: 'system-font-arial-v1' },
    ],
    compiledAt: input.now || new Date().toISOString(),
  };
}
