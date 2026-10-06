/**
 * One read-modify-write at a time, per blob.
 *
 * Every write in this app reads a whole JSON blob, changes one record and puts
 * the whole blob back. Two of those overlapping (two quick switch clicks on the
 * Channels page) both read the old list, and the second write throws away the
 * first. This chains them so the second reads only after the first has saved.
 *
 * It serialises within ONE server instance, which is where quick clicks from
 * one browser land in practice. It is not a cross-instance lock; the pages
 * also send one write at a time, and that is the other half of the fix.
 */

const chains = new Map<string, Promise<unknown>>();

export function withWriteLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  // Run after the previous one whether it succeeded or failed: one bad write
  // must not wedge every write after it.
  const run = prev.then(fn, fn);
  const tail = run.then(
    () => undefined,
    () => undefined
  );
  chains.set(key, tail);
  void tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return run;
}
