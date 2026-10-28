import assert from 'node:assert/strict';
import { finishedFilmBudgetDecision, finishedFilmBudgetQuoteKey } from './finishedFilmBudget.js';

assert.equal(finishedFilmBudgetDecision({ contentId: 'a', durationSeconds: 30, estimatedCostCny: 21 }).requiresConfirmation, false);
assert.equal(finishedFilmBudgetDecision({ contentId: 'a', durationSeconds: 30, estimatedCostCny: 21.01 }).requiresConfirmation, true);
assert.equal(finishedFilmBudgetDecision({ contentId: 'a', durationSeconds: 0, estimatedCostCny: 1 }).estimateAvailable, false);
assert.equal(finishedFilmBudgetDecision({ contentId: 'a', durationSeconds: 60, estimatedCostCny: 30 }).estimatedCnyPerSecond, 0.5);
assert.equal(finishedFilmBudgetQuoteKey([{ contentId: 'b', durationSeconds: 20, estimatedCostCny: 15 }, { contentId: 'a', durationSeconds: 30, estimatedCostCny: 22 }]),
  finishedFilmBudgetQuoteKey([{ contentId: 'a', durationSeconds: 30, estimatedCostCny: 22 }, { contentId: 'b', durationSeconds: 20, estimatedCostCny: 15 }]));
