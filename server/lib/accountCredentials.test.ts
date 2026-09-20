import assert from 'node:assert/strict';
import {
  accountCredentialNeedsMigration,
  openAccountCredential,
  sealAccountCredential,
  sealedSocialCredentialPatch,
  sealedYouTubeCredentialPatch,
  socialAccessToken,
  youtubeCredentials,
} from './accountCredentials.js';

const sealed = sealAccountCredential('secret-value');
assert.match(sealed, /^v1:/);
assert.equal(openAccountCredential(sealed, 'test'), 'secret-value');
assert.equal(openAccountCredential('legacy-plain-text', 'test'), 'legacy-plain-text', 'legacy rows stay readable during migration');
assert.equal(accountCredentialNeedsMigration('legacy-plain-text'), true);
assert.equal(accountCredentialNeedsMigration(sealed), false);

const social = sealedSocialCredentialPatch({ accessToken: 'access', refreshToken: 'refresh' });
assert.notEqual(social.accessToken, 'access');
assert.notEqual(social.refreshToken, 'refresh');
assert.equal(socialAccessToken(social), 'access');

const youtube = sealedYouTubeCredentialPatch({ clientSecret: 'client-secret', refreshToken: 'refresh', accessToken: 'access' });
assert.deepEqual(youtubeCredentials({ clientId: 'client-id', ...youtube }), {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  refreshToken: 'refresh',
  accessToken: 'access',
});
assert.deepEqual(youtubeCredentials({
  clientId: 'client-id',
  clientSecret: sealAccountCredential('client-secret'),
  refreshToken: '',
  accessToken: sealAccountCredential('access-only'),
}), {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  refreshToken: '',
  accessToken: 'access-only',
});

console.log('Account credential vault tests passed');
