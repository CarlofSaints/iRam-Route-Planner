import {
  Channel,
  Rep,
  Store,
  StoreOverride,
  VisitRole,
  DEFAULT_VISIT_ROLES,
  getMonthlyRate,
  getVisitRoleName,
} from "./types";
import { computeOutliers } from "./outliers";
import { buildDuplicateGroups } from "./duplicates";
import { overriddenStoreIds } from "./channelDefaults";
import { isClosed } from "./closedStores";
import { routableStores } from "./routable";
import { getRoleForRep, getStoresForRep } from "./repStores";

/**
 * Every way this data can be wrong, in one place, with one export.
 *
 * Ported from Clippa (7bf01de, a90752c). None of its checks depended on IMS, so
 * all of them came across; what changed is that iRam has visit roles, so "a
 * rep's stores" means the stores they call on in THEIR role (a QC rep's stores
 * are the ones they QC), and store data arrives from Perigee through Store
 * Upload, so fixes point there as well as at this app.
 *
 * Every check returns the SAME shape, so the page renders them generically and
 * the export writes one sheet per check without knowing what any of them mean.
 * Adding a check is adding one block below and nothing else.
 */

/**
 * Working days in the cycle the route engine builds: 4 weeks of 5 days.
 * Matching the engine matters: a check that used a calendar month would
 * disagree with the plan it is meant to be describing.
 */
const DAY_SLOTS_PER_CYCLE = 20;
export type Severity = "blocking" | "warning" | "info";

export interface HealthIssue {
  /** Stable id, used as the sheet name and the React key. */
  id: string;
  title: string;
  severity: Severity;
  count: number;
  /** What it means, in a sentence. */
  summary: string;
  /** What to actually do about it. */
  action: string;
  columns: string[];
  rows: (string | number)[][];
}

export interface DataHealthReport {
  checkedAt: string;
  totals: {
    /** Stores the checks ran on: the ones somebody is actually sent to. */
    stores: number;
    reps: number;
    channels: number;
    /** Checks that found something. */
    issueTypes: number;
    blocking: number;
    /** Distinct stores touched by at least one BLOCKING check. */
    storesBlocked: number;
    /**
     * Closed stores, excluded from every store check. Shown rather than
     * silently subtracted: "31 stores have no rep" and "7 do, and 24 are shut"
     * are different reports, and only one of them is a list of work.
     */
    storesClosed: number;
    /** Stores in channels nobody calls on, excluded for the same reason. */
    storesNotCalledOn: number;
  };
  issues: HealthIssue[];
}

export interface HealthInput {
  reps: Rep[];
  stores: Store[];
  channels: Channel[];
  overrides: StoreOverride[];
  visitRoles?: VisitRole[];
  outlierRadiusKm: number;
}

/** Roughly South Africa's bounding box, the same box the Stores grid warns on. */
export function gpsProblem(store: Pick<Store, "gpsLat" | "gpsLng">): "blank" | "zero" | "outside" | null {
  const rawLat = String(store.gpsLat ?? "").trim();
  const rawLng = String(store.gpsLng ?? "").trim();
  if (!rawLat || !rawLng) return "blank";
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "blank";
  if (lat === 0 && lng === 0) return "zero";
  if (lat < -35.2 || lat > -21.9 || lng < 16.2 || lng > 33.1) return "outside";
  return null;
}

/**
 * Rep codes are compared EXACTLY (trimmed only), because that is how
 * lib/repStores.ts allocates stores to a rep. Clippa's version upper-cased both
 * sides, which reported "GAU001" vs "gau001" as fine while the router dropped
 * the store. The report has to describe what the routes will actually do.
 */
const code = (value: string | undefined) => (value || "").trim();

/**
 * Severity means "can this store be planned", not "is this untidy".
 *
 * blocking: the record cannot appear in a route at all.
 * warning:  it will be planned, but probably wrongly.
 * info:     worth knowing, nothing is broken.
 */
function issue(
  id: string,
  title: string,
  severity: Severity,
  summary: string,
  action: string,
  columns: string[],
  rows: (string | number)[][]
): HealthIssue {
  return { id, title, severity, count: rows.length, summary, action, columns, rows };
}

/** Said once, used by every check whose fix is store data. */
const PERIGEE_NOTE =
  "Store Upload copies Perigee's values over this app's, so correct it in Perigee as well or the next upload puts the old value back.";

export function buildDataHealthReport(input: HealthInput): DataHealthReport {
  const { reps, stores: allStores, channels, overrides, outlierRadiusKm } = input;
  const visitRoles = input.visitRoles?.length ? input.visitRoles : DEFAULT_VISIT_ROLES;

  /**
   * Closed stores, and stores in channels nobody calls on, are excluded from
   * every store check. A shut shop or an auto-ordering retailer is never
   * routed, so a missing rep or blank GPS on one is not a problem to fix. An
   * approved Call Override puts a single store back: somebody IS going there,
   * so it is checked again.
   */
  const stores = routableStores({ stores: allStores, channels, overrides });
  const closedCount = allStores.filter((s) => isClosed(s)).length;
  const notCalledOnCount = allStores.length - stores.length - closedCount;

  const repByCode = new Map(reps.map((r) => [code(r.code), r]));
  const channelById = new Map(channels.map((c) => [c.id, c]));
  const channelName = (id: string) => channelById.get(id)?.name || id || "";
  const repName = (c: string) => repByCode.get(code(c))?.name || "";
  const roleOf = (r: Rep) => getVisitRoleName(r.visitRoleId, visitRoles);

  /** Each rep's stores in their own visit role, at that role's rhythm. */
  const storesByRep = new Map<string, Store[]>();
  for (const rep of reps) {
    const role = getRoleForRep(rep, visitRoles);
    storesByRep.set(rep.id, getStoresForRep(rep, stores, role, null, channels));
  }

  const issues: HealthIssue[] = [];
  const blockedStoreIds = new Set<string>();

  // ── 1. Stores whose rep code names nobody ────────────────────────────
  {
    const rows: (string | number)[][] = [];
    for (const s of stores) {
      const c = code(s.repCode);
      if (!c || repByCode.has(c)) continue;
      blockedStoreIds.add(s.id);
      rows.push([s.repCode, s.placeId || s.id, s.name, channelName(s.channelId), s.province || "", s.gpsLat || "", s.gpsLng || ""]);
    }
    rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[2]).localeCompare(String(b[2])));
    issues.push(
      issue(
        "stores-unknown-rep",
        "Stores allocated to a rep who does not exist",
        "blocking",
        "The rep code on the store does not match any rep in the system, so nothing ties the store to a person. It drops out of every route and all capacity figures without a word.",
        "Add the missing reps on the Reps page (Import Excel), or correct the rep code on the stores. Then regenerate routes.",
        ["REP CODE", "PLACE ID", "PLACE NAME", "CHANNEL", "PROVINCE", "GPS LATITUDE", "GPS LONGITUDE"],
        rows
      )
    );
  }

  // ── 2. Stores with no rep code at all ────────────────────────────────
  {
    const rows: (string | number)[][] = [];
    for (const s of stores) {
      if (code(s.repCode)) continue;
      blockedStoreIds.add(s.id);
      rows.push([s.placeId || s.id, s.name, channelName(s.channelId), s.province || "", s.region || "", s.gpsLat || "", s.gpsLng || ""]);
    }
    issues.push(
      issue(
        "stores-no-rep",
        "Stores with no rep",
        "blocking",
        "Nobody is allocated to these stores at all. The call cycle is built from store allocation, so they can never be planned.",
        `Allocate a rep in Perigee and load the stores through Store Upload, or set the rep on the Stores page. ${PERIGEE_NOTE}`,
        ["PLACE ID", "PLACE NAME", "CHANNEL", "PROVINCE", "REGION", "GPS LATITUDE", "GPS LONGITUDE"],
        rows
      )
    );
  }

  // ── 3. A QC or Training rep code that names nobody ───────────────────
  //
  // iRam only. The store keeps its sales visits, so this is not blocking, but
  // the QC or training call silently never happens.
  {
    const nonPrimary = visitRoles.filter((r) => !r.isPrimary);
    const rows: (string | number)[][] = [];
    for (const s of stores) {
      const slots: [string, string][] = s.roleReps
        ? Object.entries(s.roleReps)
        : ([["", s.repCode2 || ""], ["", s.repCode3 || ""]] as [string, string][]);
      for (const [roleId, c] of slots) {
        if (!code(c) || repByCode.has(code(c))) continue;
        const roleName = nonPrimary.find((r) => r.id === roleId)?.name || roleId || "Secondary or third rep";
        rows.push([roleName, c, s.placeId || s.id, s.name, channelName(s.channelId), s.repCode || ""]);
      }
    }
    rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])));
    issues.push(
      issue(
        "stores-unknown-role-rep",
        "QC or Training reps on stores who do not exist",
        "warning",
        "The store names a rep for a visit role (QC, Training, and so on) whose code matches nobody. The sales visit still happens; that role's visit never does.",
        "Add the missing reps on the Reps page, or correct the role's rep column and load it through Store Upload.",
        ["VISIT ROLE", "REP CODE", "PLACE ID", "PLACE NAME", "CHANNEL", "SALES REP CODE"],
        rows
      )
    );
  }

  // ── 4. GPS problems, split by kind: each needs a different fix ───────
  {
    const kinds: { key: "blank" | "zero" | "outside"; id: string; title: string; summary: string; action: string }[] = [
      {
        key: "blank",
        id: "stores-gps-blank",
        title: "Stores with no GPS coordinates",
        summary: "The store has no location, so it cannot be put into a day or ordered into a driving route.",
        action: `Use "Not in a cycle" to type the coordinates or drop a pin, or export the Stores grid, fill them in and import it back. ${PERIGEE_NOTE}`,
      },
      {
        key: "zero",
        id: "stores-gps-zero",
        title: "Stores sitting at 0,0",
        summary: "0,0 is a placeholder, not a place. It is in the sea off West Africa, so any distance measured from it is nonsense and it drags a rep's area with it.",
        action: `Treat these as missing coordinates and replace them. ${PERIGEE_NOTE}`,
      },
      {
        key: "outside",
        id: "stores-gps-outside",
        title: "Stores plotting outside South Africa",
        summary: "The coordinates are valid numbers but fall outside the country, which usually means a lost minus sign, a swapped latitude and longitude, or a store name looked up without a country.",
        action: `Check for a missing minus on the latitude first: in South Africa the latitude is the negative one. ${PERIGEE_NOTE}`,
      },
    ];

    for (const kind of kinds) {
      const rows: (string | number)[][] = [];
      for (const s of stores) {
        if (gpsProblem(s) !== kind.key) continue;
        blockedStoreIds.add(s.id);
        rows.push([s.repCode || "", repName(s.repCode), s.placeId || s.id, s.name, channelName(s.channelId), s.province || "", s.gpsLat || "", s.gpsLng || ""]);
      }
      rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[3]).localeCompare(String(b[3])));
      issues.push(
        issue(
          kind.id,
          kind.title,
          "blocking",
          kind.summary,
          kind.action,
          ["REP CODE", "REP NAME", "PLACE ID", "PLACE NAME", "CHANNEL", "PROVINCE", "GPS LATITUDE", "GPS LONGITUDE"],
          rows
        )
      );
    }
  }

  // ── 5. Reps with nothing to call on ──────────────────────────────────
  {
    const rows: (string | number)[][] = [];
    for (const r of reps) {
      if ((storesByRep.get(r.id)?.length ?? 0) > 0) continue;
      rows.push([r.code, r.name, roleOf(r), r.email || "", r.cell || ""]);
    }
    rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    issues.push(
      issue(
        "reps-no-stores",
        "Reps with no stores",
        "warning",
        "The rep exists but not one store names them in their visit role, so there is nothing to build a call cycle from. Usually the store allocations have not been loaded yet, or their stores sit under a different code.",
        "Check their allocation in Perigee and load it through Store Upload. A manager who genuinely carries no stores can be ignored here.",
        ["REP CODE", "REP NAME", "VISIT ROLE", "EMAIL", "CELL"],
        rows
      )
    );
  }

  // ── 6. A book that cannot fit the rep's hours ────────────────────────
  //
  // Measured on visit time alone, with no travel at all. That is deliberate:
  // travel is an estimate and would make this arguable, whereas a rep whose
  // visits alone exceed their hours is impossible on arithmetic nobody can
  // dispute. Real days are worse than this says.
  {
    const rows: (string | number)[][] = [];
    for (const rep of reps) {
      const mine = storesByRep.get(rep.id) ?? [];
      if (mine.length === 0) continue;

      let visits = 0;
      let minutes = 0;
      for (const s of mine) {
        const rate = getMonthlyRate(s.frequency || "monthly");
        visits += rate;
        minutes += rate * (s.duration || 0);
      }

      const hoursNeeded = minutes / 60;
      const hoursAvailable = (rep.workingHoursPerDay ?? 8.5) * DAY_SLOTS_PER_CYCLE;
      if (hoursNeeded <= hoursAvailable) continue;

      rows.push([
        rep.code,
        rep.name,
        roleOf(rep),
        mine.length,
        Math.round(visits),
        Math.round((visits / DAY_SLOTS_PER_CYCLE) * 10) / 10,
        Math.round(hoursNeeded),
        Math.round(hoursAvailable),
        `${Math.round((hoursNeeded / hoursAvailable) * 10) / 10}x`,
        mine.filter((s) => getMonthlyRate(s.frequency || "monthly") >= 4).length,
      ]);
    }
    rows.sort((a, b) => Number(b[6]) / Number(b[7]) - Number(a[6]) / Number(a[7]));

    issues.push(
      issue(
        "rep-book-exceeds-hours",
        "Reps whose call cycle cannot fit their hours",
        "blocking",
        "The stores allocated to this rep, at the frequencies and visit lengths they carry, need more visit time than the rep has in a four-week cycle, before any driving. Any route will schedule what fits and report the rest as unassigned, which reads as a routing failure when it is really a workload one.",
        "Fix the FREQUENCIES or move stores, not the routes. A channel default of weekly cascades onto every store in the channel, so one wrong channel on the Channels page can do this to a whole team at once.",
        ["REP CODE", "REP NAME", "VISIT ROLE", "STORES", "VISITS / MONTH", "CALLS / DAY", "HOURS NEEDED", "HOURS AVAILABLE", "OVER BY", "STORES VISITED WEEKLY OR MORE"],
        rows
      )
    );
  }

  // ── 7. Two reps, one inbox ───────────────────────────────────────────
  {
    const byEmail = new Map<string, Rep[]>();
    for (const r of reps) {
      const e = (r.email || "").trim().toLowerCase();
      if (!e) continue;
      byEmail.set(e, [...(byEmail.get(e) || []), r]);
    }
    const rows: (string | number)[][] = [];
    for (const [email, group] of byEmail) {
      if (group.length < 2) continue;
      for (const r of group) {
        rows.push([email, r.code, r.name, roleOf(r), group.length, storesByRep.get(r.id)?.length ?? 0]);
      }
    }
    rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    issues.push(
      issue(
        "reps-shared-email",
        "Reps sharing an email address",
        "warning",
        "A rep login is keyed on the email address, so only one of these reps can ever have one. The second is refused and that person has no way in to set their home address.",
        "Get a distinct address for each rep before creating logins.",
        ["EMAIL", "REP CODE", "REP NAME", "VISIT ROLE", "REPS SHARING IT", "STORES"],
        rows
      )
    );
  }

  // ── 8. Reps with no usable email ─────────────────────────────────────
  {
    const rows: (string | number)[][] = [];
    for (const r of reps) {
      const e = (r.email || "").trim();
      if (e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) continue;
      rows.push([r.code, r.name, roleOf(r), e || "(blank)", storesByRep.get(r.id)?.length ?? 0]);
    }
    issues.push(
      issue(
        "reps-no-email",
        "Reps with no usable email address",
        "info",
        "There is nowhere to send a login or the Monday home-address reminder, so this rep cannot maintain their own home address.",
        "Collect the address and add it on the Reps page. Nothing else is affected: routes still plan normally.",
        ["REP CODE", "REP NAME", "VISIT ROLE", "EMAIL ON FILE", "STORES"],
        rows
      )
    );
  }

  // ── 9. A home address that never became coordinates ──────────────────
  {
    const rows: (string | number)[][] = [];
    for (const r of reps) {
      const address = (r.homeAddress || "").trim();
      const hasGps = !!(r.homeGpsLat || "").trim() && !!(r.homeGpsLng || "").trim();
      if (!address || hasGps) continue;
      rows.push([r.code, r.name, roleOf(r), address, storesByRep.get(r.id)?.length ?? 0]);
    }
    issues.push(
      issue(
        "reps-address-no-gps",
        "Reps whose home address has no coordinates",
        "info",
        "Their day still starts from the middle of their stores rather than from home, which usually adds driving. An informal address often cannot be resolved precisely enough to trust.",
        'Use "Set Home GPS" on the Reps page, or have the rep set it on their own profile.',
        ["REP CODE", "REP NAME", "VISIT ROLE", "HOME ADDRESS", "STORES"],
        rows
      )
    );
  }

  // ── 10. Stores far outside their rep's patch ─────────────────────────
  {
    const outliers = computeOutliers(reps, stores, outlierRadiusKm, visitRoles, channels);
    const rows = outliers.stores
      .slice()
      .sort((a, b) => b.distanceKm - a.distanceKm)
      .map((o) => [o.repCode, o.repName, o.storeId, o.storeName, channelName(o.channelId), Math.round(o.distanceKm * 10) / 10]);
    issues.push(
      issue(
        "stores-outliers",
        `Stores more than ${outlierRadiusKm} km from their rep's area`,
        "warning",
        "The store is a long way from the middle of that rep's stores. Sometimes it is a genuine outlying call, and sometimes the store is allocated to the wrong person or its coordinates are wrong.",
        'Confirm the genuine ones with "Confirm in cycle" on the Rep Capacity page so they stop being reported. Reallocate or fix the rest in Perigee.',
        ["REP CODE", "REP NAME", "STORE ID", "STORE NAME", "CHANNEL", "DISTANCE (KM)"],
        rows
      )
    );
  }

  // ── 11. The same shop recorded more than once ────────────────────────
  {
    const { groups } = buildDuplicateGroups(stores);
    const rows: (string | number)[][] = [];
    for (const g of groups) {
      for (const r of g.records) {
        rows.push([g.storeName, g.repCode, r.placeId, channelName(r.channelId), r.gpsLat || "", r.gpsLng || "", r.keep ? "KEEP" : "duplicate", g.records.length]);
      }
    }
    issues.push(
      issue(
        "stores-duplicates",
        "Duplicate store records",
        "warning",
        "The same shop appears more than once under one rep, so it is visited twice in a cycle and inflates every count, every capacity figure and the driving time.",
        "Use the Duplicate Stores page to collapse each group to the best record.",
        ["STORE NAME", "REP CODE", "PLACE ID", "CHANNEL", "GPS LATITUDE", "GPS LONGITUDE", "VERDICT", "IN GROUP"],
        rows
      )
    );
  }

  // ── 12. Stores with no channel, or a channel that does not exist ─────
  {
    const rows: (string | number)[][] = [];
    for (const s of stores) {
      const id = (s.channelId || "").trim();
      if (id && channelById.has(id)) continue;
      rows.push([s.repCode || "", s.placeId || s.id, s.name, id || "(blank)", s.frequency || "", s.duration ?? ""]);
    }
    issues.push(
      issue(
        "stores-no-channel",
        "Stores with a missing or unknown channel",
        "warning",
        "Call frequency and visit length come from the channel, for every visit role. Without one the store keeps whatever it was last given and stops following the rules everything else follows.",
        'Set the channel on the Stores page, then use "Apply defaults to stores" on the Channels page.',
        ["REP CODE", "PLACE ID", "PLACE NAME", "CHANNEL ON FILE", "FREQUENCY", "DURATION"],
        rows
      )
    );
  }

  // ── 13. Store rhythm that disagrees with its channel ─────────────────
  {
    const pinned = overriddenStoreIds(overrides);
    const rows: (string | number)[][] = [];
    for (const s of stores) {
      const ch = channelById.get((s.channelId || "").trim());
      if (!ch) continue; // already reported by check 12
      if (pinned.has(s.id)) continue; // deliberately pinned by a Call Override
      const freqDiffers = s.frequency !== ch.frequency;
      const durDiffers = Number(s.duration) !== Number(ch.duration);
      if (!freqDiffers && !durDiffers) continue;
      rows.push([s.repCode || "", s.placeId || s.id, s.name, ch.name, s.frequency || "", ch.frequency, s.duration ?? "", ch.duration]);
    }
    issues.push(
      issue(
        "stores-channel-mismatch",
        "Stores whose call rhythm ignores their channel",
        "warning",
        "The store's sales call frequency or visit length differs from its channel, with no Call Override to explain it. Routes and capacity are built from the STORE's values, so wherever these disagree the plan is not following the agreed call rules.",
        'Compare the totals before acting. "Apply defaults to stores" on the Channels page rewrites every store in one go, and if the channel rules were never applied that can multiply the planned workload several times over. Check it against what a rep can do in a month first.',
        ["REP CODE", "PLACE ID", "PLACE NAME", "CHANNEL", "STORE FREQUENCY", "CHANNEL FREQUENCY", "STORE MINUTES", "CHANNEL MINUTES"],
        rows
      )
    );
  }

  const found = issues.filter((i) => i.count > 0);

  return {
    checkedAt: new Date().toISOString(),
    totals: {
      stores: stores.length,
      reps: reps.length,
      channels: channels.length,
      issueTypes: found.length,
      blocking: found.filter((i) => i.severity === "blocking").reduce((a, i) => a + i.count, 0),
      storesBlocked: blockedStoreIds.size,
      storesClosed: closedCount,
      storesNotCalledOn: notCalledOnCount,
    },
    // Worst first, then biggest. A clean check still ships, so the page can show
    // what was looked at and found nothing: silence is not the same as a pass.
    issues: issues.sort((a, b) => {
      const rank = { blocking: 0, warning: 1, info: 2 } as const;
      return rank[a.severity] - rank[b.severity] || b.count - a.count;
    }),
  };
}
