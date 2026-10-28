import { reportPresentationText } from './reportPresentation.js';
import type { SocialInsightReport } from './socialInsightReport.js';

type Assignment = NonNullable<SocialInsightReport['materials']>['assignments'][number];
type Video = SocialInsightReport['videos'][number];
export type SocialInsightRecommendation = { video: Video; material: Assignment; fillsB2bSlot: boolean };
/** Ranking is within this public snapshot; categories remain the model's original classification. */
export function recommendSocialInsightSamples(report: SocialInsightReport): SocialInsightRecommendation[] {
 if (!report.materials) return [];
 const candidates = report.materials.assignments.flatMap(material => {
  const video = report.videos.find(item => item.id === material.videoId);
  if (!video || material.confidence !== 'high' || video.views === null || (material.category === 'b2b' && video.views < 10000)) return [];
  if (!video.caption?.trim() || !reportPresentationText(material.reason).trim() || /待核验|无法|不足|未提供|不适用/u.test(material.reason)) return [];
  const useful = (text: string) => !!reportPresentationText(text).trim() && !/待核验|无法|不足|未提供|不适用|无可/u.test(text);
  if (!useful(material.merchantHelp) || !useful(material.contentAngle)) return [];
  return [{video,material,fillsB2bSlot:false}];
 }).sort((a,b) => b.video.views! - a.video.views! || a.video.id.localeCompare(b.video.id));
 const b2b = candidates.filter(item => item.material.category === 'b2b').slice(0,6);
 const b2c = candidates.filter(item => item.material.category === 'b2c').slice(0,4 + (6 - b2b.length));
 return [...b2b,...b2c.map((item,index)=>({...item,fillsB2bSlot:index>=4}))];
}
