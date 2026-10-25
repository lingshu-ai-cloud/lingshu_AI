import type { Message } from '../appSession';
import { assistantSourcePortalSchema } from '../../shared/contracts/assistantSourcePortal';

const SOURCE_LIST = /^(?:请)?(?:查看|看看|显示|列出)?(?:本次回答的|这些信息的|这些内容的)?(?:信息来源|数据来源|来源)(?:是哪里|在哪里|有哪些)?[？?。！!\s]*$/u;

function sourcesOf(message?: Message) {
  return message?.role === 'assistant' ? (message.sources || []).flatMap(value => {
    const parsed = assistantSourcePortalSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  }) : [];
}

export function assistantFollowUpSuggestion(messages: Message[]): string {
  const last = messages.at(-1);
  if (last?.role !== 'assistant' || last.creationPortal || last.sourcePortal || last.taskPortal?.phase === 'ready') return '';
  if (last.taskPortal?.phase === 'offered') return '打开这条任务';
  if (!sourcesOf(last).length) return '';
  return SOURCE_LIST.test(messages.at(-2)?.content.trim() || '') ? '打开第1条来源原文' : '查看本次回答的信息来源';
}

/** Use only the immediately preceding answer's recorded sources; never guess a URL. */
export function assistantSourceFollowUp(text: string, last?: Message): Message | null {
  const sources = sourcesOf(last);
  if (!sources.length) return null;
  if (SOURCE_LIST.test(text.trim())) return { role: 'assistant', content: '信息来源已列在下方，点击「数据和信息来源」可展开。', sources };
  const match = text.trim().match(/^(?:请|帮我)?打开(?:第([1-8一二三四五六七八])条来源原文|这篇原文|原文)[。！!\s]*$/u);
  if (!match) return null;
  if (!match[1] && sources.length > 1) return { role: 'assistant', content: '有多条来源，请指定要打开第几条。', sources };
  const ordinal = match[1] ? Number(match[1]) || '一二三四五六七八'.indexOf(match[1]) + 1 : 1;
  const source = sources[ordinal - 1];
  return source ? { role: 'assistant', content: '点击下方入口查看原文。', sourcePortal: source }
    : { role: 'assistant', content: `本次有${sources.length}条来源，请重新选择序号。`, sources };
}
