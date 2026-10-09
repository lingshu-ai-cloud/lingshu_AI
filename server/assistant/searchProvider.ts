import type { AssistantCardItem, AssistantWorkspaceLink } from '../../shared/contracts/assistantActions.js';
import { isAutoSeededVideo } from '../lib/videoAnalysisCodec.js';
import { accessibleMaterial, readMaterialLibrary, type MaterialRecord } from '../lib/materialLibrary.js';
import { isSyntheticMaterial } from '../lib/materialTruthfulness.js';
import { store } from '../storage/index.js';
import type { DataStore } from '../storage/datastore.js';

const VIDEO_COLLECTION = 'trend_videos';
const SEARCH_PAGE_SIZE = 100;
const MAX_SEARCH_PAGES = 50;

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

export type AssistantSearchDomain = 'inspiration' | 'materials';

export type AssistantSearchResult = {
  domain: AssistantSearchDomain;
  total: number;
  items: AssistantCardItem[];
  workspace: AssistantWorkspaceLink;
  /** Partial means every returned item is real, but one backing source was unavailable. */
  sourceStatus: 'ready' | 'partial';
};

export interface AssistantSearchProvider {
  search(input: {
    tenantId: string;
    query: string;
    page?: string;
  }): Promise<AssistantSearchResult>;
}

export type AssistantSearchProviderDependencies = {
  dataStore?: DataStore;
  readMaterials?: (tenantId: string) => Promise<{
    items: MaterialRecord[];
    status: 'ready' | 'partial' | 'unavailable';
  }>;
};

export class AssistantSearchUnavailableError extends Error {
  constructor(readonly publicMessage: string) {
    super('assistant_search_unavailable');
    this.name = 'AssistantSearchUnavailableError';
  }
}

function searchDomain(query: string, page?: string): AssistantSearchDomain {
  if (/(?:素材|我的素材|产品素材|云素材|material|asset)/iu.test(query)) return 'materials';
  if (/(?:爆款|视频|短视频|灵感|对标|viral|video|inspiration)/iu.test(query)) return 'inspiration';
  return page === 'smartAssets' ? 'materials' : 'inspiration';
}

function searchTerms(query: string): string[] {
  const normalized = query
    .toLocaleLowerCase()
    .replace(/(?:请(?:你)?|麻烦(?:你)?|帮我)?\s*(?:搜索|查找|找出|找一下|查一下|搜一下|search|find|look\s+for)/giu, ' ')
    .replace(/(?:爆款视频|爆款|短视频|视频|我的素材|产品素材|云素材|素材|灵感|对标|viral\s+videos?|viral|videos?|materials?|assets?|inspiration)/giu, ' ')
    .replace(/[，,。.!！?？;；:：/\\|()[\]{}<>“”"'`~@#$%^&*+=_-]+/gu, ' ')
    .trim();
  const terms = normalized.split(/\s+/u).filter(Boolean).slice(0, 8);
  // A domain-only search is still a valid request: it returns the newest real records.
  return terms;
}

function matchesTerms(values: unknown[], terms: string[]): boolean {
  if (!terms.length) return true;
  const haystack = values.flatMap(value => {
    if (Array.isArray(value)) return value.map(item => text(item));
    if (value && typeof value === 'object') {
      try { return [JSON.stringify(value)]; } catch { return []; }
    }
    return [text(value)];
  }).join(' ').toLocaleLowerCase();
  return terms.every(term => haystack.includes(term));
}

function videoThumbnail(record: Record<string, unknown>): string | undefined {
  const direct = text(record.thumbnailUrl) || text(record.thumbnail) || text(record.poster);
  if (direct) return direct;
  const analysis = record.aiAnalysis && typeof record.aiAnalysis === 'object'
    ? record.aiAnalysis as Record<string, unknown>
    : (() => {
      try { return JSON.parse(text(record.aiAnalysis) || '{}') as Record<string, unknown>; }
      catch { return {}; }
    })();
  return text(analysis.thumbnailUrl) || text(analysis.materialPoster) || undefined;
}

function videoItem(record: Record<string, unknown>): AssistantCardItem {
  const platform = text(record.platform) || '未标注平台';
  const status = text(record.status);
  return {
    id: text(record.id),
    title: text(record.title) || '未命名视频',
    ...(videoThumbnail(record) ? { thumbnailUrl: videoThumbnail(record) } : {}),
    accountLabel: [platform, text(record.author) || text(record.accountName)].filter(Boolean).join(' · '),
    ...(status ? { note: status === 'analyzed' ? '已分析' : status } : {}),
  };
}

function materialItem(record: MaterialRecord): AssistantCardItem {
  const scope = text(record.scope) === 'shared' ? '云素材' : '产品素材';
  const type = text(record.type) || '素材';
  const thumbnailUrl = text(record.poster) || (type === 'image' ? text(record.url) : '');
  return {
    id: text(record.id),
    title: text(record.name) || text(record.title) || '未命名素材',
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    accountLabel: [scope, text(record.productName)].filter(Boolean).join(' · '),
    note: type,
  };
}

function workspaceLink(domain: AssistantSearchDomain, query: string): AssistantWorkspaceLink {
  const params = new URLSearchParams({
    page: 'socialInspiration',
    view: domain === 'materials' ? 'library' : 'inspiration',
    search: query,
  });
  return { label: domain === 'materials' ? '查看全部素材' : '查看全部视频', href: `/?${params.toString()}` };
}

async function readTenantVideos(dataStore: DataStore, tenantId: string): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const result = await dataStore.list<Record<string, unknown>>(VIDEO_COLLECTION, {
      // This equality filter is the tenant-isolation boundary. Never scan an
      // unscoped collection and filter ownership after the read.
      where: { tenantId },
      sort: '-crawledAt',
      page,
      perPage: SEARCH_PAGE_SIZE,
    });
    items.push(...result.items);
    totalPages = Math.max(1, result.totalPages || 1);
    page += 1;
  } while (page <= totalPages && page <= MAX_SEARCH_PAGES);
  return items;
}

export function createAssistantSearchProvider(
  dependencies: AssistantSearchProviderDependencies = {},
): AssistantSearchProvider {
  const dataStore = dependencies.dataStore ?? store;
  const readMaterials = dependencies.readMaterials ?? (tenantId => readMaterialLibrary(tenantId));
  return {
    async search(input) {
      const query = text(input.query);
      const domain = searchDomain(query, input.page);
      const terms = searchTerms(query);
      if (domain === 'materials') {
        const inventory = await readMaterials(input.tenantId);
        if (inventory.status === 'unavailable') {
          throw new AssistantSearchUnavailableError('素材库暂时不可用，本次没有返回未经核实的结果。');
        }
        const matched = inventory.items
          // Keep tenant isolation at this boundary too. The default material
          // reader already enforces it; this defensive check also protects a
          // future adapter or test double from widening visibility by mistake.
          .filter(record => accessibleMaterial(record, input.tenantId))
          .filter(record => matchesTerms([
            record.name, record.title, record.productName, record.tags, record.industry,
            record.shotFunction, record.sourceName,
          ], terms));
        return {
          domain,
          total: matched.length,
          items: matched.slice(0, 3).map(materialItem),
          workspace: workspaceLink(domain, query),
          sourceStatus: inventory.status,
        };
      }

      const rows = await readTenantVideos(dataStore, input.tenantId);
      const matched = rows
        .filter(record => text(record.contentFormat) !== 'image')
        .filter(record => !isAutoSeededVideo(record))
        .filter(record => !isSyntheticMaterial(record))
        .filter(record => matchesTerms([
          record.title, record.tags, record.platform, record.author, record.accountName,
        ], terms));
      return {
        domain,
        total: matched.length,
        items: matched.slice(0, 3).map(videoItem),
        workspace: workspaceLink(domain, query),
        sourceStatus: 'ready',
      };
    },
  };
}
