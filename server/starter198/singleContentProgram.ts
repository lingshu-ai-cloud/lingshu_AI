import type { Starter198Repository } from './repository.js';
import type { SocialContentTaskBrief } from '../../shared/contracts/socialContentWorkflow.js';
import { createSocialProgramService } from '../socialPrograms/service.js';
import { withSocialContentSubjectLease } from './socialContentMutation.js';
import { readTenantEnterpriseProfile } from '../lib/socialContentLegacyPorts.js';
import { SocialContentWorkflowError } from './socialContentValidation.js';

/** The confirmed single-task form already contains market/audience/platform.
 * Reuse the existing program/quota domain; never mint a quota for every task. */
export async function ensureSingleContentProgram(input: {
  repository: Starter198Repository; tenantId: string; userId: string; brief: SocialContentTaskBrief;
  readProfile?: typeof readTenantEnterpriseProfile;
}): Promise<string> {
  const store = input.repository.dataStore;
  if (!store || !input.brief.singleCreationRequestHash) throw new SocialContentWorkflowError('social_content_order_program_selection_required', 409);
  return withSocialContentSubjectLease({ repository: input.repository, tenantId: input.tenantId,
    subjectId: 'single-content-enterprise-program', action: async () => {
      const rows = await store.list<{ program_id: string }>('social_programs', { where: { tenant_id: input.tenantId }, perPage: 2 });
      if (rows.totalItems === 1 && rows.items.length === 1) return rows.items[0]!.program_id;
      if (rows.totalItems) throw new SocialContentWorkflowError('social_content_order_program_selection_required', 409);
      const profile = await (input.readProfile || readTenantEnterpriseProfile)(input.tenantId);
      const brandName = profile?.brand?.name || profile?.company?.name;
      const market = input.brief.markets?.join('、'), targetAudience = input.brief.audience;
      if (!brandName || !market || !targetAudience || !input.brief.platforms?.length)
        throw new SocialContentWorkflowError('single_content_program_foundation_required', 409);
      const program = await createSocialProgramService(store).createProgram(input.tenantId, input.userId,
        { brandName, market, targetAudience, candidatePlatforms: input.brief.platforms });
      return program.programId;
    } });
}
