"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Draggable column widths, remembered per grid and per browser.
 *
 * Lifted out of the Channels page (599c922, fixed in 374ed7e) so the Stores grid
 * can use exactly the same mechanics instead of a second copy that drifts. Two
 * things that page learned the hard way are kept here on purpose:
 *
 *  - The drag listeners go on WINDOW, never on the grip. Every pointermove
 *    re-renders the table and replaces the grip's DOM node, so anything bound
 *    to that node (listeners, pointer capture) dies on the first move.
 *  - The grip must be rendered by a plain function, not a component declared
 *    inside the page, or React rebuilds it every frame mid-drag.
 *
 * Widths live in localStorage because they are a per-person view preference,
 * not data. Every read and write is wrapped: storage throws in some private
 * windows, and a grid that will not render because it could not remember a
 * column width is worse than a column at its default width.
 */

export interface ColumnWidths {
  /** Current width for a column, or its default. */
  widthOf: (key: string) => number;
  /** Wire to a grip's onPointerDown. */
  startResize: (key: string, e: React.PointerEvent<HTMLElement>) => void;
  /** Put one column back to its default (double-click a grip). */
  resetColumn: (key: string) => void;
  /** Put every column back. */
  resetAll: () => void;
  /** True once any column has been dragged, so a Reset control can hide itself. */
  customised: boolean;
}

export function useColumnWidths(
  storageKey: string,
  defaults: Record<string, number>,
  min = 60
): ColumnWidths {
  const [widths, setWidths] = useState<Record<string, number>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setWidths(JSON.parse(raw));
    } catch {
      // A corrupt or unreadable entry just means default widths.
    }
  }, [storageKey]);

  const persist = useCallback(
    (next: Record<string, number>) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Private mode or quota: the resize still works for this session.
      }
    },
    [storageKey]
  );

  const widthOf = useCallback(
    (key: string) => widths[key] ?? defaults[key] ?? min,
    [widths, defaults, min]
  );

  const startResize = useCallback(
    (key: string, e: React.PointerEvent<HTMLElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startWidth = widths[key] ?? defaults[key] ?? min;
      let latest = startWidth;

      const onMove = (ev: PointerEvent) => {
        latest = Math.max(min, Math.round(startWidth + (ev.clientX - startX)));
        setWidths((prev) => ({ ...prev, [key]: latest }));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.userSelect = "";
        setWidths((prev) => {
          const next = { ...prev, [key]: latest };
          persist(next);
          return next;
        });
      };
      // Dragging across a table otherwise selects every cell it crosses.
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [widths, defaults, min, persist]
  );

  const resetColumn = useCallback(
    (key: string) => {
      setWidths((prev) => {
        const next = { ...prev };
        delete next[key];
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const resetAll = useCallback(() => {
    setWidths({});
    persist({});
  }, [persist]);

  return { widthOf, startResize, resetColumn, resetAll, customised: Object.keys(widths).length > 0 };
}
