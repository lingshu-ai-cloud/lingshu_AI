import type { Request } from 'express';
import type { AuthLocals } from '../middleware/auth.js';
import { requestOrganizationRoleStrict } from '../lib/organizationRole.js';
import { starter198OrgRole } from './profile.js';
import { starter198Repository, type Starter198Repository } from './repository.js';
import {
  SocialContentAccessError,
  socialContentAccessResolver,
  type SocialContentAccessResolver,
} from './socialContentAccess.js';
import { SocialContentWorkflowError } from './socialContentValidation.js';

export type SocialContentAccessLevel = 'read' | 'write' | 'start';

/** Shared authorization gate for every entry into the canonical social-content workflow. */
export async function authorizeSocialContentRequest(input: {
  request: Request;
  identity: Pick<AuthLocals, 'tenantId' | 'userId'>;
  level: SocialContentAccessLevel;
  repository: Starter198Repository;
  resolveRole: (request: Request, userId: string) => Promise<unknown>;
  accessResolver: SocialContentAccessResolver;
  now: Date;
}): Promise<{ tenantId: string; userId: string }> {
  const { tenantId, userId } = input.identity;
  const role = starter198OrgRole(await input.resolveRole(input.request, userId));
  if (!role) throw new SocialContentWorkflowError('starter_198_role_required', 403);
  if (input.level !== 'read' && !['owner', 'admin', 'operator'].includes(role)) {
    throw new SocialContentWorkflowError('social_content_write_forbidden', 403);
  }
  const required = input.level === 'read'
    ? ['workspace.read', 'production_site.read'] as const
    : input.level === 'start'
      ? ['orchestrator.command.submit', 'workflow.standard.run'] as const
      : ['orchestrator.command.submit'] as const;
  try {
    await input.accessResolver.resolve({
      repository: input.repository, tenantId, requiredCapabilities: required, now: input.now,
    });
  } catch (error) {
    if (error instanceof SocialContentAccessError) {
      throw new SocialContentWorkflowError(error.code, error.status);
    }
    throw error;
  }
  return { tenantId, userId };
}

export function authorizeDefaultSocialContentRequest(
  request: Request,
  identity: Pick<AuthLocals, 'tenantId' | 'userId'>,
  level: SocialContentAccessLevel,
) {
  return authorizeSocialContentRequest({
    request, identity, level, repository: starter198Repository,
    resolveRole: (req, userId) => requestOrganizationRoleStrict(req.headers.authorization, userId),
    accessResolver: socialContentAccessResolver, now: new Date(),
  });
}
