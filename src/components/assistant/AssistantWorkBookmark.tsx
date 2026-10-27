import { CalendarRange, ChevronRight } from 'lucide-react';
import { openContentGenerationQueue } from '../../lib/contentGenerationQueue';
import './assistantWorkBookmark.css';

/** Every task bookmark opens the shared weekly-and-single content queue. */
export default function AssistantWorkBookmark() {
  return <button type="button" className="assistant-work-bookmark" aria-label="打开内容生成队列" aria-haspopup="dialog" onClick={() => openContentGenerationQueue({ view: 'tasks' })}>
    <CalendarRange size={17} aria-hidden="true"/>
    <span>内容生成队列</span>
    <ChevronRight size={14} aria-hidden="true"/>
  </button>;
}
