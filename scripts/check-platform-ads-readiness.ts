import '../server/loadEnvironment.js';
import { adReleasePolicy } from '../server/platformAds/releasePolicy.js';

// Configuration-only check: never sends credentials, contacts providers or starts advertising.
const present = (key: string) => Boolean(process.env[key]?.trim());
const groups = [
  { name: 'credentialEncryption', keys: ['TENANT_PLATFORM_APP_KEY'] },
  { name: 'metaOAuth', keys: ['META_ADS_APP_ID', 'META_ADS_APP_SECRET', 'META_ADS_REDIRECT_URI', 'META_ADS_API_VERSION'] },
  { name: 'googleApiVersion', keys: ['GOOGLE_ADS_API_VERSION'] },
];
const configuration = groups.map(group => ({ name: group.name, ready: group.keys.every(present), missing: group.keys.filter(key => !present(key)) }));
let callbackValid = false;
try {
  const callback = new URL(process.env.META_ADS_REDIRECT_URI || '');
  callbackValid = (callback.protocol === 'https:' || (callback.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(callback.hostname))) && callback.pathname === '/api/overseas/platform-ads/oauth/meta/callback' && !callback.username && !callback.password && !callback.search && !callback.hash;
} catch { /* Report missing/invalid configuration without revealing its value. */ }
const report = {
  configuration,
  metaCallbackValid: callbackValid,
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
if (process.argv.includes('--require-meta') && (!callbackValid || !configuration.filter(item => ['credentialEncryption', 'metaOAuth'].includes(item.name)).every(item => item.ready))) process.exitCode = 1;
