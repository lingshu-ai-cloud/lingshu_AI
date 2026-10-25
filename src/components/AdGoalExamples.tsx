import { useEffect, useState } from 'react';
import { Alert, Button, Drawer, Typography } from 'antd';
import MetaInstantFormGuide from './MetaInstantFormGuide';
import AdJourneyReview from './AdJourneyReview';
import { LsMediaStateFrame, LsProgressiveMedia, type LsMediaState } from './ui/LsExperiencePrimitives';
import './adGoalExamples.css';

export const goalExamples: Record<string, { path: string; experience: string; prepare: string }> = {
  '提升网站访问': { path: '流量 → 网站 → 链接点击', experience: '客户在信息流看到视频广告，点击行动按钮后打开你的网站。', prepare: '核对落地页地址、移动端打开速度、广告承诺和页面内容；链接点击不代表提交询盘。' },
  '提升有效视频观看': { path: '互动 → 视频 → ThruPlay', experience: '客户直接在 Facebook 或 Instagram 观看广告视频。广告外观可能与其他目标相似，区别在投放优化和成效统计。', prepare: '检查视频开头、字幕、语言与产品信息。ThruPlay 统计不等于网站访问或有效客户。' },
  '获取消息会话': { path: '互动 → 消息应用 → 发起会话', experience: '客户点击广告按钮后，进入 WhatsApp、Messenger 或 Instagram 对话，向企业发起咨询。', prepare: '选定消息渠道，核对主页绑定的商业号码或专业账户，可按需准备欢迎语和常见问题。' },
  '获取Meta表单线索': { path: '潜在客户 → 即时表单', experience: '客户点击广告后，在 Meta 内查看介绍、填写联系信息与问题，确认后提交。', prepare: '核对表单问题、隐私政策与完成页，并发布正确版本的表单。' },
  '获取独立站询盘': { path: '潜在客户 → 网站 → Lead 事件', experience: '客户点击广告进入你的独立站，在网站询盘表单提交需求。网站表单的外观由你的站点决定。', prepare: '确认询盘页面能提交，成功后只触发一次 Lead，核对 Pixel 与隐私说明。' },
};

const screenshots: Record<string, { file: string; caption: string; date: string; video: string; second: number }> = {
  '提升网站访问': { file: 'meta-website-traffic-2026.jpg', caption: 'Instagram 广告预览：Learn more 按钮打开网站。', date: '2026 年 6 月', video: 'kd9ox4PPI6M', second: 876 },
  '提升有效视频观看': { file: 'meta-video-views-2026.jpg', caption: '视频观看目标的实际设置：Video views → Maximise ThruPlay views。此图展示投放设置，客户看到的是视频内容。', date: '2026 年 7 月', video: 'mWsj5Uq_hws', second: 1276 },
  '获取消息会话': { file: 'meta-messages-2026.jpg', caption: 'Messenger 广告预览：Send message 按钮发起对话。WhatsApp、Instagram 的按钮与对话入口按所选渠道变化。', date: '2026 年 6 月', video: 'MtApVhL6jKA', second: 745 },
  '获取Meta表单线索': { file: 'meta-instant-form-preview-2026.jpg', caption: 'Meta 即时表单介绍页预览：阅读介绍后点 Continue，继续填写信息与问题。', date: '2026 年 7 月', video: 'OiVWdEe6ipw', second: 791 },
  '获取独立站询盘': { file: 'meta-website-lead-2026.jpg', caption: '独立站实际承接页：填写姓名、电话、地区后请求联系。网站表单由企业设计，这不是 Meta 原生表单。', date: '2026 年 3 月', video: 'HQj4BgLQ0OQ', second: 241 },
};

function GoalScreenshot({ goal, onPreviewChange }: { goal: string; onPreviewChange: (open: boolean) => void }) {
  const [state, setState] = useState<LsMediaState>('loading');
  const shot = screenshots[goal];
  if (!shot) return null;
  return <figure className="ads-goal-screenshot">
    <LsMediaStateFrame state={state} label={state === 'error' ? '截图未加载，可打开原始实录查看' : undefined}>
      <LsProgressiveMedia src={`/references/${shot.file}`} alt={shot.caption} width="100%" height={240} style={{ objectFit: 'contain' }} onLoad={() => setState('ready')} onError={() => setState('error')} preview={{ mask: '放大查看截图', onOpenChange: onPreviewChange }}/>
    </LsMediaStateFrame>
    <Typography.Link href={`https://www.youtube.com/watch?v=${shot.video}&t=${shot.second}s`} target="_blank" rel="noopener noreferrer">查看原作者实录与时间点</Typography.Link>
  </figure>;
}

export default function AdGoalExamples({ goal, onOverlayOpenChange }: { goal: string; onOverlayOpenChange: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  useEffect(() => { onOverlayOpenChange(open || previewOpen); }, [open, previewOpen, onOverlayOpenChange]);
  useEffect(() => () => onOverlayOpenChange(false), [onOverlayOpenChange]);
  const example = goalExamples[goal];
  const content = <section className="ads-goal-reference-content" aria-label={`${goal}示例与准备`}>
    <h3>{goal}</h3>
    {example ? <>
      <Typography.Text type="secondary">{example.path}</Typography.Text>
      <p>{example.experience}</p>
      <GoalScreenshot key={goal} goal={goal} onPreviewChange={setPreviewOpen}/>
      <Typography.Paragraph type="secondary" className="ads-goal-source-note">截图来自 V.S.L Digital Marketing Hub 的 2026 年操作实录，仅作界面参考，并非当前账户广告或你的最终素材。</Typography.Paragraph>
      <AdJourneyReview goal={goal}/>
      {goal === '获取Meta表单线索' && <MetaInstantFormGuide/>}
    </> : <Alert type="info" showIcon title="当前目标仅支持草稿规划" description="尚未接入此目标的真实投放与平台示例。"/>}
  </section>;
  return <>
    <aside key={goal} className="ads-goal-reference" aria-label="投放目标示例"><h3>Meta 目标示例与准备</h3>{content}</aside>
    <Button className="ads-goal-reference-trigger" onClick={() => setOpen(true)}>查看目标示例与准备</Button>
    <Drawer title="目标示例与准备" placement="right" open={open} onClose={() => setOpen(false)} size="default">{content}</Drawer>
  </>;
}
