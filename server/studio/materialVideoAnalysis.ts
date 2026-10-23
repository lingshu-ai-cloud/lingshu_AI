import { analyzeVideo } from '../agents/gemini.js';
import { analyzeVideoFramesWithQwen } from '../agents/qwen.js';
import { extractQwenAnalysisFrames } from '../routes/videos.js';
import { analysisDetailsTimelineQuality } from '../routes/studioReferenceTimelineQuality.js';

export async function analyzeMaterialVideo(videoPath: string, buffer: Buffer, duration: number) {
  if ((process.env.VIDEO_ANALYSIS_PROVIDER || 'qwen').trim().toLowerCase() === 'qwen') {
    const frames = await extractQwenAnalysisFrames(videoPath, 30, duration);
    if (frames.length) {
      const strategy = await analyzeVideoFramesWithQwen({ frames, duration, analysisMode: 'strategy' });
      const strategyQuality = analysisDetailsTimelineQuality(strategy.scriptDetails15s, duration);
      if (strategyQuality.valid) return strategy;
      console.warn(`[studio] 策略档时间轴不合格，改用精确档重试：${strategyQuality.issues.join('；')}`);
      const exact = await analyzeVideoFramesWithQwen({ frames, duration, analysisMode: 'exact' });
      const exactQuality = analysisDetailsTimelineQuality(exact.scriptDetails15s, duration);
      if (exactQuality.valid) return exact;
      throw new Error(`千问素材逐镜分析未达到可匹配标准：${exactQuality.issues.join('；')}`);
    } else {
      throw new Error('素材抽帧为空，无法执行千问分析，请检查视频后重试');
    }
  }
  const gemini = await analyzeVideo({ videoBase64: buffer.toString('base64'), mimeType: 'video/mp4' });
  const geminiQuality = analysisDetailsTimelineQuality(gemini.scriptDetails15s, duration);
  if (!geminiQuality.valid) {
    throw new Error(`素材逐镜分析未达到可匹配标准：${geminiQuality.issues.join('；')}`);
  }
  return gemini;
}
