import { createDefaultWeeklyExecutionAdapters } from './weeklyExecutionAdapters.js';
import {localWeeklyExecutionRuntime} from './localWeeklyExecutionRuntime.js';
import {contentOrderOutboxRuntime,localContentOrderOutboxRuntime} from './socialContentOrderOutboxRuntime.js';
import { store } from '../storage/index.js';
import { initSocialWeeklyExecutionRuntime,type WeeklyTrustedPreproductionPorts } from './socialWeeklyExecutionRuntime.js';
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
import { weeklyDiscoveryScopeMigrationRecoveryRuntime } from './weeklyDiscoveryScopeMigrationRecoveryRuntime.js';
import { initInitialPreparationWorker, stopInitialPreparationWorker } from '../routes/digitalEmployees.js';
import {
  markBackgroundJobsFailed,
  markBackgroundJobsReady,
  markBackgroundJobsStarting,
  startWorkerHeartbeat,
  writeWorkerHeartbeat,
} from './workerHeartbeat.js';
import {createDefaultWeeklyPreproductionPorts} from './defaultWeeklyPreproductionPorts.js';

export async function startBackgroundJobs(role: ProcessRole = 'all',options:{weeklyPreproductionPorts?:WeeklyTrustedPreproductionPorts}={}): Promise<() => void> {
  if (role === 'web') throw new Error('background_jobs_forbidden_for_web_role');
  let initialPreparationWorkerStarted = false;
  markBackgroundJobsStarting();
  console.log('[runtime] starting background jobs');
  try {
    const weeklyPreproductionPorts=options.weeklyPreproductionPorts??createDefaultWeeklyPreproductionPorts(store);
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
    initialPreparationWorkerStarted = initInitialPreparationWorker();
    localWeeklyExecutionRuntime.configureTrustedPreproductionPorts(weeklyPreproductionPorts);
    initSocialWeeklyExecutionRuntime(createDefaultWeeklyExecutionAdapters(store,{exactAnalysisPortsForRun:weeklyPreproductionPorts.candidatePorts?.exactAnalysisPortsForRun}),{preproductionPorts:weeklyPreproductionPorts});
    // Worker-only and database-leased. Receipt reconciliation starts in the
    // background so neither HTTP nor worker readiness waits on a full scan.
    weeklyDiscoveryScopeMigrationRecoveryRuntime.start();
    // Restoring an explicitly registered weekly consumer may immediately make
    // real provider calls.  It must not hold the HTTP process startup hostage;
    // the runtime persists its own observation and keeps retrying on its timer.
    void localWeeklyExecutionRuntime.start().catch(() => {
      console.error('[runtime] scoped local recovery unavailable; see health.localWeeklyRecovery');
    });
    contentOrderOutboxRuntime.start();
    localContentOrderOutboxRuntime.start();
    initDigitalEmployeeRuntime();
    markBackgroundJobsReady();
    await startWorkerHeartbeat(role);
    console.log('[runtime] background jobs started');
    return () => {
      weeklyDiscoveryScopeMigrationRecoveryRuntime.stop();
      localWeeklyExecutionRuntime.stop();
      contentOrderOutboxRuntime.stop();
      localContentOrderOutboxRuntime.stop();
      if (initialPreparationWorkerStarted) stopInitialPreparationWorker();
    };
  } catch (error) {
    weeklyDiscoveryScopeMigrationRecoveryRuntime.stop();
    localWeeklyExecutionRuntime.stop();
    contentOrderOutboxRuntime.stop();
    localContentOrderOutboxRuntime.stop();
    if (initialPreparationWorkerStarted) stopInitialPreparationWorker();
    markBackgroundJobsFailed(error);
    await writeWorkerHeartbeat(role).catch(() => undefined);
    throw error;
  }
}
