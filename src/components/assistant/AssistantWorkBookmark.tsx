import { CalendarRange, ChevronRight } from 'lucide-react';
import './assistantWorkBookmark.css';

/** The weekly bookmark opens the shared queue already scoped to weekly work. */
export default function AssistantWorkBookmark({ onOpen }: { onOpen: () => void }) {
  return <button type="button" className="assistant-work-bookmark" aria-label="打开周任务包" aria-haspopup="dialog" onClick={onOpen}>
    <CalendarRange size={17} aria-hidden="true"/>
    <span>周任务包</span>
    <ChevronRight size={14} aria-hidden="true"/>
  </button>;
}
