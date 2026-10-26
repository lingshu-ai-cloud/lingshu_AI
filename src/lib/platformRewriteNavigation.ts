import type { SocialContentCreateRequest } from '../components/socialContent/SocialContentWorkspace';
import { productionNavigationIdentity } from './productionNavigation';
export function continuePlatformRewrite(projectId: string) {
  const request: SocialContentCreateRequest = { requestId: Date.now(), themeId: '',
    creationPath: 'material_processing', continueProjectId: projectId, resumeEditableDraft: true };
  window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: {
    page: 'smartAssets', view: 'create', directStudio: false, navigationIdentity: productionNavigationIdentity(),
    contentCreationRequest: request,
  } }));
}
