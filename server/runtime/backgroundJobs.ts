import { store } from '../storage/index.js';
import { createSocialWeeklyPlanningAdapter, initSocialWeeklyExecutionRuntime, WEEKLY_PREPRODUCTION_STEPS } from './socialWeeklyExecutionRuntime.js';
import { createSocialWeeklyProductionAdapter, WEEKLY_PRODUCTION_STEPS } from './socialWeeklyProductionAdapter.js';
import { createSocialWeeklyPublicationAdapter } from './socialWeeklyPublicationAdapter.js';
import { createWeeklyContentTemplateExecutionAdapter } from './socialWeeklyContentTemplateAdapter.js';
import { createSocialWeeklyCustomerChannelAdapter } from './socialWeeklyCustomerChannelAdapter.js';
import type { WeeklyProductionStepKind } from '../../shared/contracts/socialProgram.js';
import type { SocialWeeklyExecutionAdapter } from './socialWeeklyExecutionAdapter.js';
import { initDigitalEmployeeRuntime } from '../digitalEmployees/runtimeOrchestrator.js';
import { initFollowupDispatchWorker } from '../digitalEmployees/followupDispatchWorker.js';
import { initScheduledPublisher } from '../publishing/scheduledPublisher.js';
import { initStarterPublicationPackageWorker } from '../starter198/publicationPackageWorker.js';
import { initStarterQuoteArtifactWorker } from '../starter198/quoteArtifactWorker.js';
import { initSocialContentManagedRecovery } from '../starter198/socialContentManagedRecovery.js';
import { initStarter198OrchestratorWorker } from '../starter198/orchestratorWorker.js';
import { initCrawlWorkerCloudFallback } from '../routes/crawlWorker.js';
import { initScheduler } from '../routes/scheduler.js';
import { initTenantPlatformTokenMonitor } from '../routes/tenantPlatformTokenMonitor.js';
import { initCrawlerOpsWorker, initPocketBaseVideoBackfill } from '../routes/videos.js';
import { initWhatsAppCustomerMaintenance } from '../whatsapp/historyImport.js';
import { startAdAutomationWorker } from '../platformAds/automation.js';
import { initWeeklyPublicationPackageWorker } from '../publishing/weeklyPublicationWorker.js';
import { initEngagementIngestionWorker } from '../socialEngagement/ingestionWorker.js';
import { initAgentNotificationOutboxWorker } from '../notifications/agentNotificationOutbox.js';
import { initSocialWeeklyReviewWorker } from '../socialReview/weeklyReviewWorker.js';
import type { ProcessRole } from './processRole.js';
import { initLocalTempMaintenance } from '../storage/localTempMaintenance.js';
import { initSocialContentProductionBullWorker } from '../starter198/socialContentProductionQueue.js';
import { initSocialSceneReworkCompletionRecovery } from './socialSceneReworkCompletionRuntime.js';
import {
  markBackgroundJobsFailed,
  markBackgroundJobsReady,
  markBackgroundJobsStarting,
  startWorkerHeartbeat,
  writeWorkerHeartbeat,
} from './workerHeartbeat.js';

export async function startBackgroundJobs(role: ProcessRole = 'all'): Promise<void> {
  if (role === 'web') throw new Error('background_jobs_forbidden_for_web_role');
  markBackgroundJobsStarting();
  console.log('[runtime] starting background jobs');
  try {
    await initScheduler();
    initLocalTempMaintenance();
    initSocialContentProductionBullWorker();
    initSocialSceneReworkCompletionRecovery();
    initScheduledPublisher();
    initCrawlerOpsWorker();
    initPocketBaseVideoBackfill();
    initCrawlWorkerCloudFallback();
    initTenantPlatformTokenMonitor();
    await initWhatsAppCustomerMaintenance();
    initFollowupDispatchWorker();
    initStarterPublicationPackageWorker();
    initStarterQuoteArtifactWorker();
    initStarter198OrchestratorWorker();
    initSocialContentManagedRecovery();
    startAdAutomationWorker();
    initWeeklyPublicationPackageWorker();
    initEngagementIngestionWorker();
    initAgentNotificationOutboxWorker();
    initSocialWeeklyReviewWorker();
    const planningAdapter = createSocialWeeklyPlanningAdapter(store);
    const productionAdapter = createSocialWeeklyProductionAdapter(store);
    const publicationAdapter = createSocialWeeklyPublicationAdapter(store);
    const templateAdapter = createWeeklyContentTemplateExecutionAdapter(store);
    const customerChannelAdapter = createSocialWeeklyCustomerChannelAdapter(store);
    const weeklyAdapters: Partial<Record<WeeklyProductionStepKind, SocialWeeklyExecutionAdapter>> = {};
    for (const step of WEEKLY_PREPRODUCTION_STEPS) weeklyAdapters[step] = planningAdapter;
    for (const step of WEEKLY_PRODUCTION_STEPS) weeklyAdapters[step] = productionAdapter;
    for (const step of ['publishing', 'performance_monitoring', 'weekly_review'] as const) weeklyAdapters[step] = publicationAdapter;
    for (const step of ['template_extraction', 'template_performance_validation'] as const) weeklyAdapters[step] = templateAdapter;
    for (const step of ['customer_channel_readiness', 'customer_inquiry_handoff'] as const) weeklyAdapters[step] = customerChannelAdapter;
    initSocialWeeklyExecutionRuntime(weeklyAdapters);
    initDigitalEmployeeRuntime();
    markBackgroundJobsReady();
    await startWorkerHeartbeat(role);
    console.log('[runtime] background jobs started');
  } catch (error) {
    markBackgroundJobsFailed(error);
    await writeWorkerHeartbeat(role).catch(() => undefined);
    throw error;
  }
}
