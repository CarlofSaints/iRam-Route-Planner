/**
 * Assertions for the two bugs found on 5 Aug 2026:
 *   - channel frequency/duration never reached the channel's stores
 *   - the frequency vocabulary rejected "Weekly", "Daily" and "3x _weekly"
 *
 * Run: npx tsx scripts/check-channel-defaults.ts
 */
import { applyChannelDefaults, overriddenStoreIds } from "../lib/channelDefaults";
import {
  Channel,
  Store,
  StoreOverride,
  FrequencyType,
  parseFrequency,
  getMonthlyRate,
  getVisitsPerWeek,
  FREQUENCY_OPTIONS,
} from "../lib/types";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  cond ? pass++ : fail++;
}
function eq<T>(label: string, actual: T, expected: T) {
  check(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`, actual === expected);
}

// ── Fixtures ──────────────────────────────────────────────────────────
const channels: Channel[] = [
  { id: "buco", name: "BUCO", frequency: "2x_monthly", duration: 120 },
  { id: "game", name: "GAME", frequency: "monthly", duration: 30 },
];

const store = (id: string, channelId: string, frequency: FrequencyType, duration: number): Store => ({
  id,
  placeId: id,
  name: `Store ${id}`,
  channelId,
  repCode: "R01",
  gpsLat: "-26.1",
  gpsLng: "28.1",
  monthlySales: 0,
  frequency,
  duration,
  dayOfWeek: "",
  weekNumber: "",
});

// ── 1. The reported bug: BUCO at 120 min, stores still on 30 ──────────
{
  const stores = [
    store("b1", "buco", "monthly", 30),
    store("b2", "buco", "monthly", 30),
    store("g1", "game", "monthly", 30),
  ];
  const result = applyChannelDefaults(stores, channels, new Set(), { apply: true });

  eq("BUCO store 1 duration", stores[0].duration, 120);
  eq("BUCO store 1 frequency", stores[0].frequency, "2x_monthly");
  eq("BUCO store 2 duration", stores[1].duration, 120);
  eq("GAME store untouched (already matches)", stores[2].duration, 30);
  eq("changes reported", result.changes.length, 2);
}

// ── 2. A store with an override must survive the cascade ──────────────
{
  const stores = [store("b1", "buco", "monthly", 30), store("b2", "buco", "weekly", 45)];
  const overrides = [{ storeId: "b2" } as StoreOverride];
  const result = applyChannelDefaults(stores, channels, overriddenStoreIds(overrides), {
    apply: true,
  });

  eq("un-overridden store cascaded", stores[0].duration, 120);
  eq("overridden store kept its duration", stores[1].duration, 45);
  eq("overridden store kept its frequency", stores[1].frequency, "weekly");
  eq("skip counted", result.skippedOverridden, 1);
}

// ── 3. Only the edited channel cascades ───────────────────────────────
{
  const stores = [store("b1", "buco", "monthly", 30), store("g1", "game", "weekly", 90)];
  applyChannelDefaults(stores, channels, new Set(), {
    apply: true,
    onlyChannelIds: new Set(["buco"]),
  });

  eq("target channel cascaded", stores[0].duration, 120);
  eq("other channel left alone", stores[1].duration, 90);
}

// ── 4. A store on an unknown channel is never guessed at ──────────────
{
  const stores = [store("x1", "does_not_exist", "quarterly", 15)];
  const result = applyChannelDefaults(stores, channels, new Set(), { apply: true });

  eq("unmapped store frequency untouched", stores[0].frequency, "quarterly");
  eq("unmapped store duration untouched", stores[0].duration, 15);
  eq("unmapped store counted", result.storesWithoutChannel, 1);
}

// ── 5. Dry run must not mutate ────────────────────────────────────────
{
  const stores = [store("b1", "buco", "monthly", 30)];
  const result = applyChannelDefaults(stores, channels, new Set(), { apply: false });

  eq("dry run left the store alone", stores[0].duration, 30);
  eq("dry run still reported the change", result.changes.length, 1);
  eq("dry run reported the target value", result.changes[0].to.duration, 120);
}

// ── 6. Grant's rejected spreadsheet values ────────────────────────────
{
  eq('parseFrequency("Weekly")', parseFrequency("Weekly"), "weekly");
  eq('parseFrequency("Daily")', parseFrequency("Daily"), "daily");
  eq('parseFrequency("3x _weekly")', parseFrequency("3x _weekly"), "3x_weekly");
  eq('parseFrequency("WEEKLY")', parseFrequency("WEEKLY"), "weekly");
  eq('parseFrequency("  monthly  ")', parseFrequency("  monthly  "), "monthly");
  eq('parseFrequency("2x per Month")', parseFrequency("2x per Month"), "2x_monthly");
  eq('parseFrequency("Twice a week")', parseFrequency("Twice a week"), "2x_weekly");
  eq('parseFrequency("Every 2nd Month")', parseFrequency("Every 2nd Month"), "bimonthly");
  eq('parseFrequency("Once a Quarter")', parseFrequency("Once a Quarter"), "quarterly");
  eq('parseFrequency("fortnightly")', parseFrequency("fortnightly"), "2x_monthly");
  eq('parseFrequency("banana") is rejected', parseFrequency("banana"), null);
  eq('parseFrequency("") is rejected', parseFrequency(""), null);
}

// ── 7. Every stored value round-trips through the parser ──────────────
{
  let ok = true;
  for (const opt of FREQUENCY_OPTIONS) {
    if (parseFrequency(opt.value) !== opt.value) { ok = false; console.log(`   value "${opt.value}" did not round-trip`); }
    if (parseFrequency(opt.label) !== opt.value) { ok = false; console.log(`   label "${opt.label}" did not round-trip`); }
  }
  check("every frequency value and label round-trips", ok);
}

// ── 8. New frequencies carry sane rates ───────────────────────────────
{
  eq("daily rate (5 days x 4 weeks)", getMonthlyRate("daily"), 20);
  eq("3x_weekly rate", getMonthlyRate("3x_weekly"), 12);
  eq("2x_weekly rate", getMonthlyRate("2x_weekly"), 8);
  eq("weekly rate unchanged", getMonthlyRate("weekly"), 4);
  eq("monthly rate unchanged", getMonthlyRate("monthly"), 1);
  eq("daily visits/week", getVisitsPerWeek("daily"), 5);
  eq("3x_weekly visits/week", getVisitsPerWeek("3x_weekly"), 3);
  eq("monthly visits/week", getVisitsPerWeek("monthly"), 1);
  eq("quarterly visits/week", getVisitsPerWeek("quarterly"), 1);

  // A higher frequency must never plan fewer calls than a lower one.
  const rates = FREQUENCY_OPTIONS.map((f) => f.monthlyRate);
  check(
    "frequency list is ordered most to least frequent",
    rates.every((r, i) => i === 0 || rates[i - 1] > r)
  );
}

console.log(`\n${fail === 0 ? "ALL PASS" : `${fail} FAILED`}  (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
