import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PILOT_EVENTS_FILE = path.join(__dirname, '../../data/sales-pilot-events.json');

export type PilotEventType =
  | 'draft_generated' | 'draft_adopted' | 'draft_edited' | 'edit_reason_recorded'
  | 'evidence_acquired' | 'stage_changed' | 'stage_rolled_back'
  | 'handoff_requested' | 'handoff_viewed' | 'handoff_accepted'
  | 'quotation_sent' | 'order_won' | 'order_lost' | 'order_on_hold'
  | 'complaint' | 'repeated_question' | 'human_correction';

export interface PilotEvent {
  id: string;
  tenantId: string;
  customerId: string;
  type: PilotEventType;
  occurredAt: string;
  turnIndex?: number;
  metadata?: Record<string, unknown>;
}

function readEvents(): PilotEvent[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(PILOT_EVENTS_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeEvents(events: PilotEvent[]): void {
  fs.mkdirSync(path.dirname(PILOT_EVENTS_FILE), { recursive: true });
  const temp = `${PILOT_EVENTS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(events.slice(-20_000), null, 2), 'utf8');
  fs.renameSync(temp, PILOT_EVENTS_FILE);
}

export function recordPilotEvent(event: PilotEvent): boolean {
  const events = readEvents();
  if (events.some(existing => existing.tenantId === event.tenantId && existing.id === event.id)) return false;
  events.push(event);
  writeEvents(events);
  return true;
}

function ratio(numerator: number, denominator: number): number {
  return denominator ? Math.round((numerator / denominator) * 10_000) / 100 : 0;
}

export function aggregatePilotMetrics(events: PilotEvent[], tenantId: string, now = Date.now()) {
  const scoped = events.filter(event => event.tenantId === tenantId);
  const count = (type: PilotEventType) => scoped.filter(event => event.type === type).length;
  const generated = count('draft_generated');
  const adopted = count('draft_adopted');
  const edited = count('draft_edited');
  const handoffDurations: number[] = [];
  const handoffViewDurations: number[] = [];
  const requests = scoped.filter(event => event.type === 'handoff_requested');
  requests.forEach(request => {
    const viewed = scoped.find(event => event.customerId === request.customerId && event.type === 'handoff_viewed' && Date.parse(event.occurredAt) >= Date.parse(request.occurredAt));
    const accepted = scoped.find(event => event.customerId === request.customerId && event.type === 'handoff_accepted' && Date.parse(event.occurredAt) >= Date.parse(request.occurredAt));
    if (viewed) handoffViewDurations.push((Date.parse(viewed.occurredAt) - Date.parse(request.occurredAt)) / 60_000);
    if (accepted) handoffDurations.push((Date.parse(accepted.occurredAt) - Date.parse(request.occurredAt)) / 60_000);
  });
  const customerCount = new Set(scoped.map(event => event.customerId)).size;
  return {
    status: scoped.length ? 'collecting' : 'awaiting_real_pilot',
    generatedAt: new Date(now).toISOString(),
    sample: { events: scoped.length, customers: customerCount },
    draft: { generated, adopted, edited, adoptionRate: ratio(adopted, generated), editRate: ratio(edited, Math.max(adopted + edited, generated)) },
    evidence: { acquired: count('evidence_acquired'), acquiredWithin3Turns: scoped.filter(event => event.type === 'evidence_acquired' && Number(event.turnIndex || 99) <= 3).length },
    lifecycle: { advanced: count('stage_changed'), rolledBack: count('stage_rolled_back') },
    handoff: {
      requested: requests.length,
      viewed: count('handoff_viewed'),
      accepted: count('handoff_accepted'),
      medianViewMinutes: handoffViewDurations.length ? handoffViewDurations.sort((a, b) => a - b)[Math.floor(handoffViewDurations.length / 2)] : null,
      medianAcceptMinutes: handoffDurations.length ? handoffDurations.sort((a, b) => a - b)[Math.floor(handoffDurations.length / 2)] : null,
    },
    funnel: { quotationsSent: count('quotation_sent'), won: count('order_won'), lost: count('order_lost'), onHold: count('order_on_hold') },
    quality: { complaints: count('complaint'), repeatedQuestions: count('repeated_question'), humanCorrections: count('human_correction') },
    editReasons: scoped.filter(event => event.type === 'edit_reason_recorded').map(event => String(event.metadata?.reason || '')).filter(Boolean),
    interpretation: '试点指标仅用于观察真实使用，不构成 AI 提升成交率的因果证明。',
  };
}

export function getPilotMetrics(tenantId: string) {
  return aggregatePilotMetrics(readEvents(), tenantId);
}
