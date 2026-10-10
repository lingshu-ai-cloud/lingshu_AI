export type ProductPlacementScene = 'tabletop' | 'conveyor';
export type ProductPlacementPreset = 'left' | 'center' | 'right';
export interface ProductPlacementOverride {
  contactScene: ProductPlacementScene;
  productBox: { x: number; y: number; width: number; height: number };
  contactSurfaceY: number;
}

/** Optional correction to the server's evidence-based layout. Coordinates are
 * normalized to the target frame, so they work in portrait and landscape. */
export function productPlacementPreset(scene: ProductPlacementScene, preset: ProductPlacementPreset): ProductPlacementOverride {
  const width = scene === 'conveyor' ? 0.26 : 0.34;
  const height = scene === 'conveyor' ? 0.30 : 0.40;
  const contactSurfaceY = scene === 'conveyor' ? 0.76 : 0.80;
  const x = preset === 'left' ? 0.12 : preset === 'right' ? 0.88 - width : (1 - width) / 2;
  return { contactScene: scene, productBox: { x, y: contactSurfaceY - height, width, height }, contactSurfaceY };
}

export function validProductPlacement(value: ProductPlacementOverride): boolean {
  const { x, y, width, height } = value.productBox;
  return [x, y, width, height, value.contactSurfaceY].every(item => Number.isFinite(item) && item >= 0 && item <= 1)
    && width > 0 && height > 0 && x + width <= 1 && y + height <= 1
    && Math.abs(y + height - value.contactSurfaceY) <= 0.03;
}

export function adjustProductPlacement(value: ProductPlacementOverride, field: 'x' | 'width' | 'height' | 'contactSurfaceY', input: number): ProductPlacementOverride {
  const bounded = (number: number, low: number, high: number) => Math.max(low, Math.min(high, Math.round(number * 100) / 100));
  const box = value.productBox;
  if (field === 'x') return { ...value, productBox: { ...box, x: bounded(input, 0, 1 - box.width) } };
  if (field === 'width') return { ...value, productBox: { ...box, width: bounded(input, .1, 1 - box.x) } };
  if (field === 'height') {
    const height = bounded(input, .1, value.contactSurfaceY);
    return { ...value, productBox: { ...box, y: value.contactSurfaceY - height, height } };
  }
  const contactSurfaceY = bounded(input, box.height, 1);
  return { ...value, contactSurfaceY, productBox: { ...box, y: contactSurfaceY - box.height } };
}
