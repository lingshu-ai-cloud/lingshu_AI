import { assessTransformation, buildPersonExecutionStrategy, type PersonExecutionStrategyInput, type TransformationAssessmentInput } from '../lib/creativeTransformation.js';

import type { StudioApplicationPorts } from '../studio/applicationPorts.js';

export function createStudioTransformationRoutes(deps: Pick<StudioApplicationPorts, 'studioRouter'>) {
  const studioRouter = deps.studioRouter;

  function registerPostTransformationsAssess() {
    studioRouter.post('/transformations/assess', (req, res) => {
      try {
        const input = req.body as TransformationAssessmentInput;
        if (!input || !input.mode || !input.rights || !input.source) {
          res.status(400).json({ ok: false, error: '缺少替换模式、授权声明或源素材指标' });
          return;
        }
        res.json({ ok: true, assessment: assessTransformation(input) });
      } catch (error) {
        res.status(400).json({ ok: false, error: error instanceof Error ? error.message : '替换兼容性评估失败' });
      }
    });
  }

  function registerPostPersonReplacementPlan() {
    studioRouter.post('/person-replacement/plan', (req, res) => {
      try {
        const input = req.body as PersonExecutionStrategyInput;
        if (!input || !input.requestedMode || !input.sourceKind || !input.rights || !input.source) {
          res.status(400).json({ ok: false, error: '缺少人物处理方式、来源、授权声明或源素材指标' });
          return;
        }
        res.json({ ok: true, strategy: buildPersonExecutionStrategy(input) });
      } catch (error) {
        res.status(400).json({ ok: false, error: error instanceof Error ? error.message : '人物执行方案生成失败' });
      }
    });
  }

  return { registerPostTransformationsAssess, registerPostPersonReplacementPlan };
}
