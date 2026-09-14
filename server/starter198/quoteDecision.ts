import { QuotationError } from '../quotation/errors.js';
import { QuotationService } from '../quotation/service.js';
import { store } from '../storage/index.js';
import {
  Starter198RuntimePortError,
  type Starter198QuoteDecisionPort,
} from './runtimePorts.js';
import { ensureStarterQuoteArtifact } from './quoteArtifact.js';

type QuoteDecisionService = Pick<QuotationService, 'decideDraft'>;
type QuoteArtifactFactory = typeof ensureStarterQuoteArtifact;

/** Composition adapter for the only customer-facing quote decision path. */
export function createStarter198QuoteDecisionPort(
  injectedService?: QuoteDecisionService,
  injectedArtifactFactory?: QuoteArtifactFactory,
): Starter198QuoteDecisionPort {
  const service = injectedService ?? new QuotationService(store);
  const artifactFactory = injectedArtifactFactory ?? (injectedService ? null : ensureStarterQuoteArtifact);
  return {
    async decide(input) {
      try {
        await service.decideDraft(
          {
            tenantId: input.tenantId,
            userId: input.userId,
            role: input.role === 'owner' ? 'super_admin' : 'admin',
          },
          input.draftId,
          `${input.idempotencyKey}:quote-decision`,
          input.decision,
          input.note,
          input.expectedInputHash,
        );
        if (input.decision !== 'approved') return { artifactId: null, artifactPending: false };
        if (!artifactFactory) return { artifactId: null, artifactPending: true };
        try {
          const artifact = await artifactFactory({
            tenantId: input.tenantId,
            userId: input.userId,
            draftId: input.draftId,
            expectedInputHash: input.expectedInputHash,
            idempotencyKey: `${input.idempotencyKey}:quote-artifact`,
            ...(service instanceof QuotationService ? { quotationService: service } : {}),
          });
          return { artifactId: artifact.artifact.artifactId, artifactPending: false };
        } catch (artifactError) {
          // Approval is already an immutable business event. Artifact creation
          // is repaired by the deterministic background worker and must not
          // turn an approved quote into a failed/replayable decision command.
          console.error('[starter-quote] approved; artifact pending:', artifactError instanceof Error ? artifactError.message : artifactError);
          return { artifactId: null, artifactPending: true };
        }
      } catch (error) {
        if (error instanceof QuotationError) {
          throw new Starter198RuntimePortError(error.code, error.status);
        }
        throw new Starter198RuntimePortError('quotation_persistence_unavailable', 503);
      }
    },
  };
}
