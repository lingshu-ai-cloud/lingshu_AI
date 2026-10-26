import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react';
import {
  reconcileProductMaterialSelection,
  restoreProductMaterialSelection,
  type ProductMaterialSelectionInput,
  type ProductMaterialSelectionState,
} from './studioProductMaterialSelection';

interface UseProductMaterialSelectionOptions extends ProductMaterialSelectionInput {
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  enabled?: boolean;
  /** Authentication authority resets cached state; project restoration explicitly resets its saved baseline. */
  resetKey: string;
}

export function useProductMaterialSelection({
  productIds, materials, selectedIds, setSelectedIds, kickoff,
  enabled = true, resetKey, preserveInitialSelection = false,
}: UseProductMaterialSelectionOptions) {
  const state = useRef<ProductMaterialSelectionState | null>(null);
  const identity = useRef(resetKey);
  const preserveNext = useRef(false);
  const baselineRevision = useRef(0);
  const renderRevision = baselineRevision.current;
  const resetSelectionBaseline = useCallback((savedState?: unknown) => {
    baselineRevision.current += 1;
    state.current = restoreProductMaterialSelection(savedState);
    preserveNext.current = !state.current;
  }, []);

  useEffect(() => {
    // A preceding parent effect may have restored a new project and queued its
    // selected IDs after this render. Its old selection must not erase ownership.
    if (renderRevision !== baselineRevision.current) return;
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
  }, [enabled, kickoff, materials, preserveInitialSelection, productIds, renderRevision, resetKey, selectedIds, setSelectedIds]);

  // Serialize the same reconciliation used by the effect, including a manual opt-out
  // made in this render, rather than a stale ref from the preceding render.
  const selectionState = useMemo(() => identity.current !== resetKey ? null : enabled ? reconcileProductMaterialSelection(state.current, {
    productIds, materials, selectedIds, kickoff,
    preserveInitialSelection: preserveNext.current || preserveInitialSelection,
  }) : state.current, [enabled, kickoff, materials, preserveInitialSelection, productIds, renderRevision, resetKey, selectedIds]);
  const latestSelection = useRef({ selectionState, renderRevision, resetKey });
  latestSelection.current = { selectionState, renderRevision, resetKey };
  const getSelectionState = useCallback(() => {
    const latest = latestSelection.current;
    if (latest.resetKey !== identity.current) return null;
    return latest.renderRevision === baselineRevision.current ? latest.selectionState : state.current;
  }, []);
  return { resetSelectionBaseline, selectionState, getSelectionState };
}
