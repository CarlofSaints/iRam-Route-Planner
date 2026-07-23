import { put, list, del } from "@vercel/blob";
import { Channel, Rep, Store, User, Team, RoutePlanDocument, RolePermission, ROLE_DEFINITIONS, ALL_PERMISSIONS, CallCycleType, DEFAULT_CALL_CYCLE_TYPES, Region, StoreOverride } from "./types";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

// ---------- low-level helpers ----------

async function readJSON<T>(key: string, fallback: T): Promise<T> {
  if (useBlob) {
    try {
      const { blobs } = await list({ prefix: `${key}.json` });
      if (blobs.length === 0) return fallback;
      // Private store: fetch with Bearer token
      const res = await fetch(blobs[0].url, {
        headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
      });
      return (await res.json()) as T;
    } catch {
      return fallback;
    }
  }
  // local file fallback
  const filePath = path.join(DATA_DIR, `${key}.json`);
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJSON<T>(key: string, data: T): Promise<void> {
  const body = JSON.stringify(data, null, 2);
  if (useBlob) {
    // delete old blob first
    try {
      const { blobs } = await list({ prefix: `${key}.json` });
      for (const b of blobs) await del(b.url);
    } catch { /* ignore */ }
    await put(`${key}.json`, body, {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
    });
    return;
  }
  // local file fallback
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, `${key}.json`), body, "utf-8");
}

// ---------- Channels ----------

export async function getChannels(): Promise<Channel[]> {
  return readJSON<Channel[]>("channels", []);
}

export async function saveChannels(channels: Channel[]): Promise<void> {
  await writeJSON("channels", channels);
}

// ---------- App Settings ----------

export interface AppSettings {
  outlierRadiusKm: number; // stores beyond this distance from a rep's area are flagged out-of-range
}

const DEFAULT_SETTINGS: AppSettings = { outlierRadiusKm: 150 };

export async function getSettings(): Promise<AppSettings> {
  const saved = await readJSON<Partial<AppSettings> | null>("settings", null);
  return { ...DEFAULT_SETTINGS, ...(saved || {}) };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await writeJSON("settings", settings);
}

// ---------- Geocode cache (reverse-geocoded place names, keyed by rounded coord) ----------

export async function getGeocodeCache(): Promise<Record<string, string>> {
  return readJSON<Record<string, string>>("geocache", {});
}

export async function saveGeocodeCache(cache: Record<string, string>): Promise<void> {
  await writeJSON("geocache", cache);
}

// ---------- Reps ----------

export async function getReps(): Promise<Rep[]> {
  return readJSON<Rep[]>("reps", []);
}

export async function saveReps(reps: Rep[]): Promise<void> {
  await writeJSON("reps", reps);
}

// ---------- Stores ----------

export async function getStores(): Promise<Store[]> {
  const stores = await readJSON<Store[]>("stores", []);
  // Sanitize: ensure numeric fields are never null/NaN (guards against bad Excel imports)
  for (const s of stores) {
    if (s.monthlySales == null || isNaN(s.monthlySales)) s.monthlySales = 0;
    if (s.duration == null || isNaN(s.duration)) s.duration = 30;
  }
  return stores;
}

export async function saveStores(stores: Store[]): Promise<void> {
  await writeJSON("stores", stores);
}

// ---------- Store Call Overrides ----------

export async function getStoreOverrides(): Promise<StoreOverride[]> {
  return readJSON<StoreOverride[]>("store-overrides", []);
}

export async function saveStoreOverrides(overrides: StoreOverride[]): Promise<void> {
  await writeJSON("store-overrides", overrides);
}

// ---------- Users ----------

export async function getUsers(): Promise<User[]> {
  return readJSON<User[]>("users", []);
}

export async function saveUsers(users: User[]): Promise<void> {
  await writeJSON("users", users);
}

// ---------- Teams ----------

export async function getTeams(): Promise<Team[]> {
  return readJSON<Team[]>("teams", []);
}

export async function saveTeams(teams: Team[]): Promise<void> {
  await writeJSON("teams", teams);
}

// ---------- Regions ----------

export async function getRegions(): Promise<Region[]> {
  return readJSON<Region[]>("regions", []);
}

export async function saveRegions(regions: Region[]): Promise<void> {
  await writeJSON("regions", regions);
}

// ---------- Routes ----------

export async function getRoutes(): Promise<RoutePlanDocument | null> {
  return readJSON<RoutePlanDocument | null>("routes", null);
}

export async function saveRoutes(doc: RoutePlanDocument | null): Promise<void> {
  await writeJSON("routes", doc);
}

// Per-strategy route storage
export async function getRoutesForType(typeId: string): Promise<RoutePlanDocument | null> {
  return readJSON<RoutePlanDocument | null>(`routes-${typeId}`, null);
}

export async function saveRoutesForType(typeId: string, doc: RoutePlanDocument | null): Promise<void> {
  await writeJSON(`routes-${typeId}`, doc);
}

export async function listSavedRouteTypes(): Promise<string[]> {
  if (useBlob) {
    try {
      const { blobs } = await list({ prefix: "routes-" });
      return blobs
        .map((b) => {
          const match = b.pathname.match(/^routes-(.+)\.json$/);
          return match ? match[1] : null;
        })
        .filter((id): id is string => id !== null);
    } catch {
      return [];
    }
  }
  // local file fallback
  try {
    const files = fs.readdirSync(DATA_DIR);
    return files
      .map((f) => {
        const match = f.match(/^routes-(.+)\.json$/);
        return match ? match[1] : null;
      })
      .filter((id): id is string => id !== null);
  } catch {
    return [];
  }
}

// ---------- Call Cycle Types ----------

export async function getCallCycleTypes(): Promise<CallCycleType[]> {
  const saved = await readJSON<CallCycleType[] | null>("call-cycle-types", null);
  if (!saved || saved.length === 0) return DEFAULT_CALL_CYCLE_TYPES;
  return saved;
}

export async function saveCallCycleTypes(types: CallCycleType[]): Promise<void> {
  // Enforce: only one can be active
  const activeCount = types.filter((t) => t.active).length;
  if (activeCount > 1) {
    // keep only the last one marked active
    let found = false;
    for (let i = types.length - 1; i >= 0; i--) {
      if (types[i].active) {
        if (found) types[i].active = false;
        found = true;
      }
    }
  }
  await writeJSON("call-cycle-types", types);
}

// ---------- Role Permissions ----------

const ALL_PERM_KEYS = ALL_PERMISSIONS.map((p) => p.key);

export async function getRolePermissions(): Promise<RolePermission[]> {
  const saved = await readJSON<RolePermission[] | null>("role-permissions", null);
  if (!saved) return ROLE_DEFINITIONS;

  // Backfill: ensure every default role exists in saved data
  const merged = [...saved];
  for (const def of ROLE_DEFINITIONS) {
    if (!merged.find((r) => r.role === def.role)) {
      merged.push(def);
    }
  }
  // Enforce: superAdmin always has ALL permissions
  const sa = merged.find((r) => r.role === "superAdmin");
  if (sa) sa.permissions = [...ALL_PERM_KEYS];

  return merged;
}

export async function saveRolePermissions(perms: RolePermission[]): Promise<void> {
  // Enforce: superAdmin always has ALL permissions
  const sa = perms.find((r) => r.role === "superAdmin");
  if (sa) sa.permissions = [...ALL_PERM_KEYS];

  // Strip unknown permission keys
  for (const rp of perms) {
    rp.permissions = rp.permissions.filter((k) => ALL_PERM_KEYS.includes(k));
  }

  await writeJSON("role-permissions", perms);
}
