import { useEffect, useRef, useState } from 'react';
import { Check, Lock, Pencil, X } from 'lucide-react';
import { Card, CardContent } from '../../ui/card';
import { SourceIcon, sourceLabel } from '../SourceIcon';
import type { CustomerProfile, CustomerStage } from '../../../types/customer';
import { authHeader } from '../../../lib/auth';
import { LiveLocalTime } from '../LiveLocalTime';
import { useDismissibleLayer } from '../../../hooks/useDismissibleLayer';

const LANGUAGE_OPTIONS = ['中文', '英语', '西语', '阿语', '葡语', '法语', '俄语', '印尼语', '越南语', '泰语', '其他'];
const STAGE_OPTIONS: Array<{ value: CustomerStage; label: string }> = [
  { value: 'lead', label: '新线索' },
  { value: 'inquiry', label: '需求确认' },
  { value: 'quoted', label: '已报价' },
  { value: 'won', label: '已成交' },
  { value: 'silent30', label: '沉默 30 天' },
  { value: 'silent60', label: '沉默 60 天' },
];

export function BasicInfoWidget({
  customer,
  onCustomerPatch,
}: {
  customer: CustomerProfile;
  onCustomerPatch?: (patch: Partial<CustomerProfile>) => void;
}) {
  const [languageOpen, setLanguageOpen] = useState(false);
  const [sandboxEditing, setSandboxEditing] = useState(false);
  const [sandboxDraft, setSandboxDraft] = useState<{ name: string; countryName: string; language: string; product: string; estimatedValue: string; stage: CustomerStage }>({
    name: '', countryName: '', language: '', product: '', estimatedValue: '', stage: 'lead',
  });
  const languageMenuRef = useRef<HTMLDivElement>(null);
  useDismissibleLayer(languageOpen, languageMenuRef, () => setLanguageOpen(false));

  useEffect(() => {
    setSandboxDraft({
      name: customer.name,
      countryName: customer.countryName,
      language: customer.language,
      product: customer.outboundProduct || customer.product,
      estimatedValue: customer.estimatedValue,
      stage: customer.stage,
    });
    setSandboxEditing(false);
  }, [customer.id]);

  const saveSandboxProfile = () => {
    const name = sandboxDraft.name.trim() || '模拟客户';
    const product = sandboxDraft.product.trim() || '待填写';
    onCustomerPatch?.({
      name,
      avatar: name.slice(0, 1).toUpperCase(),
      countryName: sandboxDraft.countryName.trim() || '未知',
      language: sandboxDraft.language || '中文',
      languageLocked: true,
      product,
      outboundProduct: product,
      estimatedValue: sandboxDraft.estimatedValue.trim() || '待评估',
      stage: sandboxDraft.stage,
      summary: `自由模拟客户；当前需求：${product}；地区：${sandboxDraft.countryName.trim() || '未知'}。`,
      handlingReason: '模拟资料已更新，等待客户消息后生成建议',
    });
    setSandboxEditing(false);
  };

  const updateLanguage = (language: string) => {
    onCustomerPatch?.({ language, languageLocked: true });
    setLanguageOpen(false);
  };
  const displaySource = customer.source;
  const sourceText = sourceLabel(displaySource);
  const openSourcePost = async () => {
    if (!customer.sourcePostId && customer.softAttribution?.candidates?.[0]?.id) {
      const candidate = customer.softAttribution.candidates[0];
      try {
        const resp = await fetch(`/api/overseas/customers/${encodeURIComponent(customer.id)}/source-attribution`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader() },
          body: JSON.stringify({ postId: candidate.id }),
        });
        if (!resp.ok) throw new Error('confirm_failed');
        onCustomerPatch?.({
          source: `whatsapp_from_${candidate.platform}`,
          sourcePostId: candidate.id,
          sourceTrackCode: candidate.trackCode,
          sourcePostTitle: candidate.title,
          sourcePostPlatform: candidate.platform,
          softAttribution: undefined,
        });
      } catch {
        window.alert('来源确认失败，请稍后再试');
      }
      return;
    }
    if (!customer.sourcePostId) return;
    window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'strategy' } }));
  };

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-sm font-black">
            {customer.avatar}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-sm font-black text-text-primary">{customer.name}</p>
              {customer.simulation?.editable && !sandboxEditing && (
                <button type="button" onClick={() => setSandboxEditing(true)} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-primary" title="编辑模拟客户资料">
                  <Pencil size={12} />
                </button>
              )}
            </div>
            <p className="text-xs text-text-muted">{customer.email || '暂无邮箱'}</p>
            <div className="mt-1 flex items-center">
              <SourceIcon source={customer.source} size={14} />
            </div>
          </div>
        </div>
        {customer.simulation?.editable && sandboxEditing && (
          <div className="mt-4 rounded-2xl border border-cyan-200 bg-cyan-50/60 p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-xs font-black text-cyan-900">编辑模拟客户</p>
              <div className="flex gap-1">
                <button type="button" onClick={() => setSandboxEditing(false)} className="flex h-7 w-7 items-center justify-center rounded-lg text-cyan-700 hover:bg-white" title="取消"><X size={13} /></button>
                <button type="button" onClick={saveSandboxProfile} className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-700 text-white" title="保存"><Check size={13} /></button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input aria-label="模拟客户名称" value={sandboxDraft.name} onChange={event => setSandboxDraft(current => ({ ...current, name: event.target.value }))} placeholder="客户名称" className="rounded-lg border border-cyan-200 bg-white px-2.5 py-2 text-xs outline-none focus:border-cyan-500" />
              <input aria-label="模拟客户国家或地区" value={sandboxDraft.countryName} onChange={event => setSandboxDraft(current => ({ ...current, countryName: event.target.value }))} placeholder="国家/地区" className="rounded-lg border border-cyan-200 bg-white px-2.5 py-2 text-xs outline-none focus:border-cyan-500" />
              <select aria-label="模拟客户语言" value={sandboxDraft.language} onChange={event => setSandboxDraft(current => ({ ...current, language: event.target.value }))} className="rounded-lg border border-cyan-200 bg-white px-2.5 py-2 text-xs outline-none focus:border-cyan-500">
                {LANGUAGE_OPTIONS.map(language => <option key={language} value={language}>{language}</option>)}
              </select>
              <input aria-label="模拟客户预估金额" value={sandboxDraft.estimatedValue} onChange={event => setSandboxDraft(current => ({ ...current, estimatedValue: event.target.value }))} placeholder="预估金额" className="rounded-lg border border-cyan-200 bg-white px-2.5 py-2 text-xs outline-none focus:border-cyan-500" />
              <select aria-label="模拟客户采购阶段" value={sandboxDraft.stage} onChange={event => setSandboxDraft(current => ({ ...current, stage: event.target.value as CustomerStage }))} className="rounded-lg border border-cyan-200 bg-white px-2.5 py-2 text-xs outline-none focus:border-cyan-500">
                {STAGE_OPTIONS.map(stage => <option key={stage.value} value={stage.value}>{stage.label}</option>)}
              </select>
              <input aria-label="模拟客户需求" value={sandboxDraft.product} onChange={event => setSandboxDraft(current => ({ ...current, product: event.target.value }))} placeholder="客户需求/产品" className="col-span-2 rounded-lg border border-cyan-200 bg-white px-2.5 py-2 text-xs outline-none focus:border-cyan-500" />
            </div>
            <p className="mt-2 text-[10px] leading-4 text-cyan-700">保存后，从中间“模拟客户输入”发送第一句话。</p>
          </div>
        )}
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl bg-surface-2 p-3">
            <p className="text-text-muted">国家/地区</p>
            <p className="mt-1 font-bold text-text-primary">{customer.countryName || '未知'}</p>
          </div>
          <div ref={languageMenuRef} className="relative rounded-xl bg-surface-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-text-muted">语言</p>
              <div className="flex items-center gap-1">
                {customer.languageLocked && (
                  <span title="已手动指定，AI 不再自动更改">
                    <Lock size={12} className="text-emerald-600" />
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setLanguageOpen(open => !open)}
                  className="flex h-6 w-6 items-center justify-center rounded-lg text-text-muted hover:bg-white hover:text-text-primary"
                  title="手动指定回复语言"
                >
                  <Pencil size={12} />
                </button>
              </div>
            </div>
            <p className="mt-1 font-bold text-text-primary">{customer.language}</p>
            {languageOpen && (
              <div className="absolute right-2 top-11 z-30 w-32 overflow-hidden rounded-xl border border-border bg-white py-1 shadow-lg">
                {LANGUAGE_OPTIONS.map(language => (
                  <button
                    key={language}
                    type="button"
                    onClick={() => updateLanguage(language)}
                    className={`block w-full px-3 py-2 text-left text-xs font-bold hover:bg-surface-2 ${customer.language === language ? 'text-primary' : 'text-text-secondary'}`}
                  >
                    {language}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-xl bg-surface-2 p-3">
            <p className="text-text-muted">当地时间</p>
            <p className="mt-1 font-bold text-text-primary"><LiveLocalTime timeZone={customer.timeZone} /></p>
          </div>
          <div className="rounded-xl bg-surface-2 p-3">
            <p className="text-text-muted">来源渠道</p>
            <div className="mt-1 flex items-center gap-1.5">
              <SourceIcon source={displaySource} size={16} />
              <button
                type="button"
                onClick={openSourcePost}
                disabled={!customer.sourcePostId && !customer.softAttribution?.candidates?.length}
                className="min-w-0 truncate text-left font-bold text-text-primary disabled:cursor-default enabled:hover:text-primary"
                title={sourceText}
              >
                {sourceText}
              </button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
