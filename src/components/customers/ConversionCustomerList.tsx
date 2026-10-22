import { Button, Checkbox, Empty, Input, Popover, Select, Tabs, Tag } from 'antd';
import { useEffect, useState } from 'react';
import { Filter, Search } from 'lucide-react';
import { sortCustomersByLatestMessage } from '../../lib/customerRecency';
import { sortCustomersByPriority } from '../../lib/customerPriority';
import type { CustomerProfile, CustomerStage, HandlingMode } from '../../types/customer';
import { SourceIcon, sourceLabel } from './SourceIcon';
import { STAGE_LABEL, customerDisplayName } from './conversionPresentation';

export type CustomerView = 'inbox' | 'leads' | 'won' | 'silent';

type CustomerFilterKey = 'source' | 'country' | 'language' | 'stage' | 'handling' | 'tag';

interface CustomerListFilters {
  source: string;
  country: string;
  language: string;
  stage: string;
  handling: string;
  tag: string;
  unreadOnly: boolean;
  highIntentOnly: boolean;
}

export const VIEW_META: Record<CustomerView, { label: string; desc: string }> = {
  inbox: { label: '收件箱', desc: '按紧急程度排序的待处理会话。' },
  leads: { label: '潜客', desc: '新询盘和正在推进的商机。' },
  won: { label: '成交客户', desc: '已下单、待跟进的客户。' },
  silent: { label: '沉默客户', desc: '30/60 天未互动、需要唤醒的客户。' },
};

const EMPTY_CUSTOMER_FILTERS: CustomerListFilters = {
  source: 'all',
  country: 'all',
  language: 'all',
  stage: 'all',
  handling: 'all',
  tag: 'all',
  unreadOnly: false,
  highIntentOnly: false,
};

const HANDLING_COLOR: Record<HandlingMode, string> = {
  ai_auto: 'var(--color-accent)',
  ai_draft: 'var(--color-amber)',
  human_needed: 'var(--color-red)',
};

export function filterCustomers(view: CustomerView, customers: CustomerProfile[]) {
  if (view === 'inbox') return sortCustomersByLatestMessage(customers.filter(customer => customer.isHistorical || customer.inboxReason));
  if (view === 'leads') return customers.filter(customer => ['lead', 'inquiry', 'quoted'].includes(customer.stage)).sort((a, b) => b.intentScore - a.intentScore);
  if (view === 'won') return customers.filter(customer => customer.stage === 'won');
  return sortCustomersByPriority(customers.filter(customer => customer.stage === 'silent30' || customer.stage === 'silent60'));
}

function applyCustomerListFilters(customers: CustomerProfile[], filters: CustomerListFilters) {
  return customers.filter(customer => {
    if (filters.source !== 'all' && customer.source !== filters.source) return false;
    if (filters.country !== 'all' && customer.countryName !== filters.country) return false;
    if (filters.language !== 'all' && customer.language !== filters.language) return false;
    if (filters.stage !== 'all' && customer.stage !== filters.stage) return false;
    if (filters.handling !== 'all' && customer.handlingMode !== filters.handling) return false;
    if (filters.tag !== 'all' && !customer.tags.includes(filters.tag)) return false;
    if (filters.unreadOnly && !customer.hasUnread) return false;
    if (filters.highIntentOnly && customer.intentScore < 80) return false;
    return true;
  });
}

function FilterSelect({ label, value, onChange, options, renderLabel }: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: string[];
  renderLabel?: (item: string) => string;
}) {
  return <label className="block">
    <span className="text-[10px] font-bold text-text-muted">{label}</span>
    <Select aria-label={label} value={value} onChange={onChange} className="mt-1 w-full" options={[{ value: 'all', label: '全部' }, ...options.map(value => ({ value, label: renderLabel ? renderLabel(value) : value }))]}/>
  </label>;
}

export function CompactCustomerList({
  view,
  selectedId,
  customers,
  onOpen,
  onViewChange,
  onVisibleSelectionChange,
}: {
  view: CustomerView;
  selectedId: string | null;
  customers: CustomerProfile[];
  onOpen: (id: string) => void;
  onViewChange: (view: CustomerView) => void;
  onVisibleSelectionChange: (id: string | null, filteredEmpty: boolean) => void;
}) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<CustomerListFilters>(EMPTY_CUSTOMER_FILTERS);
  const baseList = filterCustomers(view, customers).filter((customer, index, list) => list.findIndex(item => item.id === customer.id) === index);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const list = applyCustomerListFilters(baseList, filters).filter(customer => !normalizedQuery || [
    customer.name,
    customer.summary,
    customer.product,
    customer.outboundProduct,
    customer.countryName,
    customer.timeline.at(-1)?.body,
  ].some(value => String(value || '').toLocaleLowerCase().includes(normalizedQuery)));
  const activeFilterCount = [
    filters.source !== 'all',
    filters.country !== 'all',
    filters.language !== 'all',
    filters.stage !== 'all',
    filters.handling !== 'all',
    filters.tag !== 'all',
    filters.unreadOnly,
    filters.highIntentOnly,
  ].filter(Boolean).length;
  const setFilterValue = (key: CustomerFilterKey, value: string) => setFilters(current => ({ ...current, [key]: value }));
  const optionList = (values: string[]) => Array.from(new Set(values.filter(Boolean)));
  const sourceOptions = optionList(customers.map(customer => customer.source));
  const countryOptions = optionList(customers.map(customer => customer.countryName));
  const languageOptions = optionList(customers.map(customer => customer.language));
  const tagOptions = optionList(customers.flatMap(customer => customer.tags));

  useEffect(() => {
    if (selectedId && list.some(customer => customer.id === selectedId)) return;
    onVisibleSelectionChange(list[0]?.id ?? null, activeFilterCount > 0 && list.length === 0);
  }, [activeFilterCount, list, onVisibleSelectionChange, selectedId]);
  const renderCustomer = (customer: CustomerProfile) => {
    const lastMessage = customer.timeline[customer.timeline.length - 1];
    const lastMessagePreview = (lastMessage?.translatedBody || lastMessage?.body || lastMessage?.title || '暂无消息').replace(/\s+/g, ' ').trim();
    const displayName = customerDisplayName(customer);
    const statusColor = HANDLING_COLOR[customer.handlingMode];
    const hasUnread = Boolean(customer.hasUnread);
    return (
      <button
        key={customer.id}
        type="button"
        data-layout-check="customer-row"
        onClick={() => onOpen(customer.id)}
        aria-current={customer.id === selectedId ? 'true' : undefined}
        className={`ls-customer-list-row ${customer.id === selectedId ? 'is-selected' : ''}`}
      >
        <div className="flex items-start gap-2.5">
          <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-xs font-semibold text-text-secondary">
            <span className="absolute -left-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white transition-opacity" style={{ backgroundColor: hasUnread ? '#dc2626' : statusColor, opacity: hasUnread ? 1 : 0 }} />
            {customer.avatar}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold leading-5 text-text-primary" title={displayName}>{displayName}</p>
                <p dir="auto" className="mt-0.5 line-clamp-2 text-left text-xs leading-[18px] text-text-muted" title={lastMessagePreview}>{lastMessagePreview}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {customer.isHistorical && <Tag className="!m-0 !text-[9px]">历史会话</Tag>}
                  {customer.simulation?.warning && <span className="rounded bg-red-600 px-1.5 py-0.5 text-[9px] font-semibold text-white">大单预警</span>}
                  <SourceIcon source={customer.source} size={11} />
                </div>
              </div>
              <span className="shrink-0 text-[11px] font-medium text-text-muted">{lastMessage?.time || customer.lastActive}</span>
            </div>
          </div>
        </div>
      </button>
    );
  };
  return <aside data-testid="conversation-list" className="flex h-full w-full shrink-0 flex-col bg-white lg:w-52 xl:w-56 2xl:w-60">
    <div className="border-b border-border px-3 pt-2">
      <div className="flex items-center gap-2">
        <Input className="min-w-0 flex-1" allowClear value={query} onChange={event => setQuery(event.target.value)} prefix={<Search size={15}/>} placeholder="搜索客户或消息" aria-label="搜索客户或消息" />
        <Popover trigger="click" placement="bottomLeft" open={filterOpen} onOpenChange={setFilterOpen} title="筛选客户" content={<div className="w-72 max-w-[calc(100vw-48px)]">
          <p className="mb-3 text-xs text-text-secondary">当前命中 {list.length}/{baseList.length}</p>
          <div className="grid grid-cols-2 gap-3">
            <FilterSelect label="来源渠道" value={filters.source} onChange={value => setFilterValue('source', value)} options={sourceOptions} renderLabel={sourceLabel}/>
            <FilterSelect label="国家/地区" value={filters.country} onChange={value => setFilterValue('country', value)} options={countryOptions}/>
            <FilterSelect label="语言" value={filters.language} onChange={value => setFilterValue('language', value)} options={languageOptions}/>
            <FilterSelect label="客户阶段" value={filters.stage} onChange={value => setFilterValue('stage', value)} options={Object.keys(STAGE_LABEL)} renderLabel={item => STAGE_LABEL[item as CustomerStage] || item}/>
            <FilterSelect label="处理方式" value={filters.handling} onChange={value => setFilterValue('handling', value)} options={['human_needed', 'ai_draft', 'ai_auto']} renderLabel={item => item === 'human_needed' ? '需要你处理' : item === 'ai_draft' ? '等你确认' : 'AI 接待中'}/>
            <FilterSelect label="客户标签" value={filters.tag} onChange={value => setFilterValue('tag', value)} options={tagOptions}/>
          </div>
          <div className="my-4 flex flex-wrap gap-3"><Checkbox checked={filters.unreadOnly} onChange={event => setFilters(current => ({ ...current, unreadOnly: event.target.checked }))}>只看未读</Checkbox><Checkbox checked={filters.highIntentOnly} onChange={event => setFilters(current => ({ ...current, highIntentOnly: event.target.checked }))}>高意向 80+</Checkbox></div>
          <div className="flex justify-between"><Button type="text" onClick={() => setFilters(EMPTY_CUSTOMER_FILTERS)}>清空筛选</Button><Button type="primary" onClick={() => setFilterOpen(false)}>完成</Button></div>
        </div>}><Button className="shrink-0 whitespace-nowrap" aria-label={activeFilterCount ? `已启用 ${activeFilterCount} 项筛选` : '筛选客户'} icon={<Filter size={15}/>}>{activeFilterCount || null}</Button></Popover>
      </div>
      <Tabs className="ls-customer-view-tabs" aria-label="客户视图" size="small" activeKey={view} onChange={key => onViewChange(key as CustomerView)} items={(Object.entries(VIEW_META) as [CustomerView, typeof VIEW_META[CustomerView]][]).map(([key, item]) => ({ key, label: item.label }))}/>
    </div>
    <div className="ls-customer-list-scroll min-h-0 flex-1 overflow-y-auto">{list.map(renderCustomer)}{!list.length && <div className="px-4 py-10"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有符合当前条件的客户"/>{activeFilterCount > 0 && <Button block onClick={() => setFilters(EMPTY_CUSTOMER_FILTERS)}>清空筛选</Button>}</div>}</div>
  </aside>;
}
