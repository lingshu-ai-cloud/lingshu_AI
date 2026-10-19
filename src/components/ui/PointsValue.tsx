import { Star } from 'lucide-react';

export default function PointsValue({
  value,
  estimated = false,
  suffix,
  className = '',
}: {
  value: number | string;
  estimated?: boolean;
  suffix?: string;
  className?: string;
}) {
  const readable = `${estimated ? '约 ' : ''}${value}${suffix || ''} 积分`;
  return <span className={`inline-flex items-center gap-1 tabular-nums ${className}`} aria-label={readable} title={readable}>
    {estimated && <span aria-hidden="true">约</span>}
    <Star size={14} strokeWidth={1.8} className="shrink-0 text-amber-500" fill="currentColor" aria-hidden="true"/>
    <span>{value}{suffix}</span>
  </span>;
}
