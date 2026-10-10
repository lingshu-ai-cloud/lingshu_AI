import assert from 'node:assert/strict';
import test from 'node:test';
import {assertInstagramPublishingScopes,resolveInstagramPublishingContract} from './instagramPublishingContract.js';

test('Instagram OAuth provider freezes host, token kind and separate publishing permission families',()=>{
 const native=resolveInstagramPublishingContract({oauthProvider:'instagram_login'});
 assert.equal(native.graphHost,'https://graph.instagram.com');assert.equal(native.tokenKind,'instagram_user');
 assert.equal(assertInstagramPublishingScopes({oauthProvider:'instagram_login',scope:'instagram_business_basic,instagram_business_content_publish'}).publishScope,'instagram_business_content_publish');
 for(const scope of ['instagram_content_publish','instagram_business_content_publish','instagram_business_basic instagram_business_manage_messages'])assert.throws(()=>assertInstagramPublishingScopes({oauthProvider:'instagram_login',scope}),/provider_publish_scope_missing/);
 for(const oauthProvider of [undefined,'facebook_login']){const legacy=resolveInstagramPublishingContract({oauthProvider});assert.equal(legacy.graphHost,'https://graph.facebook.com');assert.equal(legacy.tokenKind,'facebook_page');assert.equal(assertInstagramPublishingScopes({oauthProvider,scope:'instagram_content_publish'}).publishScope,'instagram_content_publish');}
 assert.throws(()=>resolveInstagramPublishingContract({oauthProvider:'meta'}),/instagram_publishing_oauth_provider_unsupported/);
});
