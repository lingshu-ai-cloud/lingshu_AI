import type { Message } from '../appSession';

/** Selection only: never turn assistant prose into facts or infer a user decision. */
export function selectAssistantConversationContext(
  input: Message[],
  options: { maxCharacters?: number; maxTurns?: number; instructionCharacters?: number } = {},
) {
  const maxCharacters = Math.max(0, options.maxCharacters ?? 12_000);
  const maxTurns = Math.max(0, options.maxTurns ?? 6);
  const instructionCharacters = Math.max(0, options.instructionCharacters ?? 3_000);
  const turns: Message[][] = [];
  for (const message of input) {
    if (!message.content.trim() || ['请求失败，请稍后重试。', 'API error'].includes(message.content.trim())) continue;
    if (message.role === 'user') turns.push([{ ...message }]);
    else if (turns.length) turns[turns.length - 1].push({ ...message });
  }
  let characters = 0;
  let start = turns.length;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const size = turns[index].reduce((sum, message) => sum + message.content.length, 0);
    if (turns.length - index > maxTurns || characters + size > maxCharacters) break;
    characters += size;
    start = index;
  }
  const retainedUserInstructions: string[] = [];
  let instructionSize = 0;
  // Retain bounded verbatim requests, never synthesized memory. Newer instructions win.
  for (let index = start - 1; index >= 0; index -= 1) {
    const text = turns[index][0].content;
    if (!/(请记住|以后|后续|不要|禁止|必须|只允许|保持|预算|上限|优先|remember|from now on|do not|must|budget|limit)/i.test(text)) continue;
    if (instructionSize + text.length > instructionCharacters) continue;
    retainedUserInstructions.unshift(text);
    instructionSize += text.length;
  }
  return { messages: turns.slice(start).flat(), omittedTurns: start, retainedUserInstructions };
}

export function renderAssistantConversationBoundary(context: ReturnType<typeof selectAssistantConversationContext>) {
  return [
    context.omittedTurns ? `【历史范围】较早的 ${context.omittedTurns} 轮对话未完整提供。不得假装记得未提供的细节。` : '',
    context.retainedUserInstructions.length
      ? `【较早用户原话】以下是用户历史请求的原文，不是已核验经营事实或已执行的授权；若与近期输入冲突，以近期输入为准。\n${JSON.stringify(context.retainedUserInstructions)}`
      : '',
  ].filter(Boolean).join('\n');
}
