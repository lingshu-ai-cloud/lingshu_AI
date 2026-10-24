import { Alert, Button, Tag } from 'antd';
import type { CreationReply } from '../../../shared/contracts/contentCreationDialogue';
import { VIDEO_LANGUAGES } from '../../../shared/contracts/videoLanguages';

/** Submission is connected to the existing task boundary, never inferred from a plan snapshot. */
export default function GuidedCreationSubmission({ reply, onRefresh }: { reply: CreationReply; onRefresh: () => void }) {
  const guided = reply.guided!;
  return <div className="guided-creation__review">
    <h3>确认创作</h3>
    <p>{reply.products.filter(row => reply.selection.productIds.includes(row.id)).map(row => row.name).join('、')}</p>
    <p>{reply.selection.guided?.languages.map(lang => <Tag key={lang}>{VIDEO_LANGUAGES[lang as keyof typeof VIDEO_LANGUAGES]}</Tag>)}</p>
    <p>{guided.nodes.length} 个镜头 · 自动口播 · 默认字幕 · 后台选择配乐</p>
    {guided.blockers.length > 0 && <Alert type="warning" showIcon title="以下真实依赖尚需补齐" description={<ul>{guided.blockers.map((row, index) => <li key={`${row.code}:${index}`}>{row.message}</li>)}</ul>}/>}
    <Button type="primary" disabled={guided.blockers.length > 0}>确认生成</Button>
    <Button onClick={onRefresh}>重新核验</Button>
  </div>;
}
