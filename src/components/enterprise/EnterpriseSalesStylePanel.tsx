import { Loader2, RotateCcw } from 'lucide-react';
import type { SalesStyleProfile } from './enterpriseProfileTypes';
import type { useEnterpriseSalesStyle } from './useEnterpriseSalesStyle';

const inputCls = 'w-full';
const textareaCls = 'w-full resize-y';

type SalesStyleController = ReturnType<typeof useEnterpriseSalesStyle>;

interface Props {
  styleProfile: SalesStyleProfile | undefined;
  controller: SalesStyleController;
}

export default function EnterpriseSalesStylePanel({ styleProfile, controller }: Props) {
  const {
    styleDistilling, styleMessage, updateSalesStyleField, deleteSalesStyleField,
    updateTabooPhrases, deleteTabooPhrases, distillSalesStyle,
  } = controller;
  return (
          <section className="rounded-lg border border-border bg-white p-5 ">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-text-primary">你的销售风格</p>
                <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
                  AI 从你 {styleProfile?.learnedFromCount ?? 0} 次真实回复中学到的风格，持续更新，生成回复时会参考。
                </p>
                {styleMessage && <p className="mt-2 text-[11px] font-bold text-primary">{styleMessage}</p>}
              </div>
              <div className="flex items-center gap-2">
                {styleProfile?.lastDistilledAt && (
                  <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-bold text-text-muted">
                    {new Date(styleProfile.lastDistilledAt).toLocaleDateString('zh-CN')} 更新
                  </span>
                )}
                <button type="button" onClick={distillSalesStyle} disabled={styleDistilling} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary hover:bg-surface-2 disabled:opacity-60">
                  {styleDistilling ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}重新学习
                </button>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3">
              {([
                ['greeting_style', '开场称呼'],
                ['quoting_stance', '报价姿态'],
                ['followup_rhythm', '跟进节奏'],
              ] as const).map(([key, label]) => {
                const item = styleProfile?.[key];
                return (
                  <div key={key} className="rounded-lg border border-border bg-surface-2/50 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-text-primary">{label}</p>
                      <button type="button" onClick={() => deleteSalesStyleField(key)} aria-label={`删除${label}销售风格`} className="text-[11px] font-bold text-text-muted hover:text-red">删除</button>
                    </div>
                    <textarea
                      className={textareaCls}
                      rows={3}
                      value={item?.value ?? ''}
                      onChange={event => updateSalesStyleField(key, event.target.value)}
                      placeholder="暂未学习到，或手动补充"
                    />
                    <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-text-muted">佐证：{item?.evidence || '暂无'}</p>
                    {item?.manual && <span className="mt-2 inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">人工锁定</span>}
                  </div>
                );
              })}
            </div>
            <div className="mt-3 rounded-lg border border-border bg-surface-2/50 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-text-primary">禁用表达</p>
                <button type="button" onClick={deleteTabooPhrases} aria-label="删除禁用表达" className="text-[11px] font-bold text-text-muted hover:text-red">删除</button>
              </div>
              <input
                className={inputCls}
                value={(styleProfile?.taboo_phrases?.value ?? []).join('，')}
                onChange={event => updateTabooPhrases(event.target.value)}
                placeholder="用逗号分隔，例如：最低价，马上下单"
              />
              <p className="mt-2 text-[11px] text-text-muted">佐证：{styleProfile?.taboo_phrases?.evidence || '暂无'}</p>
            </div>
            {(styleProfile?.sample_pairs ?? []).length > 0 && (
              <div className="mt-3 rounded-lg border border-border bg-surface-2/50 p-3">
                <p className="text-xs font-semibold text-text-primary">代表样本</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {(styleProfile?.sample_pairs ?? []).slice(0, 4).map((pair, index) => (
                    <div key={`${pair.trigger}-${index}`} className="rounded-lg bg-white p-2 text-[11px] leading-5 text-text-secondary">
                      <p className="font-bold text-text-primary">买家：{pair.trigger}</p>
                      <p className="mt-1">定稿：{pair.final}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
  );
}
