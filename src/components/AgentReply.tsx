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
let trustedLinkHosts = new Set<string>(['vertexaisearch.cloud.google.com']);

function setTrustedLinkHosts(sources?: { uri: string }[]) {
  trustedLinkHosts = new Set(['vertexaisearch.cloud.google.com']);
  for (const s of sources ?? []) {
    try { trustedLinkHosts.add(new URL(s.uri).host); } catch { /* ignore */ }
  }
}

function isTrustedUrl(url: string): boolean {
  try { return trustedLinkHosts.has(new URL(url).host); } catch { return false; }
}

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

function inline(text: string, kb: string): ReactNode[] {
  const safeText = cleanLooseMarkdown(text);
  const nodes: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let last = 0, idx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(safeText)) !== null) {
    if (m.index > last) nodes.push(cleanLooseMarkdown(safeText.slice(last, m.index)));
    if (m[1] !== undefined) {
      nodes.push(<strong key={`${kb}b${idx}`} className="font-bold text-text-primary">{cleanLooseMarkdown(m[1])}</strong>);
    } else if (isTrustedUrl(m[3])) {
      nodes.push(
        <a key={`${kb}l${idx}`} href={m[3]} target="_blank" rel="noopener noreferrer"
          className="text-accent underline underline-offset-2 hover:opacity-80 break-all">{m[2]}</a>,
      );
    } else {
      nodes.push(cleanLooseMarkdown(m[2]));
    }
    last = re.lastIndex; idx++;
  }
  if (last < safeText.length) nodes.push(cleanLooseMarkdown(safeText.slice(last)));
  return nodes;
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim().replace(/<br\s*\/?>/gi, '；'));
}

function isTableLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith('|') && t.endsWith('|') && t.includes('|');
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
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
    .filter((d): d is { label: string; value: number } => typeof d?.value === 'number' && Number.isFinite(d.value) && !!d?.label)
    .slice(0, 12);
  if (!spec || data.length < 2) {
    return <div className="my-2 rounded-xl border border-dashed border-border bg-surface px-3 py-2.5 text-xs text-text-muted">图表数据生成中…</div>;
  }
  const isLine = spec.type === 'line';
  const axisTick = { fontSize: 10, fill: 'var(--color-text-muted, #71717a)' };
  return (
    <div className="my-2 rounded-xl border border-border bg-white/75 px-3 pb-1 pt-2.5">
      {spec.title && (
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
      {spec.conclusion && <p className="mb-1.5 mt-1 text-xs leading-relaxed text-text-secondary">{spec.conclusion}</p>}
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

export default function AgentReply({ content, sources, onSuggest, detailExpanded = false, allowDetails = true, allowSources = true }: {
  content: string;
  sources?: { title: string; uri: string }[];
  onAction?: (agent: AgentType, task: string) => void;
  onSuggest?: (text: string) => void;
  detailExpanded?: boolean;
  allowDetails?: boolean;
  allowSources?: boolean;
}) {
  setTrustedLinkHosts(sources);
  const files = extractAssistantFiles(content);
  const sourcePresentation = allowSources ? splitReplySourceFooter(files.text) : { body: files.text, footer: '' };
  const presentation = allowDetails ? splitAssistantReply(sourcePresentation.body) : { summary: sourcePresentation.body, details: [] };
  const lines = readableAssistantReply(presentation.summary).split('\n');
  const blocks: ReactNode[] = [];
  let list: { type: 'ul' | 'ol'; items: string[] } | null = null;

  const quickReplyCards = (items: string[], key: string) => (
    <div key={key} className="my-2 grid gap-2" role="group" aria-label="快捷回复">
      {items.map((item, index) => (
        <button
          key={`${key}_${index}`}
          type="button"
          onClick={() => onSuggest?.(item)}
          className="group flex w-full items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2.5 text-left text-sm leading-5 text-text-primary hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span>{cleanLooseMarkdown(item)}</span>
          <ArrowRight size={14} className="shrink-0 text-accent transition-transform group-hover:translate-x-0.5" />
        </button>
      ))}
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
      if (lang === 'chart') {
        blocks.push(<MiniChart key={`chart_${i}`} raw={body.join('\n').trim()} />);
      } else if (lang === 'next') {
        const items = body.map(l => l.replace(/^\s*(?:[-*•·]|\d+[.、)])\s*/, '').trim()).filter(Boolean).slice(0, 2);
        if (onSuggest && items.length) {
          blocks.push(quickReplyCards(items, `next_${i}`));
        }
      } else {
        // 语言标记缺失或是 text/markdown 这类"无信息"标记时，用中文兜底标题，不把 "text" 当标题展示
        const title = lang === 'copy' ? '话术 / 文案' : /^(?:text|txt|plaintext|markdown|md)$/i.test(lang) ? '可复制内容' : lang;
        blocks.push(<CopyBlock key={`code_${i}`} title={title} text={body.join('\n').trim()} />);
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

    if (isTableLine(line)) {
      flush();
      const tableLines: string[] = [];
      while (i < lines.length && isTableLine(lines[i])) {
        tableLines.push(lines[i]);
        i++;
      }
      i--;
      const hasSeparator = tableLines.length > 1 && isTableSeparator(tableLines[1]);
      const header = splitTableRow(tableLines[0]);
      const rows = tableLines.slice(hasSeparator ? 2 : 1).map(splitTableRow);
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

  return (
    <div data-agent-reply="true" className="text-sm text-text-primary [&>*:first-child]:mt-0">
      {blocks}
      {presentation.details.some(value => value.trim()) && <Collapse ghost size="small" defaultActiveKey={detailExpanded || !presentation.summary.trim() ? ['analysis'] : []} items={[{
        key: 'analysis', label: '详细分析', children: <AgentReply content={presentation.details.join('\n\n')} allowDetails={false} />,
      }]} />}
      {files.ids.map(id => <AssistantFileCard key={id} id={id} />)}
      {allowSources && (sourcePresentation.footer || sources?.length) ? (
        <Collapse ghost size="small" className="mt-2 text-text-muted" defaultActiveKey={[]} items={[{
          key: 'sources', label: '数据和信息来源', children: sourcePresentation.footer
            ? <AgentReply content={sourcePresentation.footer} sources={sources} allowDetails={false} allowSources={false} />
            : <div className="flex flex-col gap-0.5">
            {sources?.map((s, i) => (
              <a key={i} href={s.uri} target="_blank" rel="noopener noreferrer"
                className="text-[11px] text-accent hover:underline truncate">
                {i + 1}. {s.title}
              </a>
            ))}
          </div>,
        }]} />
      ) : null}
    </div>
  );
}
