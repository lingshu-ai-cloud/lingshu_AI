import type { Page } from '../pageRegistry';

type Turn = { role: string; content: string; taskPortal?: unknown; creationPortal?: unknown };
export type AssistantNavigationPortal = { page: Page; title: string; description: string };
const destinations: Array<AssistantNavigationPortal & { names: RegExp }> = [
  { page: 'adsPlans', title: '智能投流', description: '查看投放计划、广告账户和投放状态', names: /智能投流|投流页|投放页|投放管理|广告投放中心/u },
  { page: 'conversion', title: '智能客服', description: '查看客户与会话', names: /智能客服|客户会话页|客服页/u },
  { page: 'socialInspiration', title: '内容创作', description: '查看创作任务与发布安排', names: /内容创作|创作页/u },
  { page: 'digitalEmployees', title: '经营总览', description: '查看周计划与经营数据', names: /经营总览|经营页/u },
  { page: 'smartAssets', title: '内容制作', description: '进入内容制作工作台', names: /内容制作|制作工作台/u },
];

/** Navigation only: explicit confirmation of the immediately preceding invitation. */
export function confirmedAssistantNavigation(reply: string, last?: Turn): AssistantNavigationPortal | null {
  if (last?.role !== 'assistant' || last.taskPortal || last.creationPortal) return null;
  const text = reply.trim().replace(/[。！!\s]+$/u, '');
  const shortConfirmation = /^(?:确认|确认前往|确认进入|确认打开|好的?|是的?|可以|同意|前往|去看看|去吧|打开)$/u.test(text);
  const namedConfirmation = /^(?:确认|好[的，,\s]*|可以[，,\s]*)?(?:请)?(?:前往|进入|打开|跳转到)[^？?。！!\n]{1,30}$/u.test(text);
  if ((!shortConfirmation && !namedConfirmation) || /不|取消|稍后|等等|先别|但是|不过|创建|发送|删除|发布|启动/u.test(text)) return null;
  const invitations = last.content.replace(/```[\s\S]*?```/gu, '').split('\n')
    .filter(line => !/^\s*>/u.test(line))
    .flatMap(line => [...line.matchAll(/(?:是否|要不要|需要|确认)[^？?\n]{0,20}?(?:前往|进入|打开|跳转到)([^？?\n]{1,80})[？?]/gu)].map(match => match[1]));
  const matches = destinations.filter(item => invitations.some(invitation => item.names.test(invitation)));
  if (matches.length !== 1) return null;
  const named = destinations.filter(item => item.names.test(text));
  if ((!shortConfirmation && !named.length) || named.length && (named.length !== 1 || named[0].page !== matches[0].page)) return null;
  const { names: _, ...portal } = matches[0];
  return portal;
}

/** Derive from persisted turns so existing confirmations and reloads also show the portal. */
export function navigationPortalForAnswer(messages: Turn[], index: number) {
  if (messages[index]?.role !== 'assistant' || messages[index - 1]?.role !== 'user') return null;
  return confirmedAssistantNavigation(messages[index - 1].content, messages[index - 2]);
}
