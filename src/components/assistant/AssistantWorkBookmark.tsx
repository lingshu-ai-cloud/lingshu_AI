import { CalendarRange, ChevronRight } from 'lucide-react';
import { openContentGenerationQueue } from '../../lib/contentGenerationQueue';
import './assistantWorkBookmark.css';

/** The weekly bookmark opens the shared queue already scoped to weekly work. */
export default function AssistantWorkBookmark() {
  return <button type="button" className="assistant-work-bookmark" aria-label="打开周任务包" aria-haspopup="dialog" onClick={() => openContentGenerationQueue({ view: 'tasks', source: 'weekly' })}>
    <CalendarRange size={17} aria-hidden="true"/>
    <span>周任务包</span>
    <ChevronRight size={14} aria-hidden="true"/>
  </button>;
}
