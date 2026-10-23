import type { PresenterAsset } from '../../lib/shotProduction';

type Material = { id: string; name: string; type?: string };

export function arkPresenterEnrollmentMaterials(presenter: PresenterAsset | undefined, materials: Material[]) {
  const references = new Set(presenter?.referenceMaterialIds || []);
  const photos = materials.filter(item => references.has(item.id) && item.type === 'image');
  const videos = materials.filter(item => references.has(item.id) && item.type === 'video');
  return {
    photos,
    videos,
    initialPhotoMaterialId: photos[0]?.id,
    initialVideoMaterialId: videos[0]?.id,
    authorizationConfirmed: presenter?.authorizationConfirmation?.subjectAdultConfirmed === true
      && presenter.authorizationConfirmation.arkProcessingAuthorized === true,
  };
}
