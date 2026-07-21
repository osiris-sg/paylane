"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Shared row-selection state for the list tables (invoices, statements,
 * delivery orders, invoice upload).
 *
 * Beyond plain checkbox toggling this adds **shift-click range selection**:
 * click one row, then shift-click another and every row in between takes the
 * clicked row's new state (selected if it just became selected, deselected
 * otherwise) — the behaviour people expect from Gmail/Finder.
 *
 * `ids` must be the ids of the currently rendered, selectable rows in display
 * order — ranges and "select all" are both computed from it. The shift anchor
 * is stored as an id rather than an index so it stays correct when the list is
 * re-sorted, re-filtered, or paginated.
 */
export function useRowSelection(ids: string[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const anchorRef = useRef<string | null>(null);

  const toggle = useCallback(
    (id: string, event?: { shiftKey?: boolean } | null) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        const willSelect = !prev.has(id);
        const anchor = anchorRef.current;
        const from = anchor !== null ? ids.indexOf(anchor) : -1;
        const to = ids.indexOf(id);

        // Shift-click with a live anchor → apply the clicked row's new state to
        // the whole range. Falls back to a plain toggle when the anchor is gone
        // (e.g. the user changed page since).
        if (event?.shiftKey && from !== -1 && to !== -1) {
          const [start, end] = from < to ? [from, to] : [to, from];
          for (let i = start; i <= end; i++) {
            const rowId = ids[i];
            if (!rowId) continue;
            if (willSelect) next.add(rowId);
            else next.delete(rowId);
          }
        } else if (willSelect) {
          next.add(id);
        } else {
          next.delete(id);
        }

        return next;
      });
      anchorRef.current = id;
    },
    [ids],
  );

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => (prev.size === ids.length ? new Set() : new Set(ids)));
    anchorRef.current = null;
  }, [ids]);

  const clear = useCallback(() => {
    setSelectedIds(new Set());
    anchorRef.current = null;
  }, []);

  const isAllSelected = ids.length > 0 && selectedIds.size === ids.length;
  const isSomeSelected = selectedIds.size > 0;

  return {
    selectedIds,
    setSelectedIds,
    toggle,
    toggleAll,
    clear,
    isAllSelected,
    isSomeSelected,
  };
}
