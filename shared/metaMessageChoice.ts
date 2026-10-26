import type { MetaMessageDestination } from './metaAdObjectives.js';
import { adCountryName } from './metaAdJourney.js';
export type MetaMessageChoice = { pageId: string; destination: MetaMessageDestination | ''; recipientId: string };
export function normalizeMetaMessageChoice(value: unknown): MetaMessageChoice | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('聊天渠道配置无效');
  const r = value as Record<string, unknown>;
  if (Object.keys(r).some(k => !['pageId', 'destination', 'recipientId'].includes(k)) || typeof r.pageId !== 'string' || !/^\d{1,30}$/.test(r.pageId) || !['', 'MESSENGER', 'WHATSAPP', 'INSTAGRAM_DIRECT'].includes(String(r.destination)) || typeof r.recipientId !== 'string' || r.recipientId.length > 40 || !/^\+?\d*$/.test(r.recipientId)) throw Error('请从已授权主页选择聊天渠道');
  if (r.destination && !r.recipientId) throw Error('聊天渠道尚未关联接收账号');
  return { pageId: r.pageId, destination: r.destination as MetaMessageChoice['destination'], recipientId: r.recipientId };
}
/** Display summary only. Actual countries and language IDs remain structured configuration. */
export function adMarketSummary(countries: string[], languages: Array<{ name: string }> = []) {
  const places = countries.slice(0, 5).map(adCountryName).join('、');
  const region = places + (countries.length > 5 ? `等${countries.length}个国家或地区` : '');
  return [region, languages.slice(0, 2).map(l => l.name).join(' / ')].filter(Boolean).join(' · ').slice(0, 80);
}
