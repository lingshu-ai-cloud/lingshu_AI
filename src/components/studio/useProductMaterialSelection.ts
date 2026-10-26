import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import {
  reconcileProductMaterialSelection,
  type ProductMaterialSelectionInput,
  type ProductMaterialSelectionState,
} from './studioProductMaterialSelection';

interface UseProductMaterialSelectionOptions extends ProductMaterialSelectionInput {
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  enabled?: boolean;
  /** Include tenant and project/draft identity so automatic ownership never crosses sessions. */
  resetKey: string;
}

export function useProductMaterialSelection({
  productIds, materials, selectedIds, setSelectedIds, kickoff,
  enabled = true, resetKey, preserveInitialSelection = false,
}: UseProductMaterialSelectionOptions) {
  const state = useRef<ProductMaterialSelectionState | null>(null);
  const identity = useRef(resetKey);
  const preserveNext = useRef(false);
  const resetSelectionBaseline = useCallback(() => {
    state.current = null;
    preserveNext.current = true;
  }, []);

  useEffect(() => {
    if (identity.current !== resetKey) {
      identity.current = resetKey;
      state.current = null;
      preserveNext.current = false;
    }
    if (!enabled) return;
    const next = reconcileProductMaterialSelection(state.current, {
      productIds, materials, selectedIds, kickoff,
      preserveInitialSelection: preserveNext.current || preserveInitialSelection,
    });
    preserveNext.current = false;
    if (next.selectedIds.length !== selectedIds.length || next.selectedIds.some((id, index) => id !== selectedIds[index])) {
      // Avoid overwriting a manual update queued after the inventory/product render.
      setSelectedIds(current => {
        if (current !== selectedIds) return current;
        state.current = next;
        return next.selectedIds;
      });
    } else state.current = next;
  }, [enabled, kickoff, materials, preserveInitialSelection, productIds, resetKey, selectedIds, setSelectedIds]);

  return { resetSelectionBaseline };
}
