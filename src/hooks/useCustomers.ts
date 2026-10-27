import { restoreLocalCustomerPatch } from './localCustomerProfile';
import { useCallback, useEffect, useState } from 'react';
import { readLocalCustomerDrafts } from '../lib/localCustomerSimulation';
import { authHeader } from '../lib/auth';
import type { CustomerProfile, TimelineEvent } from '../types/customer';
import { isLocalForeignTradeMockEnabled } from '../mocks/foreignTradeOperations';

const MOCK_STORAGE_KEY = 'lingshu:mock-customer-conversations:v5';
const LEGACY_MOCK_STORAGE_KEYS = [
  'lingshu:mock-customer-conversations:v4',
  'lingshu:mock-customer-conversations:v3',
  'lingshu:mock-customer-conversations:v2',
];

function mockStorageKey(scope: string): string {
  return `${MOCK_STORAGE_KEY}:${scope || 'admin'}`;
}

async function storedMockCustomers(storageKey: string): Promise<CustomerProfile[]> {
  if (!isLocalForeignTradeMockEnabled()) return [];
  if (new URLSearchParams(window.location.search).get('mock') === 'quote') {
    const { createQuoteMockCustomers } = await import('../mocks/quoteCustomerProfiles');
    const seeds = createQuoteMockCustomers();
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
      const stored = Array.isArray(saved) ? saved.filter(item => seeds.some(seed => seed.id === item?.id)).map(cloneCustomer) : [];
      return seeds.map(seed => {
        const item = stored.find(item => item.id === seed.id);
        if (!item) return seed;
        // Upgrade untouched legacy quotation fixtures without overwriting human corrections.
        if (!item.contextTagCorrections?.length && !item.contextTagEvidence?.length && item.tags.every(tag => ['模拟客户', '报价调试'].includes(tag))) {
          return { ...item, tags: seed.tags, contextTagEvidence: seed.contextTagEvidence };
        }
        return item;
      });
    } catch { return seeds; }
  }
  const { createMockCustomers } = await import('../mocks/customerProfiles');
  const scope = storageKey.slice(`${MOCK_STORAGE_KEY}:`.length);
  const seededCustomers = () => createMockCustomers(scope);
  try {
    const scopedValue = localStorage.getItem(storageKey);
    const parsed = JSON.parse(scopedValue || '[]');
    if (!Array.isArray(parsed) || !parsed.length || !parsed.some(customer => customer?.id === 'mock-free-sandbox')) {
      LEGACY_MOCK_STORAGE_KEYS.forEach(key => {
        localStorage.removeItem(key);
        localStorage.removeItem(`${key}:${scope}`);
      });
      return seededCustomers();
    }
    const stored = parsed.map(cloneCustomer);
    if (stored.some(customer => /LED pendant lights|吊灯/i.test(`${customer.product} ${customer.outboundProduct} ${customer.timeline.map(item => item.body).join(' ')}`))) {
      localStorage.removeItem(storageKey);
      return seededCustomers();
    }
    const expectsForeignCustomers = scope === 'wenlantianxia-test@local.test' || scope === 'kzw14f0w3dl0ujl' || scope === 'ajcht1koyhwp4lf' || scope === 'local-foreign-trade-factory';
    const hasForeignCustomers = stored.some(customer => String(customer.id || '').startsWith('mock-export-'));
    if (expectsForeignCustomers !== hasForeignCustomers) {
      localStorage.removeItem(storageKey);
      return seededCustomers();
    }
    return stored;
  } catch {
    return seededCustomers();
  }
}

function persistMockCustomers(customers: CustomerProfile[], storageKey: string | null) {
  if (!storageKey) return;
  try { localStorage.setItem(storageKey, JSON.stringify(customers.filter(customer => customer.isMock))); } catch { /* Local preview also restores explicit saved drafts from its isolated backend. */ }
}

function cloneCustomer(customer: CustomerProfile): CustomerProfile {
  return {
    ...customer,
    intentSignals: [...customer.intentSignals],
    orders: customer.orders.map(order => ({
      ...order,
      items: order.items ? order.items.map(item => ({ ...item })) : undefined,
    })),
    tags: [...customer.tags],
    timeline: customer.timeline.map(event => ({
      ...event,
      audit: event.audit ? {
        ...event.audit,
        evidence: event.audit.evidence ? [...event.audit.evidence] : undefined,
        memoryApplied: event.audit.memoryApplied ? [...event.audit.memoryApplied] : undefined,
      } : undefined,
    })),
    simulation: customer.simulation ? {
      ...customer.simulation,
      memoryApplied: customer.simulation.memoryApplied ? [...customer.simulation.memoryApplied] : undefined,
      warning: customer.simulation.warning ? { ...customer.simulation.warning } : undefined,
    } : undefined,
  };
}

export function useCustomers(refreshKey = 0, includeMockCustomers = false, mockCustomerScope = 'admin'): {
  customers: CustomerProfile[];
  updateCustomer: (id: string, patch: Partial<CustomerProfile>) => void;
  appendTimelineEvent: (id: string, event: TimelineEvent) => void;
  updateTimelineEvent: (customerId: string, eventId: string, patch: Partial<TimelineEvent>) => void;
  removeTimelineEvent: (customerId: string, eventId: string) => void;
  loading: boolean;
  error: string;
} {
  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const scopedMockStorageKey = includeMockCustomers ? mockStorageKey(mockCustomerScope + (isLocalForeignTradeMockEnabled() && new URLSearchParams(window.location.search).get('mock') === 'quote' ? ':quote-debug' : '')) : null;

  useEffect(() => {
    if (!includeMockCustomers) {
      setCustomers(current => current.filter(customer => !customer.isMock));
      try { LEGACY_MOCK_STORAGE_KEYS.forEach(key => localStorage.removeItem(key)); } catch { /* ignore unavailable storage */ }
    }
    let alive = true;
    let timer: number | undefined;
    let inFlight = false;
    let activeController: AbortController | null = null;
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') void loadLiveCustomers().catch(() => {});
    };
    const loadLiveCustomers = async () => {
      // 后端无响应时轮询不能继续叠加，否则会积累挂起请求并拖慢整个页面。
      if (inFlight || !alive) return;
      inFlight = true;
      const controller = new AbortController();
      activeController = controller;
      const timeout = window.setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await fetch('/api/overseas/customers', { headers: authHeader(), signal: controller.signal });
        if (!response.ok) throw new Error(`客户会话读取失败（HTTP ${response.status}）`);
        const data = await response.json();
        if (!Array.isArray(data?.items)) throw new Error('客户会话返回格式异常，请重试');
        const items = data.items;
        if (!alive) return;
        setError('');
        const liveCustomers = items.map((item: CustomerProfile) => cloneCustomer({
          ...item,
          isReal: item.isHistorical ? false : item.isReal ?? true,
          isMock: item.isMock ?? false,
        }));
        const storedMocks = includeMockCustomers && scopedMockStorageKey
          ? await storedMockCustomers(scopedMockStorageKey)
          : [];
        const savedDrafts = includeMockCustomers ? await readLocalCustomerDrafts(controller.signal) : [];
        if (!alive) return;
        const restoredMocks = storedMocks.map(customer => {const saved=savedDrafts.find(item=>item.customerId===customer.id);return saved?restoreLocalCustomerPatch(customer,saved.patch):customer;});
        setCustomers(current => {
          if (liveCustomers.some((customer: CustomerProfile) => customer.localFollowupPreview === true)) return liveCustomers;
          if (!includeMockCustomers) return liveCustomers;
          const existingMocks = current.filter(customer => customer.isMock).map(customer => {
            const saved = savedDrafts.find(item => item.customerId === customer.id);
            return saved ? restoreLocalCustomerPatch(cloneCustomer(customer), saved.patch, true) : cloneCustomer(customer);
          });
          // Legacy sandbox storage may contain repeated IDs. React list keys
          // must remain unique when live conversations and saved mocks merge.
          const seen = new Set<string>();
          return [...liveCustomers, ...(existingMocks.length ? existingMocks : restoredMocks)].filter(customer => {
            if (seen.has(customer.id)) return false;
            seen.add(customer.id);
            return true;
          });
        });
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : '客户会话暂时无法读取');
        throw cause;
      } finally {
        window.clearTimeout(timeout);
        if (activeController === controller) activeController = null;
        inFlight = false;
      }
    };
    const load = async () => {
      setLoading(true);
      try {
        await loadLiveCustomers();
      } catch {
        const storedMocks = includeMockCustomers && scopedMockStorageKey
          ? await storedMockCustomers(scopedMockStorageKey)
          : [];
        if (alive) setCustomers(current => {
          if (!includeMockCustomers) return current;
          const existingMocks = current.filter(customer => customer.isMock).map(cloneCustomer);
          const seen = new Set<string>();
          return (existingMocks.length ? existingMocks : storedMocks).filter(customer => {
            if (seen.has(customer.id)) return false;
            seen.add(customer.id);
            return true;
          });
        });
      } finally {
        if (alive) setLoading(false);
      }
      // 首次加载失败也保留恢复轮询，服务恢复后无需用户刷新整页。
      if (alive) timer = window.setInterval(() => {
        if (document.visibilityState === 'visible') void loadLiveCustomers().catch(() => {});
      }, 5_000);
    };
    document.addEventListener('visibilitychange', refreshVisible);
    window.addEventListener('focus', refreshVisible);
    void load();
    return () => {
      alive = false;
      activeController?.abort();
      if (timer) window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshVisible);
      window.removeEventListener('focus', refreshVisible);
    };
  }, [refreshKey, includeMockCustomers, scopedMockStorageKey]);

  const updateCustomer = useCallback((id: string, patch: Partial<CustomerProfile>) => {
    setCustomers(list => {
      const next = list.map(customer => customer.id === id ? { ...customer, ...patch } : customer);
      persistMockCustomers(next, scopedMockStorageKey);
      return next;
    });
  }, [scopedMockStorageKey]);

  const appendTimelineEvent = useCallback((id: string, event: TimelineEvent) => {
    setCustomers(list => {
      const next = list.map(customer => customer.id === id
        ? { ...customer, timeline: [...customer.timeline, event], todoCompletedAt: event.actor === 'buyer' ? undefined : customer.todoCompletedAt }
        : customer
      );
      persistMockCustomers(next, scopedMockStorageKey);
      return next;
    });
  }, [scopedMockStorageKey]);

  const updateTimelineEvent = useCallback((customerId: string, eventId: string, patch: Partial<TimelineEvent>) => {
    setCustomers(list => {
      const next = list.map(customer => customer.id === customerId
        ? { ...customer, timeline: customer.timeline.map(event => event.id === eventId ? { ...event, ...patch } : event) }
        : customer
      );
      persistMockCustomers(next, scopedMockStorageKey);
      return next;
    });
  }, [scopedMockStorageKey]);

  const removeTimelineEvent = useCallback((customerId: string, eventId: string) => {
    setCustomers(list => {
      const next = list.map(customer => customer.id === customerId
        ? { ...customer, timeline: customer.timeline.filter(event => event.id !== eventId) }
        : customer
      );
      persistMockCustomers(next, scopedMockStorageKey);
      return next;
    });
  }, [scopedMockStorageKey]);

  return {
    customers,
    updateCustomer,
    appendTimelineEvent,
    updateTimelineEvent,
    removeTimelineEvent,
    loading,
    error,
  };
}
