import type {
  DigitalEmployeeApprovalDecisionApplication,
} from '../digitalEmployees/approvalDecision.js';
import {
  decideDigitalEmployeeApproval,
  DigitalEmployeeApprovalDecisionError,
} from '../digitalEmployees/approvalDecision.js';
import {
  Starter198RuntimePortError,
  type Starter198ApprovalDecisionPort,
} from './runtimePorts.js';

/** Adapt the canonical Digital Employee approval use case to the starter command port. */
export function createStarter198ApprovalDecisionPort(
  decideApproval: DigitalEmployeeApprovalDecisionApplication = decideDigitalEmployeeApproval,
): Starter198ApprovalDecisionPort {
  return {
    async decide(input) {
      try {
        const result = await decideApproval({
          tenantId: input.tenantId,
          userId: input.userId,
          approvalId: input.approvalId,
          expectedSubjectVersion: input.expectedSubjectVersion,
          decision: input.decision,
          note: input.note,
          policy: 'starter_198',
        });
        return { state: result.state, decision: result.decision };
      } catch (error) {
        if (error instanceof DigitalEmployeeApprovalDecisionError) {
          throw new Starter198RuntimePortError(error.code, error.status);
        }
        throw error;
      }
    },
  };
}
