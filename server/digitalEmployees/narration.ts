import { VIDEO_LANGUAGES, narrationLength, narrationRate } from '../../src/lib/videoLanguages.js';
import { callVideoModel } from './videoModel.js';
import { spokenLanguageMatches } from '../../src/lib/videoCreationPlan.js';

export function narrationUnits(text: string, language: string): number {
  return narrationLength(text, language);
}
export function parseNarration(raw: string, language: string, duration: number): string[] {
  const payload = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
  const lines = Array.isArray(payload.lines) ? payload.lines.filter((line: unknown) => typeof line === 'string' && line.trim()).map((line: string) => line.trim()) : [];
  const spoken = lines.join(' ');
  if (lines.length < 3 || lines.length > 8 || !spokenLanguageMatches(spoken, language)) throw Error(`口播需为 ${language}，并包含 3–8 句，实际 ${lines.length} 句`);
  const units = narrationUnits(spoken, language), rate = narrationRate(language);
  if (units > duration * rate * 1.35 || units < duration * rate * 0.5) throw Error(`口播长度 ${units}，目标时长 ${duration} 秒允许 ${Math.ceil(duration * rate * 0.5)}–${Math.floor(duration * rate * 1.35)} 字词`);
  return lines;
}
export async function generateNarration(input: { facts: string; theme: string; audience: string; language: string; duration: number; cta: string; constraints: string[]; reference?: string }): Promise<string[]> {
  const units = Math.floor(input.duration * (narrationRate(input.language) * 0.87));
  const languageName = VIDEO_LANGUAGES[input.language as keyof typeof VIDEO_LANGUAGES] || input.language;
  const prompt = `写一段纯${languageName}（${input.language}） 社媒口播，目标 ${input.duration} 秒、约 ${units} ${['zh', 'ja'].includes(input.language) ? '字' : '词'}。先完整想清表达，再按自然语意分成3–8句。
对谁说：${input.audience}。具体主题：${input.theme}。收尾目的：${input.cta}。
先提出具体场景中的问题，解释为什么值得关注，给一个可执行的判断方法，再自然收尾。保留句子之间的承接；不加假经历、口头禅或审稿腔。不假定买家已经遇到故障或缺少能力，开头用选型/核实时的具体问题。
仅允许陈述下列已确认事实，所有数字和条件需有原文依据。行业猜测改成买家要核实的问题；不承诺资料外的效果或服务。收尾仅邀请讨论需求，不承诺提供未经确认存在的清单、指南、方案或测试服务。提到几个问题，就必须完整给出对应数量的问题。
不要朗读内部素材编号、资料标题或测试标签。没有画面分析时，不断言视频里有/没有某技术内容，只讲买家应该向供应商核实什么，不扩展主题外的系统和型号。
事实：${input.facts}
约束：${input.constraints.join('；')}
${input.reference ? '参考只迁移表达顺序，不复制事实：' + input.reference : ''}
只输出 JSON：{"lines":["完整口播第一句","衔接句","收尾"]}。`;
  let correction = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const { text: raw } = await callVideoModel(prompt + correction, { timeoutMs: 90000, systemPrompt: `所有口播必须使用${languageName}（${input.language}），不要翻译成其他语言。JSON键名固定为lines。严格控制总长度和句数。` });
    try { return parseNarration(raw, input.language, input.duration); } catch (error) {
      if (attempt === 1) throw error;
      correction = `\n上一版未通过：${error instanceof Error ? error.message : 'JSON无效'}。请在原事实边界内重写完整版本，不增加信息。上一版：${raw.slice(0, 6000)}`;
    }
  }
  throw Error('口播生成失败');
}
export async function reviewFinalNarration(input: { spoken: string; facts: string; language: string; constraints: string[] }): Promise<string[]> {
  if (!spokenLanguageMatches(input.spoken, input.language)) return ['最终口播语言与制作计划不符'];
  const { text: raw } = await callVideoModel(`审核最终口播，首先检查正文是否为目标语言 ${input.language}（品牌、型号可保留原文），包括区分英语、西语、法语等拉丁字母语言。再检查会改变事实或理解的问题：未提供依据的数字/效果/承诺，条件或否定丢失，要求“这几个问题”却未列出，制作审稿腔。不要按个人文风改写。私信领取清单/指南/方案等也属于服务承诺，事实中未明确提供则指出。只检查口播，不检查画面标识是否出现或出现位置；画面标识由渲染单独验证。
已确认事实：${input.facts}
约束：${input.constraints.join('；')}
最终口播：${input.spoken}
不把待确认的中性提问当成事实断言。“视频不能证明某功能”不等于“设备没有某功能”，前者是证据边界，不应误报为否定功能。不要因未展开全部技术条件而拒绝简短科普。仅输出 JSON：{"issues":["具体问题及原句；没有问题则空数组"]}。`, { timeoutMs: 60000 });
  const payload = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
  if (!Array.isArray(payload.issues)) throw Error('最终口播审核未返回有效结论');
  return payload.issues.filter((issue: unknown) => typeof issue === 'string' && issue.trim());
}
