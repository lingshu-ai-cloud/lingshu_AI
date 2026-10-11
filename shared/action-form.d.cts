export interface ActionFormField { key?: string; id?: string; label?: string; type?: string; required?: boolean; min?: number; max?: number; maxLength?: number; allowedIds?: readonly string[] }
export interface ActionFormOption { payload?: Record<string, unknown>; fields?: readonly ActionFormField[]; disabled?: boolean; enabled?: boolean; disabledReason?: string }
export function normalizeFields(fields?: readonly ActionFormField[]): (ActionFormField & { key: string | undefined })[];
export function options<T extends ActionFormOption>(detail: { actionOptions?: readonly T[] }): (T & { disabled: boolean; fields: ActionFormField[] })[];
export function fieldValue(field: ActionFormField & { type: 'number' }, raw: unknown): number;
export function fieldValue(field: ActionFormField & { type: 'scenes' | 'materials' }, raw: unknown): string[];
export function fieldValue(field: ActionFormField, raw: unknown): string | number | string[];
export function buildPayload(option: ActionFormOption, state: Record<string, unknown>): Record<string, unknown>;
