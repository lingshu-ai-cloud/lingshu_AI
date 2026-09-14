import { QuotationError } from '../quotation/errors.js';
import { QuotationService } from '../quotation/service.js';
import { store } from '../storage/index.js';
import {
  Starter198RuntimePortError,
  type Starter198QuoteEvidencePort,
} from './runtimePorts.js';
import { currentStarterQuoteArtifact, type StarterQuoteArtifact } from './quoteArtifact.js';

type QuoteEvidenceService = Pick<QuotationService, 'recordExternalSendEvidence'>;
type QuoteArtifactReader = (input: {
  tenantId: string;
  draftId: string;
  expectedInputHash?: string;
}) => Promise<StarterQuoteArtifact | null>;

/** Records a customer's manual-send assertion; it never invokes a provider. */
export function createStarter198QuoteEvidencePort(
  service: QuoteEvidenceService = new QuotationService(store),
  readArtifact: QuoteArtifactReader = currentStarterQuoteArtifact,
): Starter198QuoteEvidencePort {
  return {
    async record(input) {
      try {
        const artifact = await readArtifact({
          tenantId: input.tenantId,
          draftId: input.draftId,
          expectedInputHash: input.expectedInputHash,
        });
        if (!artifact) throw new Starter198RuntimePortError('starter_198_quote_artifact_not_ready', 409);
        const result = await service.recordExternalSendEvidence(
          {
            tenantId: input.tenantId,
            userId: input.userId,
            role: input.role === 'owner' ? 'super_admin'
              : input.role === 'operator' ? 'social_operator'
                : input.role,
          },
          input.draftId,
          `${input.idempotencyKey}:quote-send-evidence`,
          {
            channel: input.channel,
            artifactHash: artifact.sha256,
            providerReference: input.providerReference,
          },
          input.expectedInputHash,
        );
        return { evidenceId: result.id, status: result.status };
      } catch (error) {
        if (error instanceof Starter198RuntimePortError) throw error;
        if (error instanceof QuotationError) {
          throw new Starter198RuntimePortError(error.code, error.status);
        }
        throw new Starter198RuntimePortError('quotation_persistence_unavailable', 503);
      }
    },
  };
}
