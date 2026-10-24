import '../server/loadEnvironment.js';
import { adReleasePolicy } from '../server/platformAds/releasePolicy.js';
import { metaOAuthDeploymentReadiness } from '../server/platformAds/oauthDeploymentReadiness.js';

// Configuration-only check: never sends credentials, contacts providers or starts advertising.
const present = (key: string) => Boolean(process.env[key]?.trim());
const groups = [
  { name: 'credentialEncryption', keys: ['TENANT_PLATFORM_APP_KEY'] },
  { name: 'googleApiVersion', keys: ['GOOGLE_ADS_API_VERSION'] },
];
const configuration = groups.map(group => ({ name: group.name, ready: group.keys.every(present), missing: group.keys.filter(key => !present(key)) }));
const metaOAuth = metaOAuthDeploymentReadiness();
configuration.push({ name: 'metaOAuth', ready: metaOAuth.configured, missing: metaOAuth.missing });
const report = {
  configuration,
  metaCallbackValid: metaOAuth.callbackConfigurationValid,
  metaOAuth,
  automationWorkerEnabled: process.env.PLATFORM_ADS_AUTOMATION_ENABLED === 'true',
  productionMode: process.env.NODE_ENV === 'production',
  releasePolicy: adReleasePolicy(),
  schemaValidation: 'not_performed',
  authenticationValidation: 'not_performed',
  backupAndRollbackValidation: 'not_performed',
  liveAccountValidation: 'not_performed',
  deploymentTarget: 'must_be_confirmed_separately',
  note: '配置存在不等于平台权限获批；还需账户授权、平台只读预检和经指定预算授权的真实验收。',
};
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes('--require-meta') && (!metaOAuth.configured || !metaOAuth.encryptionConfigured)) process.exitCode = 1;
if (process.argv.includes('--require-fixed-https') && !metaOAuth.fixedHttpsCandidate) process.exitCode = 1;
