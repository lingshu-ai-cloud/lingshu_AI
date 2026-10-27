export const ASSISTANT_READABLE_POLICY = `【面向客户的表达规则】
像了解业务的同事自然交流，先回应用户真正关心的事，再解释到足够用户判断。不设三句话或固定条数限制，不机械套用“结论—原因—行动”标题。
按问题复杂度决定篇幅：状态查询直接回答；建议、比较、原因分析保留必要依据和取舍。默认一屏内读完，以短段落为主，不重复背景、空泛总结或强行追加建议。
普通交流正常说话，不强行生成卡片、图表、表格或快捷按钮。确有必要的追问时才可用next块，最多两个，只是继续对话的问题，不代表已获授权的执行动作。
有较长的补充分析时，先完整交代关键结果、判断依据和风险，再提供可选的详细依据和更多方案。费用、失败、风险、审批条件不得只藏在展开区。用户明确要求详细分析时完整回答，无需为了简短省略必要内容。文件正文与用户要求的交付内容不受聊天摘要篇幅约束。未声明支持交互块的客户端使用普通自然段，不输出界面控制标记。
禁止在面向用户的正文输出数据库集合名、内部字段名、记录ID、原始错误码、英文状态枚举、内部路径或JSON。来源核验留在服务端，不在正文使用[记录:集合/ID]。
把技术状态翻译成业务语言，例如采集失败、等待方案确认、缺少产品资料。不能隐藏失败、费用、风险、审批条件或把未执行说成已完成。
易懂不等于补编解释：不能把故障自行解释为主动暂停，不能擅自推荐跳过必需依赖。只依据服务端提供的实际能力提出操作建议；没有对应能力或执行回执时，不承诺“立刻重试”“继续生产”或“已经处理”。
保留关键数量、产品名称、必要的平台名称和明确行动；不堆砌术语。英文营销文案等用户明确需要的交付内容保留原语言，不把品牌名或TikTok等平台名称当成技术字段删除。`;

export const ASSISTANT_DETAILS_POLICY = '【网页交互格式】当前网页支持折叠分析。可选详细依据用独立的三反引号details块，结束时使用独立三反引号。块内仅使用自然段或列表，不嵌套代码块；图表与交付文案使用各自的正文专用块。正文须先交代足以判断的结果、理由和风险。无需补充时不要输出空块；普通聊天不使用copy块包装解释。';

export const ASSISTANT_QUICK_TASK_POLICY = `【快捷任务回复 · 必须遵守】
这是用户从快捷任务卡片发起的工作查询。目标是让用户快速看懂现状并作出判断，不写成长篇报告，也不把不同功能套进同一份固定模板。
- 先给本题最重要的结论或状态；随后只呈现影响判断的重点，默认一屏内读完。不复述用户问题、企业背景或分析过程。
- 标题、列表、短表格、图表和自然段按场景选用，不要求每轮都有相同标题或相同条数；同一回答内也不要把每项写成等长模板。
- 关键数字、异常、失败、风险、审批条件和建议动作始终留在可见正文。details 只放逐项明细、方法口径、补充证据或次要方案，不能承担正文续写。
- 缺少关键数据时只说明真正阻塞结论的缺口，并给一个可执行的补充动作；不要罗列所有未接入字段。
- 有已核验来源时，让来源靠近对应事实；不要只在末尾堆一长串链接。需要用户选择时一次只问 1 个关键问题。
- 可继续处理的动作使用 next 块，最多 2 个短选项；用户明确要求的可复制话术、脚本或文案可完整放在 copy 块。`;

const TERMS: Record<string, string> = {
  scheduled_source_collection: '平台热点采集', workflow_tasks: '任务',
  plan_review: '等待方案确认', needs_input: '等待补充资料', waiting_human: '等待人工确认',
  user_input_required: '需要补充资料', capability_mismatch: '当前生产条件不满足',
  source_failed: '采集失败', no_valid_results: '未采集到可用内容',
  unavailable: '暂未核验', available: '已读取', empty: '暂无记录', attention: '需要关注',
  failed: '失败', blocked: '已阻塞', complete: '已完成', completed: '已完成', success: '已完成', producing: '制作中', queued: '排队中',
  paused: '已暂停', delivered: '已交付', pending: '待处理', running: '执行中',
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
      else { fence = marker[1]; keepFence = ['copy', 'next', 'chart'].includes(fence); if (keepFence) output.push(raw); }
      continue;
    }
    if (fence !== null) { if (keepFence) output.push(raw); continue; }
    const links: string[] = [];
    const protectedLine = raw.replace(/https?:\/\/[^\s)\]<>]+/gu, url => { links.push(url); return `\uE000${links.length - 1}\uE001`; });
    let line = protectedLine
      .replace(/\[\s*记录\s*[:：][^\]\n]*(?:\]|$)/gu, '')
      .replace(/\/api\/[A-Za-z0-9_/?=&.%:-]+/g, '')
      .replace(/(?:workflow_tasks|studio_projects|social_content_tasks|agent_runs)\/[A-Za-z0-9_./-]+/g, '')
      .replace(/\b[0-9a-f]{24,}\b/gi, '')
      .replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi, '')
      .replace(/\bdoubao-seedance-[\w-]+(?:\s+not activated)?\b/giu, 'Seedance 视频能力尚未开通')
      .replace(/\bno formal assets uploaded\b/giu, '尚未上传可用于正式制作的素材')
      .replace(/\bimage size must be\s*≥?\s*(\d+)\s*pixels\b/giu, '图片像素需至少达到 $1');
    for (const [token, label] of Object.entries(TERMS)) {
      line = line.replace(new RegExp(`(?<![\\w])${token}(?![\\w])`, 'g'), label);
    }
    line = line.replace(/`([^`]+)`/g, '$1').replace(/`/g, '').replace(/^(\s*)依据[:：]/u, '$1原因：')
      .replace(/\bHTTP\s*[45]\d\d\b/gi, '服务请求失败')
      .replace(/\b(?:ECONNREFUSED|ETIMEDOUT|ENOTFOUND)\b/g, '服务连接失败');
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

/** Optional detail protocol. Never infer hidden text from punctuation or sentence count. */
export function splitAssistantReply(content: string, options: { compact?: boolean } = {}): { summary: string; details: string[] } {
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
  // Older replies have no details protocol. Fold only clearly long, paragraph-based
  // explanations, never code/copy, tables, file receipts or a single paragraph.
  if (!details.length && main.length > 1500 && !/```|<!--assistant-file:|^\s*\|/mu.test(main)) {
    const paragraphs = main.split(/\n\s*\n/u).filter(value => value.trim());
    if (paragraphs.length > 3) {
      let boundary = 1;
      while (boundary < paragraphs.length - 1 && paragraphs.slice(0, boundary).join('\n\n').length < 350) boundary++;
      main = paragraphs.slice(0, boundary).join('\n\n');
      details.push(paragraphs.slice(boundary).join('\n\n'));
    }
  }
  if (options.compact && !details.length && main.length > 420 && !/```(?:copy|chart)|<!--assistant-file:|^\s*\|/mu.test(main)) {
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
  const essential = details.flatMap(value => value.split('\n')).filter(line => /费用|预算|收费|失败|未完成|风险|审批|批准|授权|等待确认|尚未|不能|不可/u.test(line) && !main.includes(line.trim()));
  return { summary: [main, ...new Set(essential)].filter(Boolean).join('\n'), details };
}

export const assistantWantsDetailedReply = (text: string) => /详细|展开|完整分析|深入|逐项解释|多说一点|具体说明/u.test(text) && !/(?:不要|不用|无需).{0,4}(?:详细|展开|完整分析)/u.test(text);
