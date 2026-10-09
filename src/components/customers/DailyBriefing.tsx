import { Button, Drawer } from "antd";
import { useEffect, useState } from 'react';
import { BookOpen, X } from 'lucide-react';
import type { CustomerProfile } from '../../types/customer';
import { buildPrioritySuggestion, completedTodoCustomers, pendingCustomers } from '../../lib/customerPriority';
import { SourceIcon } from './SourceIcon';
import { authHeader } from '../../lib/auth';

interface Props {
  customers: CustomerProfile[];
  onSelectCustomer: (id: string) => void;
  onClose: () => void;
}

interface KnowledgeMissCluster {
  topic: string;
  count: number;
  examples: string[];
}

interface NightModeBriefing {
  customers: number;
  autoReplies: number;
  drafts: number;
  calls: number;
  autoCustomerIds: string[];
  draftCustomerIds: string[];
  callCustomerIds: string[];
}

interface PublishingBriefing {
  title: string;
  platform: string;
  inquiries: number;
  postId: string;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return '早上好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function groupLabel(mode: CustomerProfile['handlingMode']) {
  if (mode === 'human_needed') return '需要你处理';
  if (mode === 'ai_draft') return '等你确认';
  return 'AI 接待中';
}

function priorityDot(customer: CustomerProfile) {
  const suggestion = buildPrioritySuggestion(customer);
  if (suggestion.tone === 'red') return 'bg-red-500';
  if (suggestion.tone === 'amber') return 'bg-amber-500';
  if (suggestion.tone === 'blue') return 'bg-sky-500';
  return 'bg-emerald-500';
}

export function DailyBriefing({ customers, onSelectCustomer, onClose }: Props) {
  const [missClusters, setMissClusters] = useState<KnowledgeMissCluster[]>([]);
  const [nightBriefing, setNightBriefing] = useState<NightModeBriefing | null>(null);
  const [publishingBriefing, setPublishingBriefing] = useState<PublishingBriefing | null>(null);
  const uniqueCustomers = customers.filter((customer, index, list) => list.findIndex(item => item.id === customer.id) === index);
  const pending = pendingCustomers(uniqueCustomers);
  const completed = completedTodoCustomers(uniqueCustomers);
  const grouped = [
    { mode: 'human_needed' as const, items: pending.filter(customer => customer.handlingMode === 'human_needed') },
    { mode: 'ai_draft' as const, items: pending.filter(customer => customer.handlingMode === 'ai_draft') },
  ].filter(group => group.items.length > 0);
  const first = pending[0];

  const select = (id: string) => {
    onSelectCustomer(id);
    onClose();
  };

  useEffect(() => {
    fetch('/api/overseas/customers/knowledge-misses/briefing')
      .then(resp => resp.ok ? resp.json() : null)
      .then(data => setMissClusters(Array.isArray(data?.items) ? data.items : []))
      .catch(() => setMissClusters([]));
    fetch('/api/overseas/customers/night-mode/briefing')
      .then(resp => resp.ok ? resp.json() : null)
      .then(data => setNightBriefing(data?.item ?? null))
      .catch(() => setNightBriefing(null));
    fetch('/api/overseas/publishing/briefing', { headers: authHeader() })
      .then(resp => resp.ok ? resp.json() : null)
      .then(data => setPublishingBriefing(data?.item ?? null))
      .catch(() => setPublishingBriefing(null));
  }, []);

  const addKnowledge = (cluster: KnowledgeMissCluster) => {
    localStorage.setItem('lingshu:enterprise:prefill-faq', JSON.stringify({
      question: cluster.topic,
      answer: '',
      source: 'learned',
    }));
    window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'enterprise' } }));
    onClose();
  };

  const openPublishingBriefing = () => {
    window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'strategy' } }));
    onClose();
  };

  return <Drawer open title={`${greeting()}，今天有 ${pending.length} 件事需要你`} size={560} onClose={onClose} footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>稍后</Button><Button type="primary" onClick={() => first && select(first.id)} disabled={!first}>开始处理</Button></div>}>
        <div className="py-2">
          <div className="space-y-4">
            {publishingBriefing && (
              <Button
                htmlType="button"
                onClick={openPublishingBriefing}
                className="!h-auto min-h-9 !whitespace-normal !justify-start flex w-full items-start gap-3 rounded-lg border border-sky-100 bg-sky-50/80 p-3 text-left transition-colors hover:border-sky-200 hover:bg-sky-50"
              >
                <SourceIcon source={`whatsapp_from_${publishingBriefing.platform}`} size={16} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-sky-950">
                    你的视频《{publishingBriefing.title}》昨天带来了 {publishingBriefing.inquiries} 条询盘
                  </p>
                  <p className="mt-1 text-[11px] font-semibold text-sky-800">点击查看首页社媒数据</p>
                </div>
              </Button>
            )}
            {nightBriefing && (
              <section className="rounded-lg border border-emerald-100 bg-emerald-50/80 p-3">
                <p className="text-xs font-semibold text-emerald-950">
                  昨夜 AI 接待了 {nightBriefing.customers} 位客户，自动回复 {nightBriefing.autoReplies} 条 ✓
                </p>
                <p className="mt-1 text-[11px] font-semibold text-emerald-800">
                  等你确认 {nightBriefing.drafts} 条 | {nightBriefing.calls} 位客户想通话
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button htmlType="button" onClick={() => nightBriefing.autoCustomerIds[0] && select(nightBriefing.autoCustomerIds[0])} className="!h-auto min-h-9 !whitespace-normal rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-800">
                    看自动接待
                  </Button>
                  <Button htmlType="button" onClick={() => nightBriefing.draftCustomerIds[0] && select(nightBriefing.draftCustomerIds[0])} className="!h-auto min-h-9 !whitespace-normal rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                    看待确认
                  </Button>
                  <Button htmlType="button" onClick={() => nightBriefing.callCustomerIds[0] && select(nightBriefing.callCustomerIds[0])} className="!h-auto min-h-9 !whitespace-normal rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-red-700">
                    看通话客户
                  </Button>
                </div>
              </section>
            )}
            {missClusters.length > 0 && (
              <section>
                <p className="mb-2 text-[11px] font-semibold text-text-muted">知识库缺口</p>
                <div className="space-y-2">
                  {missClusters.map(cluster => (
                    <Button
                      key={cluster.topic}
                      htmlType="button"
                      onClick={() => addKnowledge(cluster)}
                      className="!h-auto min-h-9 !whitespace-normal !justify-start flex w-full items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-left transition-colors hover:border-amber-300 hover:bg-amber-100"
                    >
                      <BookOpen size={15} className="mt-0.5 text-amber-700" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-amber-900">本周 {cluster.count} 位客户问到「{cluster.topic}」，知识库还没有这条 → 补充</p>
                        <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-amber-800">{cluster.examples.slice(0, 2).join(' / ')}</p>
                      </div>
                    </Button>
                  ))}
                </div>
              </section>
            )}
            {grouped.map(group => (
              <section key={group.mode}>
                <p className="mb-2 text-[11px] font-semibold text-text-muted">{groupLabel(group.mode)}</p>
                <div className="space-y-2">
                  {group.items.map(customer => {
                    const suggestion = buildPrioritySuggestion(customer);
                    return (
                      <Button
                        key={customer.id}
                        htmlType="button"
                        onClick={() => select(customer.id)}
                        className="!h-auto min-h-9 !whitespace-normal !justify-start flex w-full items-start gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-left transition-colors hover:border-slate-300 hover:bg-white"
                      >
                        <SourceIcon source={customer.source} size={15} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-xs font-semibold text-text-primary">{customer.name}</p>
                            <span className={`h-2 w-2 rounded-full ${priorityDot(customer)}`} />
                          </div>
                          <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-text-muted">{suggestion.reason}</p>
                        </div>
                      </Button>
                    );
                  })}
                </div>
              </section>
            ))}
            {completed.length > 0 && (
              <section>
                <p className="mb-2 text-[11px] font-semibold text-text-muted">已完成</p>
                <div className="space-y-2">
                  {completed.map(customer => (
                    <Button
                      key={customer.id}
                      htmlType="button"
                      onClick={() => select(customer.id)}
                      className="!h-auto min-h-9 !whitespace-normal !justify-start flex w-full items-start gap-3 rounded-lg border border-emerald-100 bg-emerald-50/70 px-3 py-2.5 text-left transition-colors hover:border-emerald-200 hover:bg-emerald-50"
                    >
                      <SourceIcon source={customer.source} size={15} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-xs font-semibold text-text-primary">{customer.name}</p>
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">已完成</span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-emerald-700">今天已处理，已放到待办底部。</p>
                      </div>
                    </Button>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>

  </Drawer>;
}
