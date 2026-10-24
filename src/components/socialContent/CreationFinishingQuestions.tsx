import { useState } from 'react';
import { Alert, Button, Input } from 'antd';
import type { CreationReply, CreationSelection, CreationTurn } from '../../../shared/contracts/contentCreationDialogue';

type Run = (action: CreationTurn['action'], answer: string, patch?: CreationSelection['productionDraft']) => Promise<void>;
export default function CreationFinishingQuestions({ reply, busy, run }: { reply: CreationReply; busy: boolean; run: Run }) {
  const [text, setText] = useState<string | null>(null);
  const stage = reply.stage;
  if (!['production_voice', 'production_subtitles', 'production_preview', 'production_finish'].includes(stage)) return null;
  const ending = reply.production?.finishing;
  return <>
    {ending && <Alert type="warning" showIcon title={ending.binding === 'unbound' ? '尚未绑定当前方案的生产项目' : ending.binding === 'mismatch' ? '项目证据与本方案不匹配' : '只读到项目元数据，尚未验证产物'} description={<>
      <p>{ending.note}</p>
      {ending.binding === 'bound' && <p>音频记录 {ending.audioRecords} 条；对齐字幕记录 {ending.subtitleRecords} 条；渲染记录 {ending.renderRecords} 条。计数不代表校验通过或可播放。</p>}
    </>}/>}
    {stage === 'production_voice' && <>
      <p>没有本方案的已核验音频、声线使用权和试听回执，不能提供真实配音试听。</p>
      <div className="flex flex-wrap gap-2">
        <Button type="primary" loading={busy} onClick={() => void run('production_subtitles', '保留配音需求，先不生成声音，继续检查字幕。', { voiceChoice: 'defer' })}>保留配音需求，暂不生成</Button>
        <Button disabled={busy} onClick={() => void run('production_subtitles', '本轮暂不配音，继续检查字幕。', { voiceChoice: 'none' })}>暂不配音，继续字幕问答</Button>
      </div>
    </>}
    {stage === 'production_subtitles' && <>
      <label htmlFor="production-answer-subtitles">请回答要保留的字幕文字</label>
      <Input.TextArea id="production-answer-subtitles" aria-label="字幕问答回复" value={text ?? ending?.subtitleText ?? reply.production?.narration ?? ''} maxLength={1500} autoSize={{ minRows: 4, maxRows: 10 }} disabled={busy} onChange={event => setText(event.target.value)}/>
      <p className="text-sm text-text-secondary">仅文字草稿。没有音频对齐证据，不编造时间码、字幕文件或导出成功。</p>
      <div className="flex flex-wrap gap-2">
        <Button type="primary" loading={busy} disabled={!(text ?? ending?.subtitleText)?.trim()} onClick={() => void run('production_preview', `保留字幕文字草稿，暂不对齐或生成文件：${(text ?? ending?.subtitleText ?? '').trim()}`, { subtitleChoice: 'draft', subtitleDraft: (text ?? ending?.subtitleText ?? '').trim() })}>保留字幕草稿，检查成片预览</Button>
        <Button disabled={busy} onClick={() => void run('production_preview', '本轮暂不加字幕，只检查成片预览证据。', { subtitleChoice: 'off' })}>暂不加字幕，检查预览</Button>
      </div>
    </>}
    {(stage === 'production_preview' || stage === 'production_finish') && <>
      <p>配音选择：{reply.selection.productionDraft?.voiceChoice === 'none' ? '暂不配音' : '保留需求，未生成声音'}；字幕选择：{reply.selection.productionDraft?.subtitleChoice === 'off' ? '暂不加字幕' : '仅保留文字草稿，未生成对齐字幕'}。</p>
      {reply.selection.productionDraft?.subtitleChoice === 'draft' && <p className="whitespace-pre-wrap">字幕文字草稿：{ending?.subtitleText}</p>}
      <Alert type="warning" showIcon title="当前没有可核验并播放的本方案成片。" description="不展示参考视频、工厂候选或其他项目文件作为成片；没有启动渲染或导出。"/>
      {stage === 'production_preview' && <Button type="primary" loading={busy} onClick={() => void run('production_finish', '保留配音、字幕和成片预览待补状态，不启动任何生成。')}>保留待补状态，不生成</Button>}
      <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void run('production_voice', '返回配音问答，只读检查，不生成声音。')}>返回配音问答</Button><Button disabled={busy} onClick={() => void run('production_subtitles', '继续字幕文字问答，不生成文件。')}>继续字幕问答</Button></div>
    </>}
  </>;
}
