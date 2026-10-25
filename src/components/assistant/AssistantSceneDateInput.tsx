import { DatePicker } from 'antd';
import dayjs from 'dayjs';

/** Store explicit Beijing wall-clock fields; conversion happens only at the task boundary. */
export default function AssistantSceneDateInput({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}) {
  return <DatePicker aria-label={label} className="mt-1 w-full" showTime={{format:'HH:mm'}} format="YYYY-MM-DD HH:mm"
    value={value?dayjs(value):null} onChange={next=>onChange(next?.format('YYYY-MM-DDTHH:mm')||'')}/>;
}
