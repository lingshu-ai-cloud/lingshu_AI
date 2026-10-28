import type OpenAI from 'openai';
import { createQwenClient } from '../agents/qwenClient.js';
/** One closed-book JSON completion; no retries, search or alternate provider. */
export async function analyzeSocialInsight(prompt: string, client?: ReturnType<typeof createQwenClient>): Promise<string> {
  const provider = client ?? createQwenClient();
  const request = {
    model: process.env.QWEN_NEWS_ANALYSIS_MODEL || process.env.QWEN_TEXT_MODEL || process.env.QWEN_MODEL || 'qwen-plus',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' }, enable_thinking: false, enable_search: false,
    max_tokens: 8192, temperature: 0.2,
  };
  const completion = await provider.chat.completions.create(request as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, { timeout: 90000, maxRetries: 0 });
  const choice = completion.choices[0];
  if (!choice || choice.finish_reason !== 'stop' || !choice.message.content?.trim()) throw Error('social_insight_model_incomplete');
  return choice.message.content;
}
