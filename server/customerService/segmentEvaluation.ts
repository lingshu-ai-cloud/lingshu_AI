import type { CustomerSegmentCriteria } from '../../shared/contracts/customerSegmentation.js';

type Customer = Record<string, unknown>;
const list = (v: unknown): string[] => Array.isArray(v) ? v.map(String) : [];
const object = (v: unknown): Customer => v && typeof v === 'object' && !Array.isArray(v) ? v as Customer : {};
export function evaluateCustomerSegment(customer: Customer, criteria: CustomerSegmentCriteria, now: number, optedOut: boolean) {
  const id = String(customer.id || ''), bant = object(customer.bant), facts = object(customer.businessFacts);
  const reasons: string[] = [];
  if (optedOut) reasons.push('customer_opted_out_or_blacklisted');
  if (criteria.excludeCustomerIds?.includes(id)) reasons.push('explicitly_excluded');
  if (criteria.excludeStages?.includes(String(customer.stage || ''))) reasons.push(`excluded_stage:${customer.stage}`);
  if (criteria.includeCustomerIds?.length && !criteria.includeCustomerIds.includes(id)) reasons.push('not_in_explicit_allowlist');
  const tags = list(customer.tags), tagsUnknown=!Array.isArray(customer.tags)||customer.classificationStatus==='pending';
  if(criteria.tagsNone?.length&&tagsUnknown)reasons.push('unknown:tags_none');
  if (criteria.tagsNone?.some(t => tags.includes(t))) reasons.push('excluded_tag');
  if(criteria.managementAction==='draft'&&['messenger','instagram'].includes(String(customer.source))&&!customer.weeklyChannelSelection)reasons.push('native_channel_selection_required');
  const tests: Array<{ passes: boolean; reason: string; unknown: boolean }> = [];
  const add = (applies: boolean, passes: boolean, reason: string, unknown = false) => { if (applies) tests.push({ passes: !unknown && passes, reason, unknown }); };
  const member = (choices: string[] | undefined, value: unknown, field: string) => add(Boolean(choices?.length), choices?.includes(String(value)) ?? false, field, value === undefined || value === null || value === '' || value === 'unknown' && !choices?.includes('unknown'));
  member(criteria.stages, customer.stage, 'stage'); member(criteria.handlingModes, customer.handlingMode, 'handling_mode');
  member(criteria.bantLevels, bant.level ?? bant.qualification_level, 'bant'); member(criteria.sources, customer.source, 'source');
  member(criteria.countries, customer.countryName, 'country'); member(criteria.languages, customer.language, 'language');
  member(criteria.relationships, facts.relationship, 'relationship'); member(criteria.waitingFor, facts.waitingFor, 'waiting_for');
  add(criteria.purchase !== undefined, facts.purchase === criteria.purchase, 'purchase', facts.purchase === undefined || facts.purchase==='unknown'&&criteria.purchase!=='unknown');
  add(criteria.productIds?.length !== undefined && criteria.productIds.length > 0, criteria.productIds?.some(p => list(facts.productIds).includes(p)) ?? false, 'product', !Array.isArray(facts.productIds));
  add(criteria.minIntentScore !== undefined, Number(customer.intentScore) >= Number(criteria.minIntentScore), `intent_score_min:${criteria.minIntentScore}`, customer.intentScore === undefined);
  add(criteria.maxIntentScore !== undefined, Number(customer.intentScore) <= Number(criteria.maxIntentScore), `intent_score_max:${criteria.maxIntentScore}`, customer.intentScore === undefined);
  add(Boolean(criteria.tags?.length), criteria.tags?.some(t => tags.includes(t)) ?? false, 'matching_tag', tagsUnknown);
  add(Boolean(criteria.tagsAll?.length), criteria.tagsAll?.every(t => tags.includes(t)) ?? false, 'tags_all', tagsUnknown);
  add(Boolean(criteria.tagsAny?.length), criteria.tagsAny?.some(t => tags.includes(t)) ?? false, 'tags_any', tagsUnknown);
  const inbound = Number(facts.lastBuyerAt ?? customer.lastActiveAt), validTime = Number.isFinite(inbound) && inbound > 0 && inbound <= now;
  const silent = (now - inbound) / 86_400_000;
  add(criteria.activeWithinDays !== undefined, silent <= Number(criteria.activeWithinDays), `active_within_days:${criteria.activeWithinDays}`, !validTime);
  add(criteria.inactiveDaysMin !== undefined, silent >= Number(criteria.inactiveDaysMin), 'inactive_days_min', !validTime);
  add(criteria.inactiveDaysMax !== undefined, silent <= Number(criteria.inactiveDaysMax), 'inactive_days_max', !validTime);
  const matches = !tests.length || (criteria.match === 'any' ? tests.some(t => t.passes) : tests.every(t => t.passes));
  // Unknown evidence never widens a group through an OR predicate.
  const unknownReasons = tests.filter(t => t.unknown).map(t => `unknown:${t.reason}`);
  const included = !reasons.length && matches && !unknownReasons.length;
  return { included, inclusionReasons: included ? tests.filter(t => t.passes).map(t => t.reason) : [],
    exclusionReasons: included ? [] : [...reasons, ...unknownReasons, ...tests.filter(t => !t.passes && !t.unknown).map(t => `criteria_mismatch:${t.reason}`)] };
}
