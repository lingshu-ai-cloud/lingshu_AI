import { type Dispatch, type SetStateAction } from 'react';
import { Input } from 'antd';
import { BookOpen, Loader2, Plus, X, Zap } from 'lucide-react';
import type { FaqItem, FaqPack, Profile } from './enterpriseProfileTypes';
import { KnowledgeCard, PaginationControls, Toggle } from './EnterpriseFormControls';

const textareaCls = 'w-full resize-y';

interface Props {
  profile: Profile;
  completed: boolean;
  approvedFaqCount: number;
  faqPacks: FaqPack[];
  recommendedPackIndustry: string;
  faqPacksOpen: boolean;
  setFaqPacksOpen: Dispatch<SetStateAction<boolean>>;
  openPackId: string;
  setOpenPackId: Dispatch<SetStateAction<string>>;
  selectedQuestionsForPack: (pack: FaqPack) => string[];
  togglePackQuestion: (pack: FaqPack, question: string) => void;
  importFaqPack: (pack: FaqPack) => Promise<void>;
  packImporting: string;
  structureLegacyFaq: () => Promise<void>;
  faqStructuring: boolean;
  faqPreview: FaqItem[];
  importFaqPreview: () => void;
  setFaqPreview: Dispatch<SetStateAction<FaqItem[]>>;
  addFaq: () => void;
  visibleFaqs: FaqItem[];
  updateFaq: (id: string, patch: Partial<FaqItem>) => void;
  removeFaq: (id: string) => void;
  faqPage: number;
  faqItems: FaqItem[];
  pageSize: number;
  setFaqPage: Dispatch<SetStateAction<number>>;
}

export default function EnterpriseFaqPanel({
  profile, completed, approvedFaqCount, faqPacks, recommendedPackIndustry,
  faqPacksOpen, setFaqPacksOpen, openPackId, setOpenPackId,
  selectedQuestionsForPack, togglePackQuestion, importFaqPack, packImporting,
  structureLegacyFaq, faqStructuring, faqPreview, importFaqPreview, setFaqPreview,
  addFaq, visibleFaqs, updateFaq, removeFaq, faqPage, faqItems, pageSize, setFaqPage,
}: Props) {
  return (
          <div data-enterprise-faq>
          <KnowledgeCard icon={BookOpen} title="常见问答" purpose="从真实客户问题中逐步沉淀标准答案；是否自动发送由客服授权单独决定" completed={completed} stat={`${profile.faq?.length ?? 0} 条 · ${approvedFaqCount} 条已审批`}>
            {faqPacks.length > 0 && (
              <div data-lingshu-guide="enterprise-faq-pack" className="mb-4 rounded-lg border border-border bg-surface-2/40 p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold text-text-primary">场景知识包</p>
                  <button type="button" onClick={() => setFaqPacksOpen(open => !open)} className="rounded-lg border border-border bg-white px-3 py-2 text-[11px] font-bold text-text-secondary hover:bg-surface-2">
                    {faqPacksOpen ? '收起知识包' : `打开知识包（推荐${faqPacks.find(pack => pack.industry === recommendedPackIndustry)?.industryLabel || '通用'}）`}
                  </button>
                </div>
                {faqPacksOpen && (
                <div className="grid gap-3 md:grid-cols-2">
                  {[...faqPacks].sort((a, b) => Number(b.industry === recommendedPackIndustry) - Number(a.industry === recommendedPackIndustry)).map(pack => {
                    const open = openPackId === pack.id;
                    const selected = selectedQuestionsForPack(pack);
                    const readyCount = pack.items.filter(item => item.ready && !item.exists).length;
                    return (
                      <div key={pack.id} className={`rounded-lg border bg-white p-3 ${open ? 'border-sky-200 ring-2 ring-sky-50' : 'border-border'}`}>
                        <button type="button" onClick={() => setOpenPackId(open ? '' : pack.id)} className="flex w-full items-start justify-between gap-3 text-left">
                          <div>
                            <p className="text-xs font-semibold text-text-primary">{pack.industryLabel} · {pack.scenarioLabel}</p>
                            <p className="mt-1 text-[11px] text-text-muted">{pack.count} 条 · 可导入 {readyCount} 条</p>
                          </div>
                          <span className="rounded-full bg-surface-2 px-2 py-1 text-[10px] font-bold text-text-secondary">{open ? '收起' : '预览'}</span>
                        </button>
                        {!open && (
                          <div className="mt-3 space-y-1.5">
                            {pack.preview.map(item => <p key={item.q} className="truncate text-[11px] text-text-secondary">Q：{item.q}</p>)}
                            <button type="button" onClick={() => setOpenPackId(pack.id)} className="mt-2 rounded-lg border border-border bg-white px-3 py-1.5 text-[11px] font-bold text-text-secondary hover:bg-surface-2">一键添加</button>
                          </div>
                        )}
                        {open && (
                          <div className="mt-3 border-t border-border pt-3">
                            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                              {pack.items.map(item => {
                                const disabled = !item.ready || item.exists;
                                const checked = selected.includes(item.q) && !disabled;
                                return (
                                  <label key={item.q} className={`block rounded-lg border p-2 ${!item.ready ? 'border-amber-200 bg-amber-50' : item.exists ? 'border-slate-200 bg-slate-50 opacity-70' : 'border-border bg-white'}`}>
                                    <div className="flex items-start gap-2">
                                      <input type="checkbox" checked={checked} disabled={disabled} onChange={() => togglePackQuestion(pack, item.q)} className="mt-0.5" />
                                      <div className="min-w-0 flex-1">
                                        <p className="text-[11px] font-semibold text-text-primary">Q：{item.q}</p>
                                        <p className="mt-1 text-[11px] leading-5 text-text-secondary">A：{item.a}</p>
                                        {!item.ready && <p className="mt-1 text-[11px] font-bold text-amber-700">先完善报价规则板块：{item.missingVars.join('、')}</p>}
                                        {item.exists && <p className="mt-1 text-[11px] font-bold text-slate-500">已存在，重复导入会跳过</p>}
                                      </div>
                                    </div>
                                  </label>
                                );
                              })}
                            </div>
                            <div className="mt-3 flex items-center justify-between gap-2">
                              <p className="text-[11px] text-text-muted">已选 {selected.filter(q => pack.items.some(item => item.q === q && item.ready && !item.exists)).length} 条</p>
                              <button type="button" onClick={() => importFaqPack(pack)} disabled={packImporting === pack.id || selected.length === 0} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white disabled:opacity-60">
                                {packImporting === pack.id ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}确认导入
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                )}
              </div>
            )}
            {profile.customers?.commonQuestions?.trim() && !(profile.faq ?? []).length && (
              <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 p-3">
                <p className="text-xs font-bold text-sky-900">检测到旧版问答内容，让 AI 帮你整理成问答条目？</p>
                <button type="button" onClick={structureLegacyFaq} disabled={faqStructuring} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-60">
                  {faqStructuring ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}整理旧版内容
                </button>
              </div>
            )}
            {faqPreview.length > 0 && (
              <div className="mb-4 rounded-lg border border-border bg-surface-2 p-3">
                <p className="text-xs font-semibold text-text-primary">结构化预览</p>
                <div className="mt-2 space-y-2">
                  {faqPreview.map(item => <p key={item.id} className="text-xs text-text-secondary">Q：{item.question}<br />A：{item.answer}</p>)}
                </div>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={importFaqPreview} className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white">确认导入</button>
                  <button type="button" onClick={() => setFaqPreview([])} className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary">取消</button>
                </div>
              </div>
            )}
            <div className="mb-4 flex justify-between gap-3">
              <p className="text-xs text-text-muted">关闭自动回复时，AI 只写草稿等你确认。</p>
              <button type="button" onClick={addFaq} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white"><Plus size={12} />添加问答</button>
            </div>
            <div className="space-y-3">
              {visibleFaqs.map((item, index) => (
                <details key={item.id} className="rounded-lg border border-border bg-surface-2/50 p-3" open={index === 0}>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                    <Input className="w-full flex-1" value={item.question} onChange={e => updateFaq(item.id, { question: e.target.value })} placeholder="客户会怎么问？" />
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${item.source === 'pack' ? 'bg-sky-50 text-sky-700' : item.source === 'learned' ? 'bg-emerald-50 text-emerald-700' : 'bg-white text-text-muted'}`}>
                        {item.source === 'pack' ? '知识包' : item.source === 'learned' ? '学习' : '手动'}
                      </span>
                      <span className="text-[11px] text-text-muted">允许 AI 自动回复</span>
                      <Toggle checked={item.approvedForAuto} onChange={checked => updateFaq(item.id, { approvedForAuto: checked })} />
                      <button type="button" onClick={(event) => { event.preventDefault(); removeFaq(item.id); }} aria-label={`删除问答 ${item.question || index + 1}`} title="删除问答" className="rounded-md p-1 text-text-muted hover:text-red"><X size={13} /></button>
                    </div>
                  </summary>
                  <Input.TextArea className={`${textareaCls} mt-3`} rows={3} value={item.answer} onChange={e => updateFaq(item.id, { answer: e.target.value })} placeholder="标准答案" />
                </details>
              ))}
              {!(profile.faq ?? []).length && <p className="rounded-lg bg-surface-2 px-3 py-3 text-xs text-text-muted">还没有问答，先添加 5 条常见问题。</p>}
            </div>
            <PaginationControls page={faqPage} total={faqItems.length} pageSize={pageSize} onChange={setFaqPage} />
          </KnowledgeCard>
          </div>
  );
}
