import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { metaOAuthScopes, instagramLoginOAuthScopes } from '../lib/socialOAuthScopes.js';

const routeSource = readFileSync(new URL('./social.ts', import.meta.url), 'utf8');
const channelsSource = readFileSync(new URL('../../src/components/ChannelsPage.tsx', import.meta.url), 'utf8');
const messengerSource = readFileSync(new URL('../../src/components/MessengerConnectionPanel.tsx', import.meta.url), 'utf8');

// Messenger is a supported, explicitly selected account capability. Its grant
// does not imply an Instagram, advertising, or publication permission.
assert.deepEqual(metaOAuthScopes('messenger', {}), ['pages_show_list', 'pages_read_engagement', 'pages_messaging', 'pages_manage_metadata']);
assert.deepEqual(instagramLoginOAuthScopes({}), ['instagram_business_basic', 'instagram_business_manage_messages']);
assert.ok(!metaOAuthScopes('messenger', {}).includes('pages_manage_posts'));
assert.ok(!instagramLoginOAuthScopes({}).includes('instagram_business_content_publish'));
assert.match(messengerSource, /body: JSON\.stringify\(\{[^]*?purpose: 'messenger'/, '消息接入动作必须明确请求 Messenger 用途');
assert.match(routeSource, /platform === 'facebook' && req\.body\?\.purpose === 'messenger' \? 'messenger' as const : undefined/, '服务端不能将任意平台用途提升为 Messenger');
assert.match(routeSource, /signOAuthState\(\{[^}]*purpose,[^}]*\}\)/, '用途必须进入签名 OAuth state');
assert.match(routeSource, /issueOAuthNonce\(state, \{ \.\.\.parsedState, clientHash:/, 'OAuth state 必须持久化绑定当前平台应用');
assert.match(routeSource, /const scopes = metaOAuthScopes\(purpose \|\| platform\)/, 'Meta OAuth 必须使用所选用途的真实权限集合');
assert.match(routeSource, /await assertTenantMessengerPageOwnership\(tenantId,pageId\)/, '消息接入不能跨租户借用主页');
assert.match(routeSource, /await connectMessengerPageCapability\(\{pageId,pageAccessToken,\.\.\.client\}\)/, '订阅前必须实际验证主页消息能力');
assert.match(routeSource, /await assertMessengerAccountVersion\(account,input\.page\.id,input\.page\.accessToken\)/, '订阅完成后必须复核当前账号和凭证');
assert.match(routeSource, /createMessengerCapabilityScope\(\{tenantId:input\.tenantId,accountId:account\.id,pageId:input\.page\.id/, '消息权限证明必须绑定租户、账号和真实主页');
assert.match(routeSource, /messengerSubscribed: false, messengerSubscriptionError: message/, '订阅失败不能伪装消息接入成功');
assert.match(routeSource, /if \(!tokens\.permissions\.includes\('instagram_business_manage_messages'\)\) \{\s*throw new Error/, 'Instagram 消息接入必须核验实际返回的消息授权');
assert.match(routeSource, /instagramWebhookSubscribed: false, instagramWebhookSubscriptionError: message/, 'Instagram 订阅失败必须保留失败状态');
assert.match(channelsSource, /panel\('messenger',<MessengerConnectionPanel/, '正常产品应展示明确的消息接入入口');
assert.match(messengerSource, /个人账号与好友之间的私人聊天不会同步/, '消息入口必须明确公共主页边界');
console.log('Meta messaging review scope route contract passed');
