/**
 * A best GUESS at which week and day of the four-week cycle today is.
 *
 * Nothing records when Week 1 actually began: the Perigee file takes a start
 * Monday at export time and it is not saved. So this counts by the calendar,
 * the way people talk about it: the week whose Monday falls on the 1st to 7th
 * of the month is Week 1, 8th to 14th Week 2, 15th to 21st Week 3, and 22nd
 * onwards Week 4 (a fifth Monday folds into Week 4). The page must SAY it is a
 * guess and leave the week picker in the rep's hands.
 *
 * A weekend looks ahead to the coming Monday, since that is the next day a rep
 * needs to plan for.
 */

import type { DayLabel, WeekLabel } from "./types";

const DAYS: DayLabel[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

export function guessCycleDay(now: Date): { week: WeekLabel; day: DayLabel } {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = d.getDay(); // 0 Sunday .. 6 Saturday
  let monday: Date;
  let day: DayLabel;
  if (dow === 0 || dow === 6) {
    monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (dow === 6 ? 2 : 1));
    day = "Monday";
  } else {
    monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - (dow - 1));
    day = DAYS[dow - 1];
  }
  const n = Math.min(4, Math.ceil(monday.getDate() / 7));
  return { week: `Wk${n}` as WeekLabel, day };
}
