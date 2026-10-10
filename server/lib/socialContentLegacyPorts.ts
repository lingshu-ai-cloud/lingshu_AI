/**
 * Compatibility boundary for domain code that still relies on capabilities
 * currently hosted by the legacy HTTP route modules. Keeping this dependency
 * in one adapter prevents Starter198 workflow modules from depending on route
 * composition directly and gives the capability implementations a stable
 * migration seam.
 */
export {
  readTenantEnterpriseProfile,
  type EnterpriseProfile,
} from '../routes/enterprise.js';

export {
  automationBgmAudio,
  automationBgmCatalog,
  synthesizeStudioVoiceForAutomation,
} from '../routes/studio.js';
