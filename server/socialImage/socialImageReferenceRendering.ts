import type { SocialImageCreationTask, SocialImageReplicationRecipe } from '../../shared/contracts/socialImageCreation.js';
import type { SocialImageElementInventory } from '../../shared/contracts/socialImageProduction.js';
import { compileEvidenceGuidedSocialImage } from './socialImageReferenceStrategy.js';
import { createHash } from 'node:crypto';

export function socialImageReferenceUsesImitableStyle(task: SocialImageCreationTask): boolean {
  if (task.creationPath !== 'viral_replication') return false;
  const node = task.productionRuntime?.nodes.find(item => item.nodeId === 'reference_snapshot');
  const output = task.productionRuntime?.nodeOutputs.find(item => item.id === node?.outputRef?.id
    && item.nodeId === 'reference_snapshot' && item.status === 'completed');
  const value = output?.value as { styleObservation?: { kind?: string } } | undefined;
  return value?.styleObservation?.kind === 'imitable';
}

/** Freeze only measured, transferable structure. No reference pixels, copy or identity enter the provider request. */
export function socialImageReferenceRenderRecipe(task: SocialImageCreationTask,
  inventory: SocialImageElementInventory, style: 'reference_emulation.v1' | 'advertising.v1' | 'advertising_fallback.v1'):
  SocialImageReplicationRecipe | null {
  if (style !== 'reference_emulation.v1' || !task.replicationRecipe) return null;
  const productId = task.contentBrief.productRefs[0];
  const headline = task.renderBrief?.headline;
  if (!productId || !headline) return null;
  const graph = compileEvidenceGuidedSocialImage({ task, inventory, productId, headline });
  const product = graph.layers.find(layer => layer.id === 'product-hero')?.rect;
  const heading = graph.layers.find(layer => layer.id === 'headline')?.rect;
  if (!product || !heading) return null;
  const regions = task.replicationRecipe.layoutRegions.filter(region =>
    !['product-stage', 'headline-zone', 'corner-badge', 'bottom-bar'].includes(region.id));
  return {
    ...task.replicationRecipe,
    // A reference can inform the product and text zones without inheriting its
    // competitor badge, CTA, commercial claims or raw graphic layers.
    layoutRegions: [...regions,
      { id: 'product-stage', role: 'product', ...product },
      { id: 'headline-zone', role: 'text', ...heading }],
    palette: graph.canvas.background ? [graph.canvas.background] : [],
    referenceLayerBlueprints: [],
  };
}

/** Stable across retries, different across new tasks using the same reference. */
export function socialImageSceneDirection(taskId: string): string {
  const directions = [
    'quiet textured tabletop with directional daylight',
    'soft fabric and natural shadow with layered depth',
    'clean architectural niche with angled light',
    'close-up material textures with generous negative space',
  ];
  return directions[createHash('sha256').update(taskId).digest()[0]! % directions.length]!;
}

export function socialImageSceneVariant(taskId: string): number {
  return createHash('sha256').update(taskId).digest()[1]! % 4;
}

export function socialImageReferencePalette(inventory: SocialImageElementInventory | null): string[] {
  const rgb = inventory?.colorAndLighting.meanRgb;
  if (!Array.isArray(rgb) || rgb.length < 3 || rgb.slice(0, 3).some(value => !Number.isFinite(value))) return [];
  return [`#${rgb.slice(0, 3).map(value => Math.max(0, Math.min(255, Math.round(value)))
    .toString(16).padStart(2, '0')).join('')}`];
}
