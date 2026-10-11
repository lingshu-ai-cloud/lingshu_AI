import type { DataStore } from '../storage/datastore.js';
import type { WeeklyProductionStepKind } from '../../shared/contracts/socialProgram.js';
import type { SocialWeeklyExecutionAdapter } from './socialWeeklyExecutionAdapter.js';
import { createSocialWeeklyPlanningAdapter, WEEKLY_PREPRODUCTION_STEPS } from './socialWeeklyExecutionRuntime.js';
import { createSocialWeeklyProductionAdapter, WEEKLY_PRODUCTION_STEPS } from './socialWeeklyProductionAdapter.js';
import { createSocialWeeklyPublicationAdapter } from './socialWeeklyPublicationAdapter.js';
import { createWeeklyContentTemplateExecutionAdapter } from './socialWeeklyContentTemplateAdapter.js';
import { createSocialWeeklyCustomerChannelAdapter } from './socialWeeklyCustomerChannelAdapter.js';
import { createWeeklyPublicationMetricProducerAdapter, type MetricProducerPorts } from './weeklyPublicationMetricProducer.js';
import { createWeeklyContentTemplateCandidateProducerAdapter } from './weeklyContentTemplateCandidateProducer.js';

/** The background worker and integration tests use the same adapter registration. */
export function createDefaultWeeklyExecutionAdapters(store: DataStore, options: { metrics?: MetricProducerPorts; templates?: { actorUserId?: string } } = {}) {
  const adapters: Partial<Record<WeeklyProductionStepKind, SocialWeeklyExecutionAdapter>> = {};
  const planning = createSocialWeeklyPlanningAdapter(store), production = createSocialWeeklyProductionAdapter(store);
  const publication = createSocialWeeklyPublicationAdapter(store), templates = createWeeklyContentTemplateExecutionAdapter(store);
  const customer = createSocialWeeklyCustomerChannelAdapter(store);
  for (const step of WEEKLY_PREPRODUCTION_STEPS) adapters[step] = planning;
  for (const step of WEEKLY_PRODUCTION_STEPS) adapters[step] = production;
  adapters.publishing = publication;
  adapters.weekly_review = publication;
  adapters.performance_monitoring = createWeeklyPublicationMetricProducerAdapter(store, options.metrics);
  adapters.template_extraction = createWeeklyContentTemplateCandidateProducerAdapter(store, options.templates);
  adapters.template_performance_validation = templates;
  adapters.customer_channel_readiness = customer;
  adapters.customer_inquiry_handoff = customer;
  return adapters;
}
