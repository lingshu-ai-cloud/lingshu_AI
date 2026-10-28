export const FINISHED_FILM_MAX_CNY_PER_SECOND = 0.7;

export interface FinishedFilmBudgetInput {
  contentId: string;
  durationSeconds: number;
  estimatedCostCny: number;
}

/** A film is priced by its final running time, not the sum of billed shot seconds. */
export function finishedFilmBudgetDecision(input: FinishedFilmBudgetInput) {
  const { contentId, durationSeconds, estimatedCostCny } = input;
  const valid = Boolean(contentId) && Number.isFinite(durationSeconds) && durationSeconds > 0
    && Number.isFinite(estimatedCostCny) && estimatedCostCny >= 0;
  const allowedCostCny = valid ? Math.round(durationSeconds * FINISHED_FILM_MAX_CNY_PER_SECOND * 100) / 100 : 0;
  const estimatedCnyPerSecond = valid ? Math.round(estimatedCostCny / durationSeconds * 1000) / 1000 : null;
  return { contentId, durationSeconds, estimatedCostCny, allowedCostCny, estimatedCnyPerSecond,
    requiresConfirmation: !valid || estimatedCostCny > allowedCostCny + 0.000001,
    estimateAvailable: valid };
}

/** Exact, order-independent quote identity for an explicit user confirmation. */
export function finishedFilmBudgetQuoteKey(films: FinishedFilmBudgetInput[]): string {
  return JSON.stringify(films.map(film => [film.contentId, film.durationSeconds, film.estimatedCostCny])
    .sort((left, right) => String(left[0]).localeCompare(String(right[0]))));
}
