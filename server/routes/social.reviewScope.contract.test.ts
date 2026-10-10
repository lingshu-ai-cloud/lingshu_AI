import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const routeSource = readFileSync(new URL('./social.ts', import.meta.url), 'utf8');
const channelsSource = readFileSync(new URL('../../src/components/ChannelsPage.tsx', import.meta.url), 'utf8');
const credentialsSource = readFileSync(new URL('../../src/components/UserSocialAppCredentials.tsx', import.meta.url), 'utf8');

assert.doesNotMatch(routeSource, /subscribeMessengerPage|subscribeInstagramAccount/, '账号连接不得自动订阅消息或 Webhook');
assert.doesNotMatch(routeSource, /未授予私信权限/, 'Instagram 连接不得把私信权限作为成功条件');
assert.match(routeSource, /purpose === 'messenger'[\s\S]*?status\(403\)/, '旧 Messenger 授权入口必须在服务端关闭');
assert.match(routeSource, /const scopes = metaOAuthScopes\(platform\)/, 'Meta OAuth 必须只使用平台最小权限集合');
assert.doesNotMatch(channelsSource, /MessengerConnectionPanel/, '发布渠道页不得展示 Messenger 接入');
assert.doesNotMatch(credentialsSource, /Messenger Webhook Callback URL|Messenger Webhook Verify Token|Instagram Webhook Callback URL|Instagram Webhook Verify Token/, '企业凭证页不得展示 Meta 消息 Webhook 配置');

console.log('Meta review scope route contract passed');
