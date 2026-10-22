import type { Dispatch, SetStateAction } from 'react';
import type { AutonomyLevel, HandoffRules } from './enterpriseProfileTypes';

const AUTONOMY_OPTIONS: Array<{ value: AutonomyLevel; title: string; desc: string; detail: string }> = [
  { value: 'remind', title: '只提醒我', desc: 'AI 只判断优先级并提醒', detail: '不生成草稿，不自动发送' },
  { value: 'draft', title: '草稿需确认（推荐）', desc: 'AI 结合当前对话写草稿', detail: '由你检查后发送' },
  { value: 'auto', title: '已审批问答自动回', desc: '高置信命中标准问答时直发', detail: '其他情况仍转草稿或人工' },
];

export const AUTO_REPLY_SCOPE = ['当前问题与已审批 FAQ 语义一致', '语境判定置信度不低于 90%', '回答原文通过价格与承诺红线检查'];

interface AutonomyProps {
  autonomyHighlight: boolean;
  effectiveAutonomy: AutonomyLevel;
  configuredAutonomy: AutonomyLevel;
  customerServiceEnabled: boolean;
  customerServiceObservationFinished: boolean;
  partialAutoReplyAuthorized: boolean;
  canAutoReply: boolean;
  autoReplyBlockReason: string;
  approvedFaqCount: number;
  setAutonomy: (value: AutonomyLevel) => void;
}

export function EnterpriseAiAutonomySection({
  autonomyHighlight, effectiveAutonomy, configuredAutonomy,
  customerServiceEnabled, customerServiceObservationFinished,
  partialAutoReplyAuthorized, canAutoReply, autoReplyBlockReason,
  approvedFaqCount, setAutonomy,
}: AutonomyProps) {
  return (
    <section id="ai-autonomy" data-lingshu-guide="enterprise-autonomy" className={`py-5 transition-all first:pt-0 ${autonomyHighlight ? 'rounded-lg ring-2 ring-amber-300 ring-offset-4' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-text-primary">AI 参与程度</p>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">
          当前：{AUTONOMY_OPTIONS.find(item => item.value === effectiveAutonomy)?.title}
        </span>
      </div>
      {!customerServiceEnabled && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
          <p className="text-xs font-semibold text-slate-700">智能客服总开关未开启，社媒账号接入后也只收消息，不会自动处理。</p>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'conversion' } }))}
            className="rounded-lg bg-slate-950 px-3 py-1.5 text-[11px] font-semibold text-white"
          >
            去开启
          </button>
        </div>
      )}
      {customerServiceEnabled && !customerServiceObservationFinished && (
        <p className="mt-4 rounded-lg border border-cyan-100 bg-cyan-50 px-3 py-2.5 text-xs font-semibold text-cyan-900">
          当前处于 3 天建议观察期：AI 只生成建议，所有消息都由你确认后发送。
        </p>
      )}
      {customerServiceObservationFinished && !partialAutoReplyAuthorized && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5">
          <p className="text-xs font-semibold text-amber-900">建议模式已满 3 天，请在“我的客户”决定是否开放部分直接回复。</p>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'conversion' } }))}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-[11px] font-semibold text-white"
          >
            去决定
          </button>
        </div>
      )}
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        {AUTONOMY_OPTIONS.map(option => {
          const active = effectiveAutonomy === option.value;
          const disabled = option.value === 'auto' && !canAutoReply;
          return (
            <button
              key={option.value}
              type="button"
              title={disabled ? autoReplyBlockReason : undefined}
              disabled={disabled}
              onClick={() => setAutonomy(option.value)}
              className={`min-h-[118px] rounded-lg border p-3 text-left transition-all disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 ${active ? 'border-slate-950 bg-slate-950 text-white ' : 'border-border bg-white text-text-primary hover:border-slate-300 hover:bg-surface-2'}`}
            >
              <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-semibold ${active ? 'border-white bg-white text-slate-950' : 'border-border text-text-muted'}`}>
                {active ? '✓' : ''}
              </span>
              <p className="mt-2 text-xs font-semibold">{option.title}</p>
              <p className={`mt-2 text-[11px] leading-5 ${active ? 'text-white/80' : disabled ? 'text-slate-400' : 'text-text-muted'}`}>{option.desc}</p>
              <p className={`text-[11px] leading-5 ${active ? 'text-white/80' : disabled ? 'text-slate-400' : 'text-text-muted'}`}>{disabled ? autoReplyBlockReason : option.detail}</p>
            </button>
          );
        })}
      </div>
      {configuredAutonomy === 'auto' && !canAutoReply && (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800">
          {autoReplyBlockReason}，当前按“草稿需确认”执行。
        </p>
      )}
      <div className="mt-4 border-t border-border pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-text-primary">自动发送边界</p>
          <span className="text-[11px] font-bold text-text-muted">已审批 {approvedFaqCount} 条 · 启用要求 5 条</span>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
          {AUTO_REPLY_SCOPE.map((item, index) => (
            <div key={item} className="flex items-start gap-2 rounded-md bg-emerald-50 px-3 py-2 text-[11px] font-semibold leading-5 text-emerald-900">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[9px] font-semibold text-white">{index + 1}</span>
              {item}
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] font-semibold leading-5 text-text-muted">
          物流、目录、售后、报价、折扣、付款、交期和合同均不会自动发送；没有真实业务数据或语境不明确时会降级。
        </p>
      </div>
    </section>
  );
}

interface HandoffProps {
  handoffRules: HandoffRules;
  handoffKeywordInput: string;
  setHandoffKeywordInput: Dispatch<SetStateAction<string>>;
  addHandoffKeyword: () => void;
  removeHandoffKeyword: (keyword: string) => void;
  setMissStreakToDraft: (value: 1 | 2 | 3) => void;
  setNegativeSentiment: (value: boolean) => void;
}

export function EnterpriseHandoffSafetySection({
  handoffRules, handoffKeywordInput, setHandoffKeywordInput, addHandoffKeyword,
  removeHandoffKeyword, setMissStreakToDraft, setNegativeSentiment,
}: HandoffProps) {
  return (
    <section className="py-5">
      <div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-amber-950">转人工规则</p>
            <p className="mt-1 text-[11px] font-semibold leading-5 text-amber-800">触发后，灵小枢会停下自动回复，交给你处理。</p>
          </div>
          <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-red-700 ">L4 永不自动</span>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <p className="mb-2 text-xs font-semibold text-amber-950">触发人工的关键词</p>
            <div className="flex flex-wrap gap-2">
              {(handoffRules.keywords).map(keyword => (
                <button
                  key={keyword}
                  type="button"
                  onClick={() => removeHandoffKeyword(keyword)}
                  className="rounded-full border border-amber-200 bg-white px-2.5 py-1 text-[11px] font-bold text-amber-900 hover:bg-amber-100"
                  title="点击删除"
                >
                  {keyword} ×
                </button>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                className="min-w-0 flex-1 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs outline-none focus:border-amber-400"
                value={handoffKeywordInput}
                onChange={event => setHandoffKeywordInput(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addHandoffKeyword();
                  }
                }}
                placeholder="输入关键词，如 refund / 老板"
              />
              <button type="button" onClick={addHandoffKeyword} className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700">
                添加
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="rounded-lg border border-amber-100 bg-white p-3">
              <span className="text-xs font-semibold text-amber-950">连续未命中阈值</span>
              <select
                className="mt-2 w-full rounded-lg border border-border bg-white px-2 py-2 text-xs font-bold text-text-primary"
                value={handoffRules.missStreakToDraft}
                onChange={event => setMissStreakToDraft(Number(event.target.value) as 1 | 2 | 3)}
              >
                <option value={1}>1 条就转草稿</option>
                <option value={2}>2 条连续未命中</option>
                <option value={3}>3 条连续未命中</option>
              </select>
            </label>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-amber-100 bg-white p-3">
              <span>
                <span className="block text-xs font-semibold text-amber-950">负面情绪转人工</span>
                <span className="mt-1 block text-[11px] text-amber-700">投诉、退款、愤怒语气会提醒你亲自处理</span>
              </span>
              <input
                type="checkbox"
                className="h-4 w-4 accent-amber-600"
                checked={handoffRules.negativeSentiment !== false}
                onChange={event => setNegativeSentiment(event.target.checked)}
              />
            </label>
          </div>
          <p className="rounded-lg bg-red-50 px-3 py-2 text-[11px] font-semibold leading-5 text-red-700">
            红线声明：报价、折扣、付款条款、交期承诺、合同条款、赔付等 L4 动作永不自动发送，不可配置放开。
          </p>
        </div>
      </div>
    </section>
  );
}
