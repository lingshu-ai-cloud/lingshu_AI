import type { Material } from './studioApi';

type MaterialAspect = Pick<Material, 'width' | 'height' | 'aspectRatio'> | undefined;

export function materialIntrinsicAspectRatio(material: MaterialAspect): number {
  const width = Number(material?.width);
  const height = Number(material?.height);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) return width / height;
  const explicit = Number(material?.aspectRatio);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return 1;
}

export function materialHasAuthoritativeAspectRatio(material: MaterialAspect): boolean {
  const width = Number(material?.width);
  const height = Number(material?.height);
  const explicit = Number(material?.aspectRatio);
  return (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)
    || (Number.isFinite(explicit) && explicit > 0);
}
