/**
 * Assertions for the per-blob write lock (lib/writeLock.ts).
 *
 * Run: npx tsx scripts/check-write-lock.ts
 *
 * Two quick saves on the Channels page each read the whole list, changed one
 * channel and wrote the whole list back, so the second write threw the first
 * one away. The case that matters is that overlap: both writes must survive.
 * No blob is touched; the "blob" here is an in-memory value with a delay.
 */

import { withWriteLock } from "../lib/writeLock";

let passed = 0;
let failed = 0;
function ok(label: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`PASS  ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}${detail ? `  - ${detail}` : ""}`);
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A fake blob whose read and write each take a moment, like the real one. */
function fakeBlob(initial: Record<string, boolean>) {
  let stored = JSON.stringify(initial);
  return {
    read: async () => {
      await wait(5);
      return JSON.parse(stored) as Record<string, boolean>;
    },
    write: async (v: Record<string, boolean>) => {
      await wait(5);
      stored = JSON.stringify(v);
    },
    now: () => JSON.parse(stored) as Record<string, boolean>,
  };
}

/** What the channels PUT does: read all, patch one, write all. */
const patchOne = (blob: ReturnType<typeof fakeBlob>, key: string) => async () => {
  const all = await blob.read();
  all[key] = true;
  await blob.write(all);
};

async function main() {
  {
    const blob = fakeBlob({ a: false, b: false });
    await Promise.all([withWriteLock("t1", patchOne(blob, "a")), withWriteLock("t1", patchOne(blob, "b"))]);
    const v = blob.now();
    ok("two overlapping saves both survive under the lock", v.a === true && v.b === true, JSON.stringify(v));
  }
  {
    // The control: without the lock the same two saves lose one. If this ever
    // passes, the fake blob no longer models the race and the test above
    // proves nothing.
    const blob = fakeBlob({ a: false, b: false });
    await Promise.all([patchOne(blob, "a")(), patchOne(blob, "b")()]);
    const v = blob.now();
    ok("(control) without the lock one of them is lost", !(v.a && v.b), JSON.stringify(v));
  }
  {
    const blob = fakeBlob({ a: false, b: false });
    const failing = withWriteLock("t2", async () => {
      await wait(5);
      throw new Error("boom");
    });
    const next = withWriteLock("t2", patchOne(blob, "b"));
    let threw = false;
    try {
      await failing;
    } catch {
      threw = true;
    }
    await next;
    ok("a failed write reports its own error", threw);
    ok("and does not wedge the write after it", blob.now().b === true);
  }
  {
    const order: string[] = [];
    await Promise.all([
      withWriteLock("x", async () => {
        await wait(10);
        order.push("x");
      }),
      withWriteLock("y", async () => {
        order.push("y");
      }),
    ]);
    ok("different blobs do not wait for each other", order[0] === "y", order.join(","));
  }
  {
    const v = await withWriteLock("r", async () => 42);
    ok("the lock passes the result through", v === 42);
  }

  {
    // The routes the quick-click pages write through hold the lock around
    // their read-modify-write.
    const fs = await import("fs");
    const path = await import("path");
    const read = (rel: string) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
    const channels = read("app/api/channels/route.ts");
    const put = channels.slice(channels.indexOf("export async function PUT"), channels.indexOf("export async function POST"));
    ok("channels PUT reads and saves inside the lock",
      /withWriteLock\("channels"/.test(put) && put.indexOf('withWriteLock("channels"') < put.indexOf("getChannels()"));
    const stores = read("app/api/stores/route.ts");
    const sput = stores.slice(stores.indexOf("export async function PUT"));
    ok("stores PUT reads and saves inside the lock",
      /withWriteLock\("stores"/.test(sput) && sput.indexOf('withWriteLock("stores"') < sput.indexOf("getStores()"));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
