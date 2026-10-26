import type { AdMaterialDirectory, AdMaterialDirectoryItem } from '../../shared/adMaterialDirectory.js';
import { materialSourceKey } from '../../shared/adMaterialDirectory.js';
import type { AdSourceCatalog, AdSourceEntry } from '../../shared/adSourceLifecycle.js';
import { listAdSourceCatalog } from './creativeHistory.js';
import { listExternalHistorySources } from './externalHistory.js';
import { listAdCreativeLibrary } from './creativeLibrary.js';
import { listPlatformAdTasks } from './tasks.js';
import { getAccountDirectory } from './accountDirectory.js';
import { getMetaAccountHistory } from './accountHistory.js';
import { PlatformAdCreativeError } from './creatives.js';

type Dependencies = {
  sources: typeof listAdSourceCatalog; external: typeof listExternalHistorySources;
  library: typeof listAdCreativeLibrary; tasks: typeof listPlatformAdTasks;
  accounts: typeof getAccountDirectory; history: typeof getMetaAccountHistory;
};
const capPages = 10;
export function createMaterialDirectory(deps: Dependencies) {
  return async (tenantId: string, query: Record<string, unknown>): Promise<AdMaterialDirectory> => {
    if (Object.keys(query).some(k => !['page', 'perPage', 'search', 'origin', 'goal', 'taskId', 'accountId', 'usage'].includes(k)) || Object.values(query).some(v => typeof v !== 'string')) throw new PlatformAdCreativeError('素材目录参数无效');
    const page = Number(query.page || 1), perPage = Number(query.perPage || 12);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(perPage) || perPage < 1 || perPage > 50) throw new PlatformAdCreativeError('素材目录分页无效');
    if (query.origin && !['all', 'local', 'external', 'platform'].includes(String(query.origin)) || query.usage && !['all', 'used', 'unused'].includes(String(query.usage))) throw new PlatformAdCreativeError('素材筛选无效');
    const warnings: string[] = [], map = new Map<string, AdMaterialDirectoryItem>(); let truncated = false;
    const tasks = await deps.tasks(tenantId);
    if (query.taskId && !tasks.some(t => t.id === query.taskId)) throw new PlatformAdCreativeError('未找到投放计划', 404);
    const addSource = (source: AdSourceEntry) => {
      const normalized = { ...source, sourceTenantId: source.sourceTenantId || tenantId };
      const key = materialSourceKey(normalized);
      if (!map.has(key)) map.set(key, { key, name: source.name, source: normalized, plans: [], bindings: [], ads: [] });
      return map.get(key)!;
    };
    const readSource = async (origin: 'social' | 'studio', sourceId?: string, label = '当前企业') => {
      try {
        for (let page = 1; page <= capPages; page++) {
          const catalog: AdSourceCatalog = await deps.sources(tenantId, { origin, ...(sourceId ? { sourceId } : {}), page, perPage: 50 });
          catalog.items.forEach(addSource);
          if (page >= catalog.totalPages) return;
        }
        truncated = true; warnings.push(`${label}的${origin === 'social' ? '社媒成片' : '历史项目'}超过读取上限，当前目录不完整。`);
      } catch { warnings.push(`${label}的${origin === 'social' ? '社媒成片' : '历史项目'}读取失败；不能判断为没有素材。`); }
    };
    await Promise.all([readSource('social'), readSource('studio')]);
    try {
      const sources = await deps.external(tenantId);
      for (const source of sources.slice(0, 10)) await readSource('studio', source.id, source.tenantName);
      if (sources.length > 10) { truncated = true; warnings.push('外部来源超过读取上限，当前目录不完整。'); }
    } catch { warnings.push('外部素材来源暂不可读。'); }
    for (const task of tasks) {
      const selection = task.configuration.materialSource;
      if (!selection) continue;
      const entry = addSource({ ...selection, key: `social:${selection.sourceTaskId}:${selection.artifactId}`, status: '计划已选素材', createdAt: task.createdAt, verifiedSource: true, note: '计划保存的版本；使用前仍会核验原文件与权限。' });
      entry.plans.push({ id: task.id, name: task.name, goal: task.goal, market: task.market, status: task.status });
    }
    const adOwners = new Map<string, AdMaterialDirectoryItem>();
    try {
      for (let page = 1; page <= capPages; page++) {
        const catalog = await deps.library(tenantId, { page, perPage: 50 }); truncated ||= catalog.truncated;
        for (const item of catalog.items) {
          const b = item.binding;
          const entry = b ? addSource({ origin: 'social', key: `social:${b.sourceTaskId}:${b.artifactId}`, sourceTaskId: b.sourceTaskId, artifactId: b.artifactId, name: b.name, sha256: b.sha256, status: b.status, verifiedSource: true, createdAt: b.createdAt, note: '已保存的投放绑定，复用时重新核验文件版本。' }) : null;
          if (!entry) continue;
          if (!entry.plans.some(p => p.id === item.task.id)) entry.plans.push({ ...item.task, market: tasks.find(t => t.id === item.task.id)?.market || '' });
          if (!entry.bindings.some(binding => binding.id === b!.id)) entry.bindings.push(b!);
          if (item.execution) {
            const key = `${item.connection.accountId}:${item.execution.adId}`;
            if (!entry.ads.some(ad => `${ad.accountId}:${ad.adId}` === key)) entry.ads.push({ accountId: item.connection.accountId, accountName: item.connection.name, connectionId: item.connection.id, adId: item.execution.adId, executionId: item.execution.id, currency: item.connection.currency, taskId: item.task.id, goal: item.task.goal, market: tasks.find(t => t.id === item.task.id)?.market || '' });
            adOwners.set(key, entry);
          }
        }
        if (page >= catalog.totalPages) break;
        if (page === capPages) { truncated = true; warnings.push('投放绑定目录超过读取上限。'); }
      }
    } catch { warnings.push('投放关联目录读取失败；部分素材的计划及广告关联可能不完整。'); }
    try {
      const directory = await deps.accounts(tenantId); warnings.push(...directory.warnings);
      const accounts = directory.items.filter(a => a.provider === 'meta');
      for (const account of accounts.slice(0, 20)) {
        try {
          const history = await deps.history(tenantId, account.connectionId, account.accountId);
          if (!history.complete) { truncated = true; warnings.push(`${account.name} 的平台历史未完整返回。`); }
          for (const row of history.items) {
            const key = `${account.accountId}:${row.adId}`, owner = adOwners.get(key);
            if (owner) continue; // Only persisted verified mappings can fold provider ads into a local source.
            map.set(`platform:${key}`, { key: `platform:${key}`, name: row.adName, plans: [], bindings: [], ads: [{ accountId: account.accountId, accountName: history.accountName, connectionId: account.connectionId, adId: row.adId, history: row, currency: history.currency, timezone: history.timezone, reportedAt: history.reportedAt }] });
          }
        } catch { warnings.push(`${account.name} 的平台历史读取失败；保留本地素材，不推断账户没有投放。`); }
      }
      if (accounts.length > 20) { truncated = true; warnings.push('授权账户超过读取上限，当前目录不完整。'); }
    } catch { warnings.push('授权账户目录暂不可读，当前仅展示已读取的本地来源。'); }
    const items = [...map.values()].filter(item => {
      const scopedAds = item.ads.filter(ad => (!query.taskId || ad.taskId === query.taskId) && (!query.goal || ad.goal === query.goal) && (!query.accountId || ad.accountId === query.accountId));
      const origin = item.source ? item.source.sourceId ? 'external' : 'local' : 'platform';
      const haystack = `${item.name} ${item.plans.map(p => `${p.name} ${p.goal} ${p.market}`).join(' ')}`.toLowerCase();
      return (!query.origin || query.origin === 'all' || query.origin === origin) && (!query.goal || item.plans.some(p => p.goal === query.goal))
        && (!query.taskId || item.plans.some(p => p.id === query.taskId)) && (!query.accountId || scopedAds.length > 0)
        && (!query.usage || query.usage === 'all' || (query.usage === 'used' ? scopedAds.length > 0 : scopedAds.length === 0)) && (!query.search || haystack.includes(String(query.search).toLowerCase()));
    }).map(item => ({ ...item, ads: item.ads.filter(ad => (!query.taskId || ad.taskId === query.taskId) && (!query.goal || ad.goal === query.goal) && (!query.accountId || ad.accountId === query.accountId)) })).sort((a, b) => b.ads.length - a.ads.length || a.key.localeCompare(b.key));
    return { items: items.slice((page - 1) * perPage, page * perPage), totalItems: items.length, page, perPage, totalPages: Math.ceil(items.length / perPage), warnings, truncated, checkedAt: new Date().toISOString() };
  };
}
export const listMaterialDirectory = createMaterialDirectory({ sources: listAdSourceCatalog, external: listExternalHistorySources, library: listAdCreativeLibrary, tasks: listPlatformAdTasks, accounts: getAccountDirectory, history: getMetaAccountHistory });
