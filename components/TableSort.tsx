"use client";

import { useMemo, useState } from "react";
import { compareCells, type SortDir, type SortValue } from "@/lib/tableSort";

/**
 * The pieces every sortable grid in the app shares: one hook for the state and
 * one header cell that renders the control.
 *
 * Kept deliberately small. A full generic <DataTable> would mean rewriting the
 * markup of every existing table; this only replaces their <th> elements and
 * wraps the row array, so each page keeps the layout it already had.
 *
 * Ported from Clippa. The resize handle is NOT built in here: iRam's grids use
 * the pointer-event grip from useColumnWidths, which survives the re-render
 * every drag frame causes.
 */

export interface TableSort {
  sortKey: string;
  sortDir: SortDir;
  toggleSort: (key: string) => void;
}

/**
 * @param defaultKey  column sorted on first paint ("" for the data's own order)
 * @param defaultDir  its direction
 * @param descFirst   columns that should open descending: counts, dates,
 *                    anything where "biggest first" is the useful first look
 */
export function useTableSort(
  defaultKey: string,
  defaultDir: SortDir = "asc",
  descFirst: string[] = []
): TableSort {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  const toggleSort = (key: string) => {
    if (key === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(descFirst.includes(key) ? "desc" : "asc");
    }
  };

  return { sortKey, sortDir, toggleSort };
}

/**
 * Sort rows for a grid.
 *
 * Apply this BEFORE any display cap. Sorting an already-truncated list orders
 * the top of a slice while looking exactly like the top of the data.
 */
export function useSortedRows<T>(
  rows: T[],
  accessors: Record<string, (row: T) => SortValue>,
  sort: TableSort
): T[] {
  return useMemo(() => {
    const get = accessors[sort.sortKey];
    if (!get) return rows;
    return [...rows].sort((a, b) => compareCells(get(a), get(b), sort.sortDir));
    // `accessors` is rebuilt each render by most callers; the sort only needs to
    // rerun when the rows or the chosen column change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort.sortKey, sort.sortDir]);
}

/**
 * A sortable header cell.
 *
 * The arrow renders only on the active column so the header row does not become
 * a wall of identical glyphs; inactive columns show a faint hint that they can
 * be clicked. `aria-sort` carries the same fact for anything not reading arrows.
 *
 * `grip` is an optional resize handle rendered inside the cell. The cell is
 * made `relative` so an absolutely positioned grip lands on its right edge.
 */
export function SortableTh({
  children,
  sortId,
  sort,
  className = "",
  align = "left",
  grip,
  title,
  style,
}: {
  children?: React.ReactNode;
  /** Omit to render a plain, unsortable header. */
  sortId?: string;
  sort?: TableSort;
  className?: string;
  align?: "left" | "right" | "center";
  grip?: React.ReactNode;
  title?: string;
  style?: React.CSSProperties;
}) {
  const alignCls = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";

  if (!sortId || !sort) {
    return (
      <th className={`${alignCls} ${grip ? "relative" : ""} ${className}`} title={title} style={style}>
        {children}
        {grip}
      </th>
    );
  }

  const active = sort.sortKey === sortId;
  return (
    <th
      onClick={() => sort.toggleSort(sortId)}
      aria-sort={active ? (sort.sortDir === "asc" ? "ascending" : "descending") : "none"}
      title={title ?? "Sort by this column"}
      style={style}
      className={`${alignCls} relative cursor-pointer select-none hover:text-gray-900 ${
        active ? "text-gray-900" : ""
      } ${className}`}
    >
      {children}
      <span className={`ml-1 text-[10px] ${active ? "" : "opacity-30"}`}>
        {active ? (sort.sortDir === "asc" ? "▲" : "▼") : "↕"}
      </span>
      {grip}
    </th>
  );
}
