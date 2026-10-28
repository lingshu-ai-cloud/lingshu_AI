import { hasAssistantMarkdownTable } from './assistantMarkdownTable.js';
import type { AssistantReplyPresentationKind } from './assistantReplyPresentation.js';

export const ASSISTANT_READABLE_POLICY = `【面向客户的表达规则】
像了解业务的同事自然交流，先回应用户真正关心的事，再解释到足够用户判断。不设三句话或固定条数限制，不机械套用“结论—原因—行动”标题。
按问题复杂度决定篇幅：状态查询直接回答；建议、比较、原因分析保留必要依据和取舍。默认一屏内读完，以短段落为主，不重复背景、空泛总结或强行追加建议。
普通交流正常说话，不强行生成卡片、图表、表格或快捷按钮。确有帮助时才可用next块，最多两个；每项必须是可直接编辑并发送的下一步草稿，不用“是否需要”“是否立即”等句式让用户再确认一轮，也不代表已获授权的执行动作。
有较长的补充分析时，先完整交代关键结果、判断依据和风险，再提供可选的详细依据和更多方案。费用、失败、风险、审批条件不得只藏在展开区。用户明确要求详细分析时完整回答，无需为了简短省略必要内容。文件正文与用户要求的交付内容不受聊天摘要篇幅约束。未声明支持交互块的客户端使用普通自然段，不输出界面控制标记。
禁止在面向用户的正文输出数据库集合名、内部字段名、记录ID、原始错误码、英文状态枚举、内部路径或JSON。来源核验留在服务端，不在正文使用[记录:集合/ID]。
把技术状态翻译成业务语言，例如采集失败、等待方案确认、缺少产品资料。不能隐藏失败、费用、风险、审批条件或把未执行说成已完成。
易懂不等于补编解释：不能把故障自行解释为主动暂停，不能擅自推荐跳过必需依赖。只依据服务端提供的实际能力提出操作建议；没有对应能力或执行回执时，不承诺“立刻重试”“继续生产”或“已经处理”。
保留关键数量、产品名称、必要的平台名称和明确行动；不堆砌术语。英文营销文案等用户明确需要的交付内容保留原语言，不把品牌名或TikTok等平台名称当成技术字段删除。`;

export const ASSISTANT_DETAILS_POLICY = '【网页交互格式】当前网页支持折叠分析。可选详细依据用独立的三反引号details块，结束时使用独立三反引号。块内仅使用自然段或列表，不嵌套代码块；图表与交付文案使用各自的正文专用块。正文须先交代足以判断的结果、理由和风险。无需补充时不要输出空块；普通聊天不使用copy块包装解释。';

export const ASSISTANT_QUICK_TASK_POLICY = `【快捷任务回复 · 必须遵守】
这是用户从快捷任务卡片发起的工作查询。目标是让用户快速看懂现状并作出判断，不写成长篇报告，也不把不同功能套进同一份固定模板。
- 先给本题最重要的结论或状态；随后只呈现影响判断的重点。可见正文通常控制在 250～500 个中文字符、3～6 个信息点内；场景需要更长时把逐项信息放 details。不复述用户问题、企业背景或分析过程。
- 标题、列表、短表格、图表和自然段按场景选用，不要求每轮都有相同标题或相同条数；同一回答内也不要把每项写成等长模板。
- 关键数字、异常、失败、风险、审批条件和建议动作始终留在可见正文。details 只放逐项明细、方法口径、补充证据或次要方案，不能承担正文续写。
- 缺少关键数据时只说明真正阻塞结论的缺口，并给一个可执行的补充动作；不要罗列所有未接入字段。
- 只写用户能理解和采取行动的业务信息。不得输出“产品20/P20”等内部序号、数据集合名、扫描记录数、记录 ID、英文状态枚举、原始供应商报错、HTTP 状态、像素总数或开发诊断；技术故障只说明用户影响和可采取的动作。
- 有已核验来源时，让来源靠近对应事实；不要只在末尾堆一长串链接。需要用户选择时一次只问 1 个关键问题。
- 可继续处理的动作使用 next 块，最多 2 个短选项；不要写“是否需要”“是否立即”等二次确认问题。缺资料时直接给“补录××信息”“补充××素材”等可编辑草稿入口，点击只填入输入框，仍由用户确认发送。用户明确要求的可复制话术、脚本或文案可完整放在 copy 块。`;

const TERMS: Record<string, string> = {
  scheduled_source_collection: '平台热点采集', workflow_tasks: '任务',
  plan_review: '等待方案确认', needs_input: '等待补充资料', waiting_human: '等待人工确认',
  waiting_external: '等待外部条件', asset_review: '等待素材确认',
  user_input_required: '需要补充资料', capability_mismatch: '当前生产条件不满足',
  product_scene_quality_failed: '素材质量不合格', product_identity_failed: '产品信息未匹配',
  source_failed: '采集失败', no_valid_results: '未采集到可用内容',
  unavailable: '暂未核验', available: '已读取', empty: '暂无记录', attention: '需要关注',
  failed: '失败', blocked: '已阻塞', complete: '已完成', completed: '已完成', success: '已完成', producing: '制作中', queued: '排队中',
  paused: '已暂停', delivered: '已交付', pending: '待处理', running: '执行中',
  weekly_goals: '本周目标', weekly_reviews: '周复盘', social_weekly_execution_tasks: '周执行任务',
  starter_social_content_tasks: '内容任务', starter_social_publications: '发布记录', starter_social_metric_submissions: '效果记录',
  social_accounts: '社媒账号', youtube_accounts: 'YouTube 账号', starter_quote_inquiries: '询盘记录',
  approval_requests: '审批记录', tenant_orders: '订单记录', posts: '发布内容', customers: '客户资料', ads: '投放任务',
  CTA: '行动引导', MOQ: '起订量', TTS: '配音', QA: '质量检查',
  cost_limit: '费用上限', budget_limit: '预算上限', requires_approval: '需要审批',
};

/** Display-only guard: raw evidence remains unchanged in storage and production commands. */
export function readableAssistantReply(content: string): string {
  const output: string[] = [];
  let fence: string | null = null;
  let keepFence = false;
  for (const raw of content.split('\n')) {
    const marker = raw.trim().match(/^```([\w-]*)\s*$/);
    if (marker) {
      if (fence !== null) { if (keepFence) output.push(raw); fence = null; keepFence = false; }
      else { fence = marker[1]; keepFence = ['copy', 'next', 'chart', 'details', 'social-insight', 'industry-insight'].includes(fence); if (keepFence) output.push(raw); }
      continue;
    }
    if (fence !== null) { if (keepFence) output.push(fence === 'next' || fence === 'details' ? readableAssistantReply(raw) : raw); continue; }
    const links: string[] = [];
    const protectedLine = raw.replace(/https?:\/\/[^\s)\]<>]+/gu, url => { links.push(url); return `\uE000${links.length - 1}\uE001`; });
    let line = protectedLine
      .replace(/\[\s*记录\s*[:：][^\]\n]*(?:\]|$)/gu, '')
      .replace(/\/api\/[A-Za-z0-9_/?=&.%:-]+/g, '')
      .replace(/(?:workflow_tasks|studio_projects|social_content_tasks|agent_runs)\/[A-Za-z0-9_./-]+/g, '')
      .replace(/\b[0-9a-f]{24,}\b/gi, '')
      .replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi, '')
      .replace(/[（(][^（）()\n]*(?:\b(?:weekly_goals|workflow_tasks|starter_social_[a-z0-9_]+|studio_projects|agent_runs)\b|\bID\s*[:：]|\bstate\s*[:：]|集合中|共扫描\s*\d+\s*条记录)[^（）()\n]*[）)]/giu, '')
      .replace(/[（(]\s*对应产品\s*\d+\s*[：:][^）)\n]+[）)]/gu, '')
      .replace(/[（(]\s*P\d+(?:\s*[/、]\s*P\d+)*\s*[）)]/giu, '')
      .replace(/(?<![A-Za-z0-9])P\d+(?:\s*[/、]\s*P\d+)+(?![A-Za-z0-9])/giu, '上述重点产品')
      .replace(/(?<![A-Za-z0-9])P\d+(?![A-Za-z0-9])/giu, '该产品')
      .replace(/产品\s*(?:编号\s*)?\d+(?!\s*(?:款|个|条|张|项))/gu, '该产品')
      .replace(/当前\s*\d+\s*款现货盘/gu, '当前产品目录')
      .replace(/\d+\s*款现货盘/gu, '产品目录')
      .replace(/共扫描\s*\d+\s*条记录/gu, '已核验相关记录')
      .replace(/扫描记录数为\s*0/gu, '暂无相关记录')
      .replace(/企业知识库无该SKU信息/giu, '企业资料中暂未找到该规格')
      .replace(/\bID\s*[:：]\s*[A-Za-z0-9_-]+/giu, '')
      .replace(/\bdoubao-seedance-[\w-]+(?:\s+not activated)?\b/giu, 'Seedance 视频能力尚未开通')
      .replace(/\bno formal assets uploaded\b/giu, '尚未上传可用于正式制作的素材')
      .replace(/\b404\s+model not activated\b/giu, '视频生成能力尚未开通')
      .replace(/\bimage size must be\s*(?:at least|≥?)\s*\d+\s*pixels\b/giu, '图片清晰度不足，请上传高清原图')
      .replace(/\b(?:fetch failed|connection error)\b/giu, '生成服务暂时无法连接')
      .replace(/技术链路中断/gu, '视频制作暂不可用');
    for (const [token, label] of Object.entries(TERMS)) {
      line = line.replace(new RegExp(`(?<![\\w])${token}(?![\\w])`, 'g'), label);
    }
    line = line.replace(/`([^`]+)`/g, '$1').replace(/`/g, '')
      .replace(/\bstate\s*[:：]\s*/giu, '')
      .replace(/^(\s*)依据[:：]/u, '$1原因：')
      .replace(/\bHTTP\s*[45]\d\d\b/gi, '服务请求失败')
      .replace(/\b(?:ECONNREFUSED|ETIMEDOUT|ENOTFOUND)\b/g, '服务连接失败')
      .replace(/(?:生成服务暂时无法连接[、，\s]*){2,}/gu, '生成服务暂时无法连接');
    // Unknown implementation identifiers are not meaningful customer explanations.
    const sentences = line.match(/[^。！？]+[。！？]?/gu) || [];
    const technical = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b|\b(?:taskId|runId|artifactId|expectedVersion|productId|contentHash)\b/gu;
    const clean = sentences.flatMap(sentence => {
      technical.lastIndex = 0;
      if (!technical.test(sentence)) return [sentence];
      if (/费用|预算|收费|失败|未完成|风险|审批|批准|授权|等待|尚未|不能|不可|必须/u.test(sentence)) {
        technical.lastIndex = 0;
        return [sentence.replace(technical, '').replace(/[:=]\s*(?=[，。；])/gu, '')];
      }
      return [];
    });
    if (!clean.length && line.trim()) {
      if (/失败|错误|未完成|受阻|缺少|等待/u.test(line)) output.push('当前操作未完成，需要先处理阻断问题。');
      continue;
    }
    line = clean.join('').replace(/[（(]\s*[）)]/g, '').replace(/[ \t]{2,}/g, ' ')
      .replace(/([\u4e00-\u9fff]) +(?=[\u4e00-\u9fff，。；：])/gu, '$1').replace(/ +([，。；：])/gu, '$1').trim()
      .replace(/\uE000(\d+)\uE001/g, (_, index) => links[Number(index)]);
    if (line.length > 140 && !/^\s*(?:\||[-*]|\d+[.、])/u.test(line)) {
      output.push(...line.split(/(?<=[。！？])\s*/u).filter(Boolean));
    } else output.push(line);
  }
  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const PRESENTATION_SURFACE_BUDGET: Record<AssistantReplyPresentationKind, number> = {
  operations: 520, news: 680, analytics: 560, reference: 460, inspiration: 680,
  content: 540, publishing: 540, ads: 560, customer: 600, enterprise: 540,
};

function firstSentence(value: string): string {
  const cleaned = value.replace(/，?\s*重点产品(?:聚焦|包括|为)[^。！？]*[：:]\s*$/u, '。').trim();
  return cleaned.match(/^.*?[。！？]/u)?.[0]?.trim() || cleaned;
}

function foldOperationsReply(main: string): { summary: string; detail: string } | null {
  const names = ['当前状态', '已完成', '待处理', '阻塞项', '今天最优先动作'] as const;
  const sections = new Map<string, { heading: string; lines: string[] }>();
  let active: { heading: string; lines: string[] } | null = null;
  for (const raw of main.split('\n')) {
    const normalized = raw.replace(/^\s*#{1,6}\s*/u, '').replace(/\*\*/g, '').trim();
    const name = names.find(value => new RegExp(`^${value}[：:]?$`, 'u').test(normalized));
    if (name) {
      active = { heading: `${name}：`, lines: [] };
      sections.set(name, active);
    } else if (active && raw.trim()) active.lines.push(raw.trim());
  }
  if (sections.size < 3) return null;

  const summary: string[] = [];
  const detail: string[] = [];
  for (const name of names) {
    const section = sections.get(name);
    if (!section) continue;
    const lines = section.lines.filter(Boolean);
    if (!lines.length) continue;
    const chosen = new Set<number>([0]);
    if (name === '当前状态') {
      const stateIndex = lines.findIndex((line, index) => index > 0 && /未发布|尚未发布|没有.*(?:回执|数据)|暂无.*(?:回执|数据)/u.test(line));
      if (stateIndex > 0) chosen.add(stateIndex);
    }
    summary.push(section.heading, ...[...chosen].sort((a, b) => a - b).map(index => firstSentence(lines[index])));
    const omitted = lines.filter((_line, index) => !chosen.has(index));
    if (omitted.length) detail.push(section.heading, ...omitted, '');
  }
  return { summary: summary.join('\n').trim(), detail: detail.join('\n').trim() };
}

function foldPresentationReply(main: string, kind: AssistantReplyPresentationKind): { summary: string; detail: string } | null {
  if (hasAssistantMarkdownTable(main)) return null;
  if (kind === 'operations') {
    const operations = foldOperationsReply(main);
    if (operations?.detail) return operations;
  }
  if (main.length <= PRESENTATION_SURFACE_BUDGET[kind]) return null;
  const units = main.split(/\n\s*\n/u).filter(value => value.trim()).flatMap(paragraph => {
    const lines = paragraph.split('\n').filter(value => value.trim());
    return lines.length > 1 ? lines : [paragraph];
  });
  const visible: string[] = [];
  const hidden: string[] = [];
  let length = 0;
  const essential = /失败|未完成|风险|阻塞|异常|审批|批准|授权|费用|预算|下一步|建议|优先|同比|环比|增长|下降|消耗|点击|转化|收入|订单|询盘|%|[¥$€]/u;
  for (const unit of units) {
    const candidate = firstSentence(unit);
    if (visible.length < 2 || (essential.test(candidate) && visible.filter(value => essential.test(value)).length < 2)) {
      if (!visible.includes(candidate) && length + candidate.length <= PRESENTATION_SURFACE_BUDGET[kind] + 120) {
        visible.push(candidate); length += candidate.length; continue;
      }
    }
    hidden.push(unit);
  }
  return hidden.length ? { summary: visible.join('\n\n'), detail: hidden.join('\n\n') } : null;
}

/** Optional detail protocol. Never infer hidden text from punctuation or sentence count. */
export function splitAssistantReply(content: string, options: { compact?: boolean; presentation?: AssistantReplyPresentationKind } = {}): { summary: string; details: string[] } {
  const summary: string[] = []; const details: string[] = [];
  let detail: string[] | null = null;
  let otherFence = false;
  for (const line of content.split('\n')) {
    if (detail !== null) {
      if (/^```\s*$/.test(line.trim())) { details.push(detail.join('\n')); detail = null; }
      else detail.push(line);
    } else if (!otherFence && /^```details\s*$/.test(line.trim())) detail = [];
    else { if (/^```/.test(line.trim())) otherFence = !otherFence; summary.push(line); }
  }
  // Streamed details stay inside the expandable area even before the closing fence.
  if (detail !== null) details.push(detail.join('\n'));
  let main = summary.join('\n');
  let autoFolded = false;
  if (!details.length && options.presentation) {
    const protectedBlocks: string[] = [];
    const foldable = main.replace(/```next\s*\n[\s\S]*?\n```/gu, block => {
      protectedBlocks.push(block);
      return '';
    }).trim();
    const folded = !/```/u.test(foldable) ? foldPresentationReply(foldable, options.presentation) : null;
    if (folded) {
      main = [folded.summary, ...protectedBlocks].filter(Boolean).join('\n\n');
      details.push(folded.detail);
      autoFolded = true;
    }
  }
  // Older replies have no details protocol. Fold only clearly long, paragraph-based
  // explanations, never code/copy, tables, file receipts or a single paragraph.
  if (!details.length && main.length > 1500 && !hasAssistantMarkdownTable(main) && !/```|<!--assistant-file:|^\s*\|/mu.test(main)) {
    const paragraphs = main.split(/\n\s*\n/u).filter(value => value.trim());
    if (paragraphs.length > 3) {
      let boundary = 1;
      while (boundary < paragraphs.length - 1 && paragraphs.slice(0, boundary).join('\n\n').length < 350) boundary++;
      main = paragraphs.slice(0, boundary).join('\n\n');
      details.push(paragraphs.slice(boundary).join('\n\n'));
    }
  }
  if (options.compact && !details.length && main.length > 420 && !hasAssistantMarkdownTable(main) && !/```(?:copy|chart|social-insight|industry-insight)|<!--assistant-file:|^\s*\|/mu.test(main)) {
    const units = main.split(/\n\s*\n/u).filter(value => value.trim()).flatMap(paragraph => {
      if (paragraph.length <= 220) return [paragraph];
      const sentences = paragraph.match(/[^。！？\n]+[。！？]?/gu)?.map(value => value.trim()).filter(Boolean) ?? [];
      return sentences.length > 1 ? sentences : [paragraph];
    });
    const visible: string[] = [];
    const hidden: string[] = [];
    let visibleLength = 0;
    for (const unit of units) {
      if (!visible.length || (visible.length < 5 && visibleLength + unit.length <= 440)) {
        visible.push(unit); visibleLength += unit.length;
      } else hidden.push(unit);
    }
    if (hidden.length) {
      main = visible.join('\n\n');
      details.push(hidden.join('\n\n'));
    }
  }
  const essential = autoFolded ? [] : details.flatMap(value => value.split('\n')).filter(line => /费用|预算|收费|失败|未完成|风险|审批|批准|授权|等待确认|尚未|不能|不可/u.test(line) && !main.includes(line.trim()));
  return { summary: [main, ...new Set(essential)].filter(Boolean).join('\n'), details };
}

export const assistantWantsDetailedReply = (text: string) => /详细|展开|完整分析|深入|逐项解释|多说一点|具体说明/u.test(text) && !/(?:不要|不用|无需).{0,4}(?:详细|展开|完整分析)/u.test(text);
