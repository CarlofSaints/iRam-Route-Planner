/**
 * Shared table sorting.
 *
 * One implementation for every grid in the app. Sorting was written inline on
 * the Activity Log first and that copy compares with `localeCompare` only, so it
 * mis-orders any numeric column and puts blanks above real values. Rather than
 * spread that shape further, the comparison lives here once and is asserted in
 * `scripts/check-table-sort.ts`.
 */

export type SortDir = "asc" | "desc";

/** A cell value a column can be sorted on. */
export type SortValue = string | number | boolean | null | undefined;

/**
 * Compare two cells.
 *
 * ⚠️ Rows with NO value sink to the bottom in BOTH directions. A store with no
 * sales figure has not sold zero, and floating it to the top of an ascending
 * sort would state exactly that on screen. A real zero is a value and sorts as
 * one.
 *
 * Strings compare numerically-aware, so `S2` sorts before `S10` rather than
 * after it — which is the shape of every Place ID and rep code in this system.
 */
export function compareCells(a: SortValue, b: SortValue, dir: SortDir): number {
  const empty = (v: SortValue) => v === null || v === undefined || v === "";
  const aEmpty = empty(a);
  const bEmpty = empty(b);
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  // Booleans sort false-then-true ascending, which reads as "no" before "yes".
  const av = typeof a === "boolean" ? (a ? 1 : 0) : a;
  const bv = typeof b === "boolean" ? (b ? 1 : 0) : b;

  const cmp =
    typeof av === "number" && typeof bv === "number"
      ? av - bv
      : String(av).localeCompare(String(bv), "en", { numeric: true, sensitivity: "base" });

  return dir === "asc" ? cmp : -cmp;
}

/**
 * Sort rows by a named column.
 *
 * `accessors` maps a column key to the value it sorts on, which is deliberately
 * NOT the rendered text: a money column renders "R 1 234" and must sort as 1234,
 * and a status badge renders a word but should sort by severity.
 *
 * Returns a new array. Callers hold their rows in `useMemo` and `Array.sort`
 * mutates in place, which would reorder the source and produce the classic
 * "sorting works but the filter count is wrong afterwards" bug.
 */
export function sortRows<T>(
  rows: T[],
  accessors: Record<string, (row: T) => SortValue>,
  sortKey: string,
  sortDir: SortDir
): T[] {
  const get = accessors[sortKey];
  if (!get) return rows;
  return [...rows].sort((a, b) => compareCells(get(a), get(b), sortDir));
}
