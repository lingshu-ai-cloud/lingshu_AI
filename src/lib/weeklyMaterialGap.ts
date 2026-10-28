import type { WeeklyProductionReadiness } from './digitalEmployeeApi';

export type WeeklyMaterialGap = NonNullable<WeeklyProductionReadiness['materialGaps']>[number];
