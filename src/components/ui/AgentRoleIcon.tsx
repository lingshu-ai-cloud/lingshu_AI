import { BarChart3, Clapperboard, Users, WandSparkles, type LucideIcon } from 'lucide-react';

export type AgentVisualRole = 'business' | 'director' | 'content' | 'customer';

export const AGENT_ROLE_ICONS: Record<AgentVisualRole, LucideIcon> = {
  business: BarChart3,
  director: Clapperboard,
  content: WandSparkles,
  customer: Users,
};

const sizes = {
  sm: { frame: 'h-9 w-9', icon: 16 },
  md: { frame: 'h-11 w-11', icon: 19 },
  lg: { frame: 'h-12 w-12', icon: 21 },
} as const;

export default function AgentRoleIcon({
  role,
  active = false,
  size = 'md',
  label,
  className = '',
}: {
  role: AgentVisualRole;
  active?: boolean;
  size?: keyof typeof sizes;
  label?: string;
  className?: string;
}) {
  const Icon = AGENT_ROLE_ICONS[role];
  const dimensions = sizes[size];
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`inline-flex shrink-0 items-center justify-center rounded-full border transition-colors ${dimensions.frame} ${active ? 'border-[#117F51] bg-[#E7F6EE] text-[#117F51]' : 'border-[#9AAEA4] bg-[#F1F6F2] text-[#53695F]'} ${className}`}
    >
      <Icon size={dimensions.icon} strokeWidth={2.2} />
    </span>
  );
}
