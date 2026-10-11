import { createRequestGuard } from '../../shared/request-policy.mjs';

/** Account-scoped request locks supplied by the platform-independent request policy. */
export const createAssistantDecisionRequestGuard = createRequestGuard;
