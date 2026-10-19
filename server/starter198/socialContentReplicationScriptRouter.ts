import { Router, type NextFunction, type Request, type Response } from 'express';
import type { Starter198Repository } from './repository.js';
import {
  adaptSocialReplicationProductOnly,
  confirmSocialReplicationScript,
  readSocialReplicationScriptReviewContext,
} from './socialContentReplicationScriptReview.js';
import {
  SocialContentWorkflowError,
  requireIdempotencyKey,
  requireSocialId,
  socialObject,
} from './socialContentValidation.js';

type Authorize = (req: Request, res: Response, level: 'read' | 'write') =>
  Promise<{ tenantId: string; userId: string }>;
type AsyncRoute = (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => void;

function bodyWithinLimit(req: Request, maximum = 256 * 1_024): void {
  if (Buffer.byteLength(JSON.stringify(req.body ?? {}), 'utf8') > maximum) {
    throw new SocialContentWorkflowError('social_content_request_too_large', 413);
  }
}

export function createSocialContentReplicationScriptRouter(input: {
  repository: Starter198Repository;
  authorize: Authorize;
  asyncRoute: AsyncRoute;
  now: () => Date;
}): Router {
  const router = Router({ mergeParams: true });
  router.get('/tasks/:taskId/replication-script/review-context', input.asyncRoute(async (req, res) => {
    const identity = await input.authorize(req, res, 'read');
    res.json(await readSocialReplicationScriptReviewContext({ repository: input.repository,
      tenantId: identity.tenantId, taskId: requireSocialId(req.params.taskId) }));
  }));
  router.post('/tasks/:taskId/replication-script/confirm', input.asyncRoute(async (req, res) => {
    const identity = await input.authorize(req, res, 'write');
    bodyWithinLimit(req);
    const source = socialObject(req.body);
    if (!source || Object.keys(source).some(key => ![
      'expectedVersion', 'analysisId', 'analysisHash', 'scriptHash', 'sceneDecisions', 'reviewEvidence',
    ].includes(key))) throw new SocialContentWorkflowError('social_replication_script_review_invalid', 400);
    const task = await confirmSocialReplicationScript({ repository: input.repository, ...identity,
      taskId: requireSocialId(req.params.taskId),
      idempotencyKey: requireIdempotencyKey(req.headers['idempotency-key']),
      value: source as unknown as Parameters<typeof confirmSocialReplicationScript>[0]['value'], now: input.now() });
    res.json({ task });
  }));
  router.post('/tasks/:taskId/replication-script/adapt-product-only', input.asyncRoute(async (req, res) => {
    const identity = await input.authorize(req, res, 'write');
    bodyWithinLimit(req);
    const source = socialObject(req.body);
    if (!source || Object.keys(source).some(key => ![
      'expectedVersion', 'scriptHash', 'materialSourceId', 'materialSourceVersion',
    ].includes(key))) throw new SocialContentWorkflowError('social_replication_product_adaptation_invalid', 400);
    const task = await adaptSocialReplicationProductOnly({ repository: input.repository, ...identity,
      taskId: requireSocialId(req.params.taskId),
      idempotencyKey: requireIdempotencyKey(req.headers['idempotency-key']),
      value: source as unknown as Parameters<typeof adaptSocialReplicationProductOnly>[0]['value'], now: input.now() });
    res.json({ task });
  }));
  return router;
}
