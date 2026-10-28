import { useState, type ReactNode } from 'react';
import { ArrowRight, Check, Copy } from 'lucide-react';
import { Collapse } from 'antd';
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { AgentType } from '../App';
import { CHART_CURSOR_STYLE, CHART_TOOLTIP_STYLE } from '../lib/uiStyles';
import { chartPalette } from './ui/LsDataChart';
import { readableAssistantReply, splitAssistantReply } from '../../shared/assistantReadableReply';
import { extractAssistantFiles } from '../../shared/assistantFileIntent';
import AssistantFileCard from './assistant/AssistantFileCard';
import AssistantSourceLink from './assistant/AssistantSourceLink';
import { SocialInsightReportBlock } from './assistant/SocialInsightReportView';
import { IndustryInsightReportView } from './assistant/IndustryInsightReportView';
import type { ReplySource } from '../lib/assistantSourceLinks';
import { hasUsableReplySource } from './assistant/AssistantSearchFailure';
import { readAssistantMarkdownTable } from '../../shared/assistantMarkdownTable';
import { assistantDraftSuggestion } from '../../shared/assistantDraftSuggestion';
import { reportPresentationLine } from '../../shared/reportPresentation';
import {
  ASSISTANT_REPLY_PRESENTATIONS,
  type AssistantReplyPresentationKind,
} from '../../shared/assistantReplyPresentation';

/* 渲染灵小枢回复的轻量 Markdown：
   ## / ### 分级加粗标题，**加粗**强调结论，- / 1. 列表，[文字](链接) 可点跳转。
   支持 Markdown 表格、引用/话术块、代码块复制。
   旧回复的派发文本只作建议展示；执行入口由真实任务组件提供。 */

// 兼容历史派发建议，不把模型文本变成执行授权。
const ACTION_RE = /^建议触发\s*[【[]?\s*(流量专家|我的社媒|转化专家|留存专家|我的客户|策略专家|首页)\s*[】\]]?\s*执行[:：]\s*(.+)/;
// 引用块里的"提示/说明/备注"类内容：是说给用户听的话，不是可复制话术
const NOTE_QUOTE_RE = /^(?:💡|⚠️?|📌|ℹ️?|❗|✅|🔔|🧭|🔍|📣|🚨|注意|提示|提醒|说明|备注|注[:：]|小贴士|温馨提示|总结|小结|TL;?DR|Tips?\b)/i;

/* 链接保险丝：模型偶尔会编造不存在的 URL（如假的下载地址）。
   正文里只有联网检索真实返回的来源域名（含 grounding 跳转域）才渲染成可点击链接，
   其余 markdown 链接一律降级为纯文本，避免用户点到死链。
   copy 块 / 引用重点块本身按纯文本渲染，不受影响。 */
function cleanLooseMarkdown(text: string): string {
  let out = text.replace(/<br\s*\/?>/gi, '\n');
  const boldMarks = (out.match(/\*\*/g) ?? []).length;
  if (boldMarks % 2 !== 0) out = out.replace(/\*\*/g, '');
  out = out
    .replace(/^\s*#{1,6}\s*$/, '')
    .replace(/^\s*#{4,6}\s*(\d+[.、)])\s*/, '$1 ')
    .replace(/\s*#{3,6}\s*$/g, '')
    .replace(/\*\*(\s|$)/g, '$1')
    .replace(/(^|\s)\*\*/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return out;
}

function renderInline(text: string, kb: string, sources?: ReplySource[]): ReactNode[] {
  const safeText = cleanLooseMarkdown(text);
  const nodes: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<>()、，；。！？]+)/g;
  let last = 0, idx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(safeText)) !== null) {
    if (m.index > last) nodes.push(cleanLooseMarkdown(safeText.slice(last, m.index)));
    if (m[1] !== undefined) {
      nodes.push(<strong key={`${kb}b${idx}`} className="font-bold text-text-primary">{cleanLooseMarkdown(m[1])}</strong>);
    } else {
      const url = m[3] || m[4].replace(/[.,;!?]+$/, '');
      nodes.push(<AssistantSourceLink key={`${kb}l${idx}`} url={url} label={m[2]} sources={sources} />);
      if (m[4] && m[4].length > url.length) nodes.push(m[4].slice(url.length));
    }
    last = re.lastIndex; idx++;
  }
  if (last < safeText.length) nodes.push(cleanLooseMarkdown(safeText.slice(last)));
  return nodes;
}

function CopyButton({ text, label = '复制' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button type="button" onClick={copy}
      className="inline-flex items-center gap-1 rounded-md border border-border bg-white/80 px-2 py-1 text-[10px] font-semibold text-text-muted hover:text-text-primary transition-colors">
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? '已复制' : label}
    </button>
  );
}

/* ```chart 块：模型输出严格 JSON，渲染成对话内迷你图表。
   数据不完整（流式中）或解析失败时显示占位，不渲染残缺图。 */
type ChartSpec = {
  type?: string;
  title?: string;
  unit?: string;
  conclusion?: string;
  data?: { label?: string; value?: number }[];
};

function MiniChart({ raw }: { raw: string }) {
  let spec: ChartSpec | null = null;
  try { spec = JSON.parse(raw) as ChartSpec; } catch { spec = null; }
  const data = (spec?.data ?? [])
    .filter((d): d is { label: string; value: number } => typeof d?.value === 'number' && Number.isFinite(d.value) && !!d?.label && !!reportPresentationLine(d.label))
    .slice(0, 12);
  if (spec?.data?.some(item => item.label && !reportPresentationLine(item.label)) && data.length < 2) return null;
  if (!spec || data.length < 2) {
    return <div className="my-2 rounded-xl border border-dashed border-border bg-surface px-3 py-2.5 text-xs text-text-muted">图表数据生成中…</div>;
  }
  const isLine = spec.type === 'line';
  const axisTick = { fontSize: 10, fill: 'var(--color-text-muted, #71717a)' };
  return (
    <div className="my-2 rounded-xl border border-border bg-white/75 px-3 pb-1 pt-2.5">
      {spec.title && reportPresentationLine(spec.title) && (
        <p className="mb-1 text-xs font-bold text-text-primary">
          {spec.title}
          {spec.unit ? <span className="ml-1 font-normal text-text-muted">（{spec.unit}）</span> : null}
        </p>
      )}
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          {isLine ? (
            <LineChart data={data} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
              <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} />
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} cursor={CHART_CURSOR_STYLE} />
              <Line type="monotone" dataKey="value" stroke={chartPalette[0]} strokeWidth={2} dot={{ r: 2.5 }} />
            </LineChart>
          ) : (
            <BarChart data={data} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
              <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} interval={0} />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} />
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} cursor={CHART_CURSOR_STYLE} />
              <Bar dataKey="value" fill={chartPalette[0]} radius={[5, 5, 0, 0]} maxBarSize={26} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      {spec.conclusion && reportPresentationLine(spec.conclusion) && <p className="mb-1.5 mt-1 text-xs leading-relaxed text-text-secondary">{spec.conclusion}</p>}
    </div>
  );
}

function CopyBlock({ text, title, tone = 'neutral' }: { text: string; title?: string; tone?: 'neutral' | 'quote' }) {
  return (
    <div className={`my-2 overflow-hidden rounded-xl border ${tone === 'quote' ? 'border-accent/20 bg-accent-glow' : 'border-border bg-white/75'}`}>
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-1.5">
        <span className="text-[10px] font-semibold text-text-muted">{title || '可复制内容'}</span>
        <CopyButton text={text} />
      </div>
      <div className="whitespace-pre-wrap break-words px-3 py-2.5 text-sm leading-relaxed text-text-primary">{cleanLooseMarkdown(text)}</div>
    </div>
  );
}

export function splitReplySourceFooter(content: string): { body: string; footer: string } {
  const lines = content.split('\n');
  let fence = '', boundary = -1;
  for (let index = 0; index < lines.length; index++) {
    const marker = lines[index].match(/^\s*(`{3,}|~{3,})(.*)$/u);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = '';
      continue;
    }
    if (!fence && /^\s*信息来源(?:（查询时间：[^\n]+）[：:]|[：:]本轮|[：:]检索服务)/u.test(lines[index])) boundary = index;
  }
  if (boundary < 0 || lines.slice(boundary + 1).some(line => /总体结论[：:]/u.test(line))) return { body: content, footer: '' };
  return { body: lines.slice(0, boundary).join('\n').trimEnd(), footer: lines.slice(boundary).join('\n') };
}

type ReplyNavigation = { label: string; page: string; view?: string };

/** Project prose only; structured report payloads and code remain intact. */
export function visibleReplyMarkdown(content: string): string {
  let fence = '';
  return content.split('\n').map(line => {
    const marker = line.match(/^\s*(`{3,}|~{3,})(.*)$/u);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = '';
      return line;
    }
    return fence ? line : reportPresentationLine(line);
  }).join('\n');
}

const REPLY_NAVIGATION: Partial<Record<AssistantReplyPresentationKind, ReplyNavigation[]>> = {
  analytics: [{ label: '打开经营总览', page: 'digitalEmployees' }],
  inspiration: [{ label: '打开灵感集市', page: 'inspirationMarket' }],
  content: [{ label: '打开内容制作', page: 'smartAssets' }],
  publishing: [
    { label: '查看发布与渠道', page: 'traffic' },
    { label: '查看内容监控', page: 'socialMonitoring' },
  ],
  ads: [
    { label: '打开计划管理', page: 'adsPlans' },
    { label: '查看素材表现', page: 'adsCreatives' },
  ],
  customer: [{ label: '打开智能客服', page: 'conversion' }],
  enterprise: [
    { label: '打开企业知识库', page: 'enterprise' },
    { label: '检查渠道连接', page: 'channels' },
  ],
};

function ReplyNavigationLinks({ kind }: { kind: AssistantReplyPresentationKind }) {
  const links = REPLY_NAVIGATION[kind] ?? [];
  if (!links.length) return null;
  return <nav className="my-2 flex flex-wrap gap-2" aria-label="相关工作区">
    {links.map(link => <button key={`${link.page}:${link.view || ''}`} type="button"
      onClick={() => window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: link }))}
      className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-accent/40 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
      {link.label}<ArrowRight size={12} aria-hidden="true"/>
    </button>)}
  </nav>;
}

export default function AgentReply({ content, sources, onSuggest, detailExpanded = false, allowDetails = true, allowSources = true, compact = false, presentation }: {
  content: string;
  sources?: { title: string; uri: string }[];
  onAction?: (agent: AgentType, task: string) => void;
  onSuggest?: (text: string) => void;
  detailExpanded?: boolean;
  allowDetails?: boolean;
  allowSources?: boolean;
  compact?: boolean;
  presentation?: AssistantReplyPresentationKind;
}) {
  const inline = (text: string, key: string) => renderInline(text, key, sources);
  const files = extractAssistantFiles(content);
  const sourcePresentation = allowSources ? splitReplySourceFooter(files.text) : { body: files.text, footer: '' };
  const readableBody = visibleReplyMarkdown(readableAssistantReply(sourcePresentation.body));
  const replyParts = allowDetails ? splitAssistantReply(readableBody, { compact: compact && !presentation, presentation }) : { summary: readableBody, details: [] };
  const lines = replyParts.summary.split('\n');
  const blocks: ReactNode[] = [];
  let list: { type: 'ul' | 'ol'; items: string[] } | null = null;

  const quickReplyCards = (items: string[], key: string) => (
    <div key={key} className="my-2 grid gap-2" role="group" aria-label="快捷回复">
      {items.map((item, index) => {
        const suggestion = assistantDraftSuggestion(item, readableBody);
        return (
          <button
            key={`${key}_${index}`}
            type="button"
            onClick={() => onSuggest?.(suggestion.draft)}
            aria-label={`${suggestion.label}，填入输入框`}
            className="group flex w-full items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2.5 text-left text-sm leading-5 text-text-primary hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="min-w-0"><span className="block">{suggestion.label}</span><span className="mt-0.5 block text-[11px] leading-4 text-text-muted">填入输入框，可修改后发送</span></span>
            <ArrowRight size={14} className="shrink-0 text-accent transition-transform group-hover:translate-x-0.5" />
          </button>
        );
      })}
    </div>
  );

  const flush = () => {
    if (!list) return;
    const { type, items } = list;
    blocks.push(
      type === 'ol'
        ? <ol key={`l${blocks.length}`} className="list-decimal pl-5 space-y-1 my-1.5">{items.map((it, i) => <li key={i} className="leading-relaxed">{inline(it, `o${blocks.length}_${i}`)}</li>)}</ol>
        : <ul key={`l${blocks.length}`} className="list-disc pl-5 space-y-1 my-1.5">{items.map((it, i) => <li key={i} className="leading-relaxed">{inline(it, `u${blocks.length}_${i}`)}</li>)}</ul>,
    );
    list = null;
  };

  const actionButton = (line: string, key: string) => {
    const cleaned = line.replace(/^\s*(?:[-*•·]|\d+[.、)])\s*/, '').replace(/\*\*/g, '').trim();
    const act = cleaned.match(ACTION_RE);
    if (!act) return null;
    const task = act[2].trim();
    return (
      <p key={key} className="leading-relaxed my-1">可在对应工作区处理：{inline(task, key)}</p>
    );
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { flush(); continue; }
    if (/^\s*#{1,6}\s*$/.test(line)) { flush(); continue; }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); blocks.push(<hr key={`hr_${i}`} className="my-2 border-border" />); continue; }

    const fence = line.match(/^```([\w-]*)\s*$/);
    if (fence) {
      flush();
      const lang = fence[1] || 'text';
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      if (lang === 'industry-insight') {
        blocks.push(<IndustryInsightReportView key={`industry_${i}`} raw={body.join('\n').trim()} sources={sources} />);
      } else if (lang === 'social-insight') {
        blocks.push(<SocialInsightReportBlock key={`social_${i}`} raw={body.join('\n').trim()} />);
      } else if (lang === 'chart') {
        blocks.push(<MiniChart key={`chart_${i}`} raw={body.join('\n').trim()} />);
      } else if (lang === 'next') {
        const items = body.map(l => l.replace(/^\s*(?:[-*•·]|\d+[.、)])\s*/, '').trim()).filter(item => item && reportPresentationLine(item)).slice(0, 2);
        if (onSuggest && items.length) {
          blocks.push(quickReplyCards(items, `next_${i}`));
        }
      } else {
        // 语言标记缺失或是 text/markdown 这类"无信息"标记时，用中文兜底标题，不把 "text" 当标题展示
        const title = lang === 'copy' ? '话术 / 文案' : /^(?:text|txt|plaintext|markdown|md)$/i.test(lang) ? '可复制内容' : lang;
        const displayed = /^(?:copy|text|txt|plaintext|markdown|md)$/i.test(lang) ? body.map(reportPresentationLine).filter(value => value.trim()).join('\n').trim() : body.join('\n').trim();
        if (displayed) blocks.push(<CopyBlock key={`code_${i}`} title={title} text={displayed} />);
      }
      continue;
    }

    if (/^\s*>/.test(line)) {
      flush();
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      i--;
      const quoteText = body.join('\n').trim();
      if (NOTE_QUOTE_RE.test(quoteText)) {
        blocks.push(
          <div key={`note_${i}`} className="my-2 whitespace-pre-wrap break-words rounded-xl border-l-[3px] border-accent/50 bg-surface px-3 py-2.5 text-sm leading-relaxed text-text-secondary">
            {inline(quoteText, `note_${i}`)}
          </div>,
        );
      } else {
        blocks.push(<CopyBlock key={`quote_${i}`} title="重点内容" text={quoteText} tone="quote" />);
      }
      continue;
    }

    const table = readAssistantMarkdownTable(lines,i);
    if (table) {
      flush();
      const { header, rows } = table;
      i = table.end - 1;
      // TSV：粘贴到 Excel / 飞书表格即还原成表
      const tsv = [header, ...rows].map(r => r.map(cell => cleanLooseMarkdown(cell)).join('\t')).join('\n');
      blocks.push(
        <div key={`tablewrap_${i}`} className="my-2 overflow-hidden rounded-xl border border-border bg-white/70">
          <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-1.5">
            <span className="text-[10px] font-semibold text-text-muted">表格 · 可粘贴到 Excel</span>
            <CopyButton text={tsv} label="复制表格" />
          </div>
          <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-xs">
            <thead className="bg-surface">
              <tr>{header.map((cell, idx) => <th key={idx} className="border-b border-border px-3 py-2 font-semibold text-text-primary whitespace-nowrap">{inline(cell, `th_${i}_${idx}`)}</th>)}</tr>
            </thead>
            <tbody>
              {!rows.length && <tr><td colSpan={header.length} className="px-3 py-2 text-text-muted">表格内容整理中…</td></tr>}
              {rows.map((row, rIdx) => (
                <tr key={rIdx} className="border-t border-border/70 align-top">
                  {header.map((_, cIdx) => <td key={cIdx} className="px-3 py-2 text-text-secondary leading-relaxed min-w-24">{inline(row[cIdx] ?? '', `td_${i}_${rIdx}_${cIdx}`)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>,
      );
      continue;
    }

    // 历史派发文本降级为普通工作区建议，不生成执行按钮。
    const action = actionButton(line, `act_${i}`);
    if (action) {
      flush();
      blocks.push(action);
      continue;
    }
    // 单个 # 必须跟空格才算标题，避免行首 hashtag（#tiktokfinds #夏季新品）被渲染成大标题
    const heading = line.match(/^(?:#{2,6}\s*|#\s+)(.+)/);
    const h3 = line.match(/^###\s+(.*)/);
    const h2 = line.match(/^##\s+(.*)/);
    const ol = line.match(/^\s*\d+[.、)]\s+(.*)/);
    const ul = line.match(/^\s*[-*•·]\s+(.*)/);
    if (heading) {
      flush();
      const level = (line.match(/^#+/)?.[0].length ?? 2) <= 2 ? 'text-base mt-3.5 mb-1.5' : 'text-sm mt-3 mb-1';
      blocks.push(<p key={i} className={`${level} font-bold text-text-primary`}>{inline(heading[1], `hx_${i}`)}</p>);
      continue;
    }
    if (h3) { flush(); blocks.push(<p key={i} className="text-sm font-bold text-text-primary mt-3 mb-1">{inline(h3[1], `h3_${i}`)}</p>); continue; }
    if (h2) { flush(); blocks.push(<p key={i} className="text-base font-bold text-text-primary mt-3.5 mb-1.5">{inline(h2[1], `h2_${i}`)}</p>); continue; }
    if (ol) { if (list?.type !== 'ol') { flush(); list = { type: 'ol', items: [] }; } list.items.push(cleanLooseMarkdown(ol[1])); continue; }
    if (ul) { if (list?.type !== 'ul') { flush(); list = { type: 'ul', items: [] }; } list.items.push(cleanLooseMarkdown(ul[1])); continue; }
    flush();
    const cleanedLine = cleanLooseMarkdown(line);
    if (cleanedLine) {
      blocks.push(<p key={i} className="leading-relaxed my-1 whitespace-pre-wrap">{inline(cleanedLine, `p_${i}`)}</p>);
    }
  }
  flush();

  const presentationMeta = presentation ? ASSISTANT_REPLY_PRESENTATIONS[presentation] : undefined;
  const visibleSources = allowSources && presentationMeta?.showSources && hasUsableReplySource(sources);
  const sourceLinks = sources?.slice(0, 3) ?? [];
  const remainingSources = sources?.slice(3) ?? [];

  return (
    <div data-agent-reply="true" data-reply-presentation={presentation} className="text-sm text-text-primary [&>*:first-child]:mt-0">
      {blocks}
      {visibleSources ? <aside className="my-2 rounded-lg border border-border/80 bg-surface px-3 py-2" aria-label="已核验来源">
        <p className="mb-1.5 text-[11px] font-semibold text-text-muted">已核验来源{sources?.length ? ` · ${sources.length}` : ''}</p>
        {sourceLinks.length ? <div className="flex flex-wrap gap-x-3 gap-y-1">
          {sourceLinks.map((source, index) => <AssistantSourceLink key={source.uri} url={source.uri} label={source.title || `来源 ${index + 1}`} sources={sources}/>) }
        </div> : <AgentReply content={sourcePresentation.footer} sources={sources} allowDetails={false} allowSources={false}/>}
        {remainingSources.length ? <Collapse ghost size="small" items={[{ key: 'more-sources', label: `其余 ${remainingSources.length} 个来源`, children: <div className="flex flex-col gap-1">{remainingSources.map((source, index) => <AssistantSourceLink key={source.uri} url={source.uri} label={`${index + 4}. ${source.title}`} sources={sources}/>)}</div> }]} /> : null}
      </aside> : null}
      {presentation ? <ReplyNavigationLinks kind={presentation}/> : null}
      {replyParts.details.some(value => value.trim()) && <Collapse ghost size="small" className="mt-1" defaultActiveKey={detailExpanded || !replyParts.summary.trim() ? ['analysis'] : []} items={[{
        key: 'analysis', label: presentationMeta?.detailLabel || '补充依据与更多方案', children: <AgentReply content={replyParts.details.join('\n\n')} sources={sources} allowDetails={false} allowSources={false} />,
      }]} />}
      {files.ids.map(id => <AssistantFileCard key={id} id={id} />)}
      {allowSources && !visibleSources && (sourcePresentation.footer || sources?.length) ? (
        <Collapse ghost size="small" className="mt-2 text-text-muted" defaultActiveKey={[]} items={[{
          key: 'sources', label: '数据和信息来源', children: sourcePresentation.footer
            ? <AgentReply content={sourcePresentation.footer} sources={sources} allowDetails={false} allowSources={false} />
            : <div className="flex flex-col gap-0.5">
            {sources?.map((s, i) => (
              <AssistantSourceLink key={i} url={s.uri} label={`${i + 1}. ${s.title}`} sources={sources} />
            ))}
          </div>,
        }]} />
      ) : null}
    </div>
  );
}
