import type { SocialImageCreationTask } from '../../../shared/contracts/socialImageCreation.js';
import type { SocialImageLayerGraph } from '../../../shared/contracts/socialImageLayerGraph.js';
import { socialImageCanvasForAspectRatio } from '../referenceCanvas.js';

export function compileLuxuryProductHero(input: {
  task: SocialImageCreationTask;
  productId: string;
  productName: string;
  logoAssetId?: string;
  now?: string;
}): SocialImageLayerGraph {
  const { task } = input;
  const { width, height } = socialImageCanvasForAspectRatio(task.deliverySpec.aspectRatio);
  const canvas = { width, height };
  const headline = task.imageTextContract.headline || task.renderBrief?.headline || input.productName;
  const supporting = task.imageTextContract.supportingText || task.renderBrief?.subheadline || task.contentBrief.coreClaim;
  const cta = task.imageTextContract.cta || task.renderBrief?.cta || task.contentBrief.targetAction || '';
  const blueprint = task.replicationRecipe?.referenceLayerBlueprints?.[0];
  const zFor = (role: 'background' | 'mask' | 'product' | 'text' | 'logo' | 'decoration', fallback: number) => {
    const matches = blueprint?.layers.filter(layer => layer.role === role).map(layer => layer.zIndex) || [];
    return matches.length ? Math.round(matches.reduce((sum, value) => sum + value, 0) / matches.length) * 10 : fallback;
  };
  const maskLayers: SocialImageLayerGraph['layers'] = (blueprint?.masks || []).map((mask, index) => ({
    id: `reference-${mask.id || `mask-${index + 1}`}`,
    kind: 'overlay',
    zIndex: mask.zIndex * 10,
    rect: mask.bounds,
    opacity: mask.opacity,
    styleToken: 'reference-mask',
    evidenceRefs: [`reference-image:${blueprint?.imageIndex || 1}:mask:${mask.id}`],
    mask: {
      shape: mask.shape, color: mask.color, cornerRadius: mask.cornerRadius, feather: mask.feather,
      angle: mask.angle, points: mask.points,
    },
  }));
  const layers: SocialImageLayerGraph['layers'] = [
    { id: 'background', kind: 'background', zIndex: zFor('background', 0), rect: { x: 0, y: 0, width: 1, height: 1 }, styleToken: 'luxury-black-gold-gradient' },
    { id: 'gold-glow', kind: 'decoration', zIndex: zFor('decoration', 5), rect: { x: .45, y: .08, width: .55, height: .78 }, opacity: .9, styleToken: 'gold-radial-glow' },
    ...(maskLayers.length ? maskLayers : [{ id: 'copy-overlay', kind: 'overlay' as const, zIndex: zFor('mask', 10), rect: { x: .055, y: .07, width: .42, height: .40 }, opacity: .72, styleToken: 'black-glass' }]),
    { id: 'headline', kind: 'text', zIndex: zFor('text', 20), rect: { x: .085, y: .105, width: .36, height: .17 }, content: headline, styleToken: 'luxury-serif-display' },
    ...(supporting ? [{ id: 'supporting', kind: 'text' as const, zIndex: zFor('text', 20) + 1, rect: { x: .085, y: .29, width: .34, height: .14 }, content: supporting, styleToken: 'body-light' }] : []),
    { id: 'product-hero', kind: 'product', zIndex: zFor('product', 30), rect: { x: .38, y: .18, width: .56, height: .70 }, sourceAssetId: input.productId, fit: 'contain', protectedAnchors: ['cap', 'brand', 'label', 'product_body'] },
    ...(input.logoAssetId ? [{ id: 'brand-logo', kind: 'logo' as const, zIndex: zFor('logo', 40), rect: { x: .07, y: .035, width: .18, height: .055 }, sourceAssetId: input.logoAssetId, fit: 'contain' as const }] : []),
    ...(cta ? [{ id: 'cta', kind: 'cta' as const, zIndex: zFor('text', 20) + 2, rect: { x: .07, y: .88, width: .86, height: .065 }, content: cta, styleToken: 'gold-outline-cta' }] : []),
  ];
  return {
    schemaVersion: 'social-image-layer-graph.v1', canvas: { ...canvas, background: '#050505' }, templateId: 'luxury-product-hero-v1', layers,
    protectedRegions: [{ x: .38, y: .18, width: .56, height: .70 }],
    overlayAllowedRegions: [...(blueprint?.masks.map(mask => mask.bounds) || [{ x: .055, y: .07, width: .42, height: .40 }]), { x: .07, y: .88, width: .86, height: .065 }],
    fontManifest: [
      { token: 'luxury-serif-display', family: 'Georgia', fileHash: 'system-font-georgia-v1' },
      { token: 'body-light', family: 'Arial', fileHash: 'system-font-arial-v1' },
    ],
    compiledAt: input.now || new Date().toISOString(),
  };
}
