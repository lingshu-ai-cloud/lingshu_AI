import '../server/loadEnvironment.js';
import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';

const folder = path.resolve(process.argv[2] || 'data/analysis-output/gemini-direct-hook-7648939405557697806');
const key = process.env.GEMINI_API_KEY?.trim();
if (!key) throw new Error('GEMINI_API_KEY is not set');

const ai = new GoogleGenAI({ apiKey: key });
const clips = [
  { file: 'hook_0-1s.mp4', sourceStart: 0, duration: 1 },
  { file: 'opening_0-2s.mp4', sourceStart: 0, duration: 2 },
  { file: 'active_hook_0.083-1s.mp4', sourceStart: 0.083, duration: 0.917 },
  { file: 'active_opening_0.083-2s.mp4', sourceStart: 0.083, duration: 1.917 },
];

for (const clip of clips) {
  const video = fs.readFileSync(path.join(folder, clip.file));
  const coverContext = clip.sourceStart === 0
    ? '起始可能有封面闪帧；若发生场景跳切，请单独标出，不得当作人物运动。'
    : '起始封面闪帧已从这个片段剪除。';
  const response = await ai.models.generateContent({
    model: (process.env.GEMINI_HOOK_MODEL || 'gemini-2.5-flash').trim(),
    contents: [{ role: 'user', parts: [
      { text: `你是编导 Agent 的视频证据分析员。直接观看并听取原始 MP4，不要把它当作静帧集合。片段对应原片 ${clip.sourceStart}–${clip.sourceStart + clip.duration} 秒；输出时间码使用原片时间轴，精确到小数秒。${coverContext}重点识别截流动作，比较人物身体、手、背景与相机的相对运动。"敲门"必须有可见手形、往复轨迹与接近/接触位置证据，否则只描述可见动作。左右手若无法从画面可靠区分，写“靠近镜头的手”。声音必须基于明确可听证据，口播听不清写空字符串，字幕不等于口播。不能把超过本镜可说时长的整句字幕抄进口播。无法确认的音效不要填写；背景工人可见不代表机器声可听。不要猜测音乐、音效、品牌、人物身份或片段外动作。若末尾进入站立口播，标明可确认的时间和证据。
只输出 JSON 对象，结构为：{"clip":"${clip.file}","durationSeconds":${clip.duration},"sourceStart":${clip.sourceStart},"hookRange":{"start":${clip.sourceStart},"end":1,"evidence":""},"shots":[{"start":${clip.sourceStart},"end":0,"shotSize":"景别","cameraMovement":"运镜","cameraAngle":"视角","composition":"构图","visual":"具体画面","subject":"出镜主体与位置","subjectAction":{"startState":"","pathAndContact":"","endState":""},"dialogue":"可听清的主体原话；听不清留空","voiceover":"画外配音；无证据留空","bgm":"可听配乐；无证据留空","soundEffects":[],"ambientSound":"可听环境声；无证据留空","onScreenText":"可见文字","purposeInference":"推断的表达目的","observedEvidence":"时间码+可见可听依据","uncertainties":[],"confidence":0.5,"needsReview":true}],"globalUncertainties":[]}。shots 必须连续覆盖片段，真实画面跳切或功能变化才拆镜；动作变化可留在同镜的 subjectAction，不能伪造剪辑切点。` },
      { inlineData: { mimeType: 'video/mp4', data: video.toString('base64') }, videoMetadata: { fps: 12 } },
    ] }],
    config: { responseMimeType: 'application/json', maxOutputTokens: 9000,
      thinkingConfig: { thinkingBudget: 0 }, httpOptions: { timeout: 120_000 } },
  });
  if (!response.text?.trim()) throw new Error(`Gemini returned an empty response for ${clip.file}`);
  const result = JSON.parse(response.text);
  const output = path.join(folder, clip.file.replace(/\.mp4$/, '.gemini-12fps.json'));
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`${clip.file}: ${Array.isArray(result.shots) ? result.shots.length : 0} shots -> ${output}`);
}
