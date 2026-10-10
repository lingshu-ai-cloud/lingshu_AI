import { json, Router, type Request } from 'express';
import { requestOrganizationRoleStrict } from '../lib/organizationRole.js';
import { enforceSupportSessionReadOnly, requireAuth, type AuthLocals } from '../middleware/auth.js';
import {
  parseStarter198CommandInput,
  runStarter198Command,
  Starter198CommandError,
  type Starter198CommandDependencies,
} from './commands.js';
import { starter198OrgRole } from './profile.js';
import { buildStarter198CapabilityManifest, starter198CapabilityAllowed } from './profile.js';
import { readStarterPublicationPackage } from '../publishing/starterPublicationPackage.js';
import { Starter198RepositoryError, starter198Repository, type Starter198Repository } from './repository.js';
import { buildStarter198Workspace } from './workspace.js';
import { createStarter198QuoteDecisionPort } from './quoteDecision.js';
import { createStarter198ApprovalDecisionPort } from './approvalDecision.js';
import { createStarter198QuoteEvidencePort } from './quoteEvidence.js';
import { createStarter198QuoteSelfServicePort } from './quoteSelfService.js';
import { readStarterQuoteArtifact, type StarterQuoteArtifact } from './quoteArtifact.js';
import { createStarter198OrchestratorQueue } from './orchestratorQueue.js';
import { createStarter198InitialSetupPort } from './initialSetup.js';
import {
  readStarterProductionModel,
  type StarterProductionReadModel,
} from './productionReadModel.js';
import { createSocialContentRouter } from './socialContentRouter.js';

export interface Starter198RouterDependencies extends Starter198CommandDependencies {
  mobileWorkbench?: {
    queueRouter: (workspace: (req: Request, res: import('express').Response) => ReturnType<typeof buildStarter198Workspace>) => Router;
    transcribe: (req: Request, res: import('express').Response) => Promise<void>;
  };
  repository?: Starter198Repository;
  resolveRole?: (request: Request, userId: string) => Promise<unknown>;
  readProductionModel?: (tenantId: string) => Promise<StarterProductionReadModel>;
  readQuoteArtifact?: (input: {
    tenantId: string;
    artifactId: string;
    repository?: Starter198Repository;
  }) => Promise<StarterQuoteArtifact | null>;
}

function statusForRepositoryError(error: Starter198RepositoryError): number {
  return error.code === 'starter_198_not_provisioned' ? 403 : 503;
}

function sendFailure(res: import('express').Response, error: unknown): void {
  if (error instanceof Starter198CommandError) {
    res.status(error.status).json({ error: error.code, message: error.message });
    return;
  }
  if (error instanceof Starter198RepositoryError) {
    const publicCode = error.code === 'starter_198_not_provisioned' ? 'profile_not_enabled' : error.code;
    res.status(statusForRepositoryError(error)).json({ error: publicCode, message: publicCode });
    return;
  }
  const code = error instanceof Error && [
    'starter_198_workspace_not_entitled',
    'starter_198_role_required',
    'starter_198_workspace_projection_incomplete',
  ].includes(error.message) ? error.message : 'starter_198_unavailable';
  res.status(['starter_198_workspace_not_entitled', 'starter_198_role_required'].includes(code) ? 403 : 503).json({ error: code, message: code });
}

export function createStarter198Router(dependencies: Starter198RouterDependencies = {}): Router {
  const router = Router();
  const repository = dependencies.repository ?? starter198Repository;
  const resolveRole = dependencies.resolveRole
    ?? ((request: Request, userId: string) => requestOrganizationRoleStrict(request.headers.authorization, userId));
  router.use(requireAuth);

  router.use('/social-content', createSocialContentRouter({
    repository,
    orchestratorQueue: dependencies.orchestratorQueue,
    resolveRole,
  }));

  const mobileWorkspace = async (req: Request, res: import('express').Response) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const role = starter198OrgRole(await resolveRole(req, userId));
    if (!role) throw new Error('starter_198_role_required');
    return buildStarter198Workspace({ tenantId, role, repository,
      now: dependencies.now?.(), orchestratorAvailable: Boolean(dependencies.orchestratorQueue),
      decisionAvailable: Boolean(dependencies.approvalDecision), quoteDecisionAvailable: Boolean(dependencies.quoteDecision),
      quoteEvidenceAvailable: Boolean(dependencies.quoteEvidence), quoteSelfServiceAvailable: Boolean(dependencies.quoteSelfService),
      setupAvailable: Boolean(dependencies.initialSetup), loadProductionReadModel: dependencies.readProductionModel });
  };
  if (dependencies.mobileWorkbench) router.use('/mobile', dependencies.mobileWorkbench.queueRouter(mobileWorkspace));

  if (dependencies.mobileWorkbench) router.post('/mobile/transcribe', json({limit:'3mb'}), enforceSupportSessionReadOnly, async (req, res) => {
    try { await mobileWorkspace(req, res); await dependencies.mobileWorkbench!.transcribe(req, res); } catch (error) { sendFailure(res, error); }
  });

  router.get('/workspace', async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const { tenantId, userId } = res.locals as AuthLocals;
    try {
      const role = starter198OrgRole(await resolveRole(req, userId));
      if (!role) { res.status(403).json({ error: 'starter_198_role_required' }); return; }
      res.json(await buildStarter198Workspace({
        tenantId,
        role,
        repository,
        now: dependencies.now?.(),
        orchestratorAvailable: Boolean(dependencies.orchestratorQueue),
        decisionAvailable: Boolean(dependencies.approvalDecision),
        quoteDecisionAvailable: Boolean(dependencies.quoteDecision),
        quoteEvidenceAvailable: Boolean(dependencies.quoteEvidence),
        quoteSelfServiceAvailable: Boolean(dependencies.quoteSelfService),
        setupAvailable: Boolean(dependencies.initialSetup),
        loadProductionReadModel: dependencies.readProductionModel,
      }));
    } catch (error) {
      sendFailure(res, error);
    }
  });

  router.get('/publication-packages/:packageId/download', async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const { tenantId, userId } = res.locals as AuthLocals;
    try {
      const role = starter198OrgRole(await resolveRole(req, userId));
      if (!role) { res.status(403).json({ error: 'starter_198_role_required' }); return; }
      const packageId = String(req.params.packageId || '').trim();
      if (!/^[a-z0-9:_-]{1,200}$/i.test(packageId)) {
        res.status(400).json({ error: 'publication_package_id_invalid' }); return;
      }
      const access = await repository.access(tenantId);
      const manifest = buildStarter198CapabilityManifest(access);
      if (!starter198CapabilityAllowed(manifest, 'workspace.read')
        || !starter198CapabilityAllowed(manifest, 'production_site.read')) {
        res.status(403).json({ error: 'starter_198_workspace_not_entitled' }); return;
      }
      const publication = await (dependencies.readPublicationPackage ?? readStarterPublicationPackage)(tenantId, packageId);
      if (!publication) { res.status(404).json({ error: 'publication_package_not_found' }); return; }
      if (publication.tenantId !== tenantId || publication.packageId !== packageId) {
        throw new Starter198RepositoryError('starter_198_storage_integrity_violation');
      }
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${packageId}.json"`);
      res.json(publication);
    } catch (error) {
      sendFailure(res, error);
    }
  });

  router.get('/quote-artifacts/:artifactId/download', async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const { tenantId, userId } = res.locals as AuthLocals;
    try {
      const role = starter198OrgRole(await resolveRole(req, userId));
      if (!role) { res.status(403).json({ error: 'starter_198_role_required' }); return; }
      const artifactId = String(req.params.artifactId || '').trim();
      if (!/^quote_artifact_[a-f0-9]{24}$/.test(artifactId)) {
        res.status(400).json({ error: 'starter_198_quote_artifact_id_invalid' }); return;
      }
      const access = await repository.access(tenantId);
      const manifest = buildStarter198CapabilityManifest(access);
      if (!starter198CapabilityAllowed(manifest, 'workspace.read')
        || !starter198CapabilityAllowed(manifest, 'production_site.read')) {
        res.status(403).json({ error: 'starter_198_workspace_not_entitled' }); return;
      }
      const artifact = await (dependencies.readQuoteArtifact ?? readStarterQuoteArtifact)({
        tenantId,
        artifactId,
        repository,
      });
      if (!artifact) { res.status(404).json({ error: 'starter_198_quote_artifact_not_found' }); return; }
      res.setHeader('Content-Type', artifact.mediaType);
      res.setHeader('Content-Disposition', `attachment; filename="${artifact.fileName}"`);
      res.setHeader('Content-Length', String(artifact.bytes.length));
      res.setHeader('ETag', `"sha256-${artifact.sha256}"`);
      res.status(200).send(artifact.bytes);
    } catch (error) {
      sendFailure(res, error);
    }
  });

  router.post('/commands', async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const { tenantId, userId } = res.locals as AuthLocals;
    try {
      if (Buffer.byteLength(JSON.stringify(req.body ?? {}), 'utf8') > 64 * 1024) {
        throw new Starter198CommandError('starter_198_command_too_large', 413);
      }
      const role = starter198OrgRole(await resolveRole(req, userId));
      if (!role) throw new Starter198CommandError('starter_198_role_required', 403);
      const request = parseStarter198CommandInput(req.body);
      const result = await runStarter198Command({
        tenantId,
        userId,
        role,
        request,
        dependencies: { ...dependencies, repository },
      });
      res.status(result.status).json(result.body);
    } catch (error) {
      sendFailure(res, error);
    }
  });

  return router;
}

export function createDefaultStarter198Router(mobileWorkbench?: Starter198RouterDependencies['mobileWorkbench']) {
  return createStarter198Router({
  mobileWorkbench,
  initialSetup: createStarter198InitialSetupPort(),
  orchestratorQueue: createStarter198OrchestratorQueue(),
  approvalDecision: createStarter198ApprovalDecisionPort(),
  quoteDecision: createStarter198QuoteDecisionPort(),
  quoteEvidence: createStarter198QuoteEvidencePort(),
  quoteSelfService: createStarter198QuoteSelfServicePort(),
  readProductionModel: readStarterProductionModel,
});
}

export const starter198Router = createDefaultStarter198Router();
