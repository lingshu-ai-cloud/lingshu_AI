import { BarChart3, Clapperboard, Users, WandSparkles, type LucideIcon } from 'lucide-react';

export type AgentVisualRole = 'business' | 'director' | 'content' | 'customer';

export const AGENT_ROLE_ICONS: Record<AgentVisualRole, LucideIcon> = {
  business: BarChart3,
  director: Clapperboard,
  content: WandSparkles,
  customer: Users,
};

export const AGENT_ROLE_PALETTE: Record<AgentVisualRole, { color: string; tint: string }> = {
  business: { color: '#2563EB', tint: '#EFF6FF' },
  director: { color: '#7C3AED', tint: '#F5F3FF' },
  content: { color: '#DB3D77', tint: '#FDF2F8' },
  customer: { color: '#0F8B8D', tint: '#F0FDFA' },
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
  const palette = AGENT_ROLE_PALETTE[role];
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`inline-flex shrink-0 items-center justify-center rounded-full border transition-colors ${dimensions.frame} ${className}`}
      style={{ color: palette.color, borderColor: active ? palette.color : '#E4E4E7', backgroundColor: active ? palette.tint : '#FFFFFF' }}
    >
      <Icon size={dimensions.icon} strokeWidth={2.2} />
    </span>
  );
}
