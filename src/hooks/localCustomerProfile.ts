import {applyTagCorrections, protectedCustomerTag, readTagCorrections} from '../../shared/contracts/customerTags';
import {hasLocalCustomerProfileResult, pendingLocalCustomerProfile} from '../../shared/contracts/localCustomerProfile';
import type {CustomerProfile} from '../types/customer';

function olderAnalysis(customer: CustomerProfile, patch: Partial<CustomerProfile>) {
  const current = Date.parse(customer.profileAnalysisUpdatedAt || '');
  const incoming = Date.parse(patch.profileAnalysisUpdatedAt || '');
  if (!Number.isFinite(current) || !patch.localSimulation) return false;
  if (!Number.isFinite(incoming)) return true;
  if (incoming !== current) return incoming < current;
  return customer.profileAnalysisStatus === 'succeeded' && patch.profileAnalysisStatus !== 'succeeded'
    && customer.profileAnalysisBuyerFingerprint === patch.profileAnalysisBuyerFingerprint;
}

/** Restore explicit server analysis, preserving local drafts, translations and newer corrections. */
export function restoreLocalCustomerPatch(customer: CustomerProfile, incoming: Partial<CustomerProfile>, polling = false): CustomerProfile {
  const stale = olderAnalysis(customer, incoming);
  const patch = stale ? {contextTagCorrections:incoming.contextTagCorrections} : incoming;
  const {pendingDraft, ...rest} = patch;
  const incomingCorrections = readTagCorrections(patch.contextTagCorrections);
  const corrections = new Map(readTagCorrections(customer.contextTagCorrections).map(item => [item.tag, item]));
  const obsoleteReplacements = new Set<string>();
  for (const incoming of incomingCorrections) {
    const current = corrections.get(incoming.tag);
    if (!current || Date.parse(incoming.updatedAt) > Date.parse(current.updatedAt)) {
      if (current?.replacement && current.replacement !== incoming.replacement) obsoleteReplacements.add(current.replacement);
      corrections.set(incoming.tag, incoming);
    } else if (incoming.replacement && incoming.replacement !== current.replacement) obsoleteReplacements.add(incoming.replacement);
  }
  const contextTagCorrections = [...corrections.values()];
  const tags = applyTagCorrections([...(patch.tags || customer.tags).filter(tag => !obsoleteReplacements.has(tag)), ...customer.tags.filter(protectedCustomerTag)], contextTagCorrections);
  const merged = {...customer, ...rest, contextTagCorrections, tags, ...(!polling && 'pendingDraft' in patch ? {pendingDraft} : {})};
  if (!patch.timeline || !patch.localSimulation) return merged;
  const timeline = patch.timeline.map(turn => {
    const existing = customer.timeline.find(item => item.id === turn.id && item.body === turn.body);
    return existing?.translatedBody && !turn.translatedBody ? {...turn, translatedBody:existing.translatedBody} : turn;
  });
  if (hasLocalCustomerProfileResult(merged)) {
    const mismatch = merged.profileAnalysisStatus === 'succeeded' && merged.profileAnalysisResultFingerprint !== merged.profileAnalysisBuyerFingerprint;
    return {...merged, ...(mismatch ? {profileAnalysisStatus:'failed' as const,profileAnalysisErrorCode:'profile_analysis_fingerprint_mismatch'} : {}), timeline};
  }
  const pending = pendingLocalCustomerProfile({...merged, timeline});
  return {...merged, ...pending, profileAnalysisStatus: patch.profileAnalysisStatus === 'succeeded' ? 'failed' : patch.profileAnalysisStatus || 'pending', profileAnalysisErrorCode: patch.profileAnalysisStatus === 'succeeded' ? 'profile_analysis_result_invalid' : merged.profileAnalysisErrorCode, timeline};
}
