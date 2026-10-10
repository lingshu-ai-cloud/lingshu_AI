import {
  BadgeDollarSign,
  BarChart3,
  Building2,
  CalendarClock,
  Clapperboard,
  ClipboardList,
  Database,
  LayoutDashboard,
  Megaphone,
  Plug,
  Search,
  Send,
  ShieldCheck,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

export type DuotoneGlyphKind =
  | 'home' | 'inspiration' | 'create' | 'publish' | 'monitor'
  | 'ads' | 'campaign' | 'agent' | 'customers' | 'orders'
  | 'enterprise' | 'memory' | 'schedule' | 'integration' | 'permissions';

const GLYPHS: Record<DuotoneGlyphKind, LucideIcon> = {
  home: LayoutDashboard,
  inspiration: Search,
  create: Clapperboard,
  publish: Send,
  monitor: BarChart3,
  ads: BadgeDollarSign,
  campaign: Megaphone,
  agent: Workflow,
  customers: Users,
  orders: ClipboardList,
  enterprise: Building2,
  memory: Database,
  schedule: CalendarClock,
  integration: Plug,
  permissions: ShieldCheck,
};

/** Sidebar icons stay neutral; color is reserved for content and primary actions. */
export default function DuotoneGlyph({
  kind,
  active = false,
  size = 28,
}: {
  kind: DuotoneGlyphKind;
  active?: boolean;
  size?: number;
}) {
  const Icon = GLYPHS[kind];
  return (
    <span
      aria-hidden="true"
      className={`sidebar-glyph ${active ? 'sidebar-glyph--active' : ''}`}
      style={{ width: size, height: size }}
    >
      <Icon size={17} strokeWidth={1.8} />
    </span>
  );
}
