/** One visit role's call rhythm on one channel. */
export interface ChannelRoleDefault {
  frequency: FrequencyType;
  duration: number; // minutes per visit
  /**
   * Whether this role calls on this channel at all.
   *
   * Some roles never visit some channels, and there is no frequency or
   * duration that expresses that — every value, including the smallest one,
   * still puts a call in the route and hours on the capacity line. Only an
   * explicit "no" removes them.
   *
   * `undefined` means yes, deliberately: every entry written before this field
   * existed omits it, and a channel with no entry at all still falls back to
   * the role's own rhythm. So nothing needs migrating, and the only way to be
   * switched off is to have been switched off on purpose.
   */
  enabled?: boolean;
}

export interface Channel {
  id: string;
  name: string;
  /**
   * The PRIMARY role's defaults. These stay top-level rather than moving into
   * `roleDefaults` because they are what gets materialised onto every store —
   * the route engine only ever reads `store.frequency`/`store.duration`. Keeping
   * one home for them avoids two sources of truth for the same number.
   */
  frequency: FrequencyType;
  duration: number; // minutes per visit
  /**
   * Per-role defaults for NON-primary roles, keyed by VisitRole.id.
   *
   * A QC call on a Makro is not the same length as a QC call on a Mica, so the
   * role's own frequency/duration is only a fallback. An absent entry means
   * exactly that fallback, which is how QC and Training behaved before this
   * existed — so no migration is needed.
   */
  roleDefaults?: Record<string, ChannelRoleDefault>;
}

export type FrequencyType =
  | "daily"
  | "3x_weekly"
  | "2x_weekly"
  | "weekly"
  | "3x_monthly"
  | "2x_monthly"
  | "monthly"
  | "bimonthly"
  | "quarterly";

/**
 * monthlyRate is visits per month on the planner's own calendar, which is a
 * 4-week cycle of 5 working days. So daily = 5 × 4 = 20, not 21.7. Keeping it
 * consistent with the cycle the route engine actually builds is what stops a
 * rep's capacity line disagreeing with the route they were given.
 *
 * visitsPerWeek is only meaningful for the sub-weekly frequencies: it is how
 * many separate days in a week the store is called on. Everything weekly or
 * slower is visited at most once in any given week, so it is 1.
 */
export const FREQUENCY_OPTIONS: {
  value: FrequencyType;
  label: string;
  monthlyRate: number;
  visitsPerWeek: number;
}[] = [
  { value: "daily", label: "Daily (every working day)", monthlyRate: 20, visitsPerWeek: 5 },
  { value: "3x_weekly", label: "3x per Week", monthlyRate: 12, visitsPerWeek: 3 },
  { value: "2x_weekly", label: "2x per Week", monthlyRate: 8, visitsPerWeek: 2 },
  { value: "weekly", label: "Weekly (4x/month)", monthlyRate: 4, visitsPerWeek: 1 },
  { value: "3x_monthly", label: "3x per Month", monthlyRate: 3, visitsPerWeek: 1 },
  { value: "2x_monthly", label: "2x per Month", monthlyRate: 2, visitsPerWeek: 1 },
  { value: "monthly", label: "Once a Month", monthlyRate: 1, visitsPerWeek: 1 },
  { value: "bimonthly", label: "Every 2nd Month", monthlyRate: 0.5, visitsPerWeek: 1 },
  { value: "quarterly", label: "Once a Quarter", monthlyRate: 0.333, visitsPerWeek: 1 },
];

export function getFrequencyLabel(freq: FrequencyType): string {
  return FREQUENCY_OPTIONS.find((f) => f.value === freq)?.label ?? freq;
}

export function getMonthlyRate(freq: FrequencyType): number {
  return FREQUENCY_OPTIONS.find((f) => f.value === freq)?.monthlyRate ?? 1;
}

/** How many separate days in a week this frequency is visited on. */
export function getVisitsPerWeek(freq: FrequencyType): number {
  return FREQUENCY_OPTIONS.find((f) => f.value === freq)?.visitsPerWeek ?? 1;
}

/**
 * Spreadsheet-tolerant frequency parser.
 *
 * Uploads come from people typing into Excel, so "Weekly", "3x _weekly" and
 * "Every 2nd month" all have to land on the right value. Matching used to be
 * exact and case-sensitive against the stored value, which rejected 21 rows of
 * a real channel import purely on capitalisation and a stray space.
 *
 * Returns null only when the text genuinely isn't a frequency we know.
 */
export function parseFrequency(raw: string): FrequencyType | null {
  if (!raw) return null;

  // Collapse case, punctuation and spacing: "3x _weekly" → "3xweekly"
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const key = norm(raw);
  if (!key) return null;

  // Exact stored values and display labels first
  for (const opt of FREQUENCY_OPTIONS) {
    if (norm(opt.value) === key || norm(opt.label) === key) return opt.value;
  }

  const SYNONYMS: Record<string, FrequencyType> = {
    // daily
    daily: "daily", everyday: "daily", eachday: "daily", "5xweekly": "daily",
    "5xweek": "daily", "5aweek": "daily", "5perweek": "daily", everyworkingday: "daily",
    // 3x weekly
    "3xweek": "3x_weekly", "3aweek": "3x_weekly", "3perweek": "3x_weekly",
    "3timesaweek": "3x_weekly", "3timesweekly": "3x_weekly", threeweekly: "3x_weekly",
    // 2x weekly
    "2xweek": "2x_weekly", "2aweek": "2x_weekly", "2perweek": "2x_weekly",
    "2timesaweek": "2x_weekly", "2timesweekly": "2x_weekly", twiceaweek: "2x_weekly",
    twiceweekly: "2x_weekly", biweekly: "2x_weekly",
    // weekly
    "1xweekly": "weekly", "1xweek": "weekly", onceaweek: "weekly", everyweek: "weekly",
    weekly4xmonth: "weekly",
    // 3x monthly
    "3xmonth": "3x_monthly", "3permonth": "3x_monthly", "3timesamonth": "3x_monthly",
    "3timesmonthly": "3x_monthly",
    // 2x monthly
    "2xmonth": "2x_monthly", "2permonth": "2x_monthly", "2timesamonth": "2x_monthly",
    "2timesmonthly": "2x_monthly", twiceamonth: "2x_monthly", twicemonthly: "2x_monthly",
    fortnightly: "2x_monthly", everyfortnight: "2x_monthly", every2weeks: "2x_monthly",
    // monthly
    "1xmonthly": "monthly", "1xmonth": "monthly", onceamonth: "monthly",
    everymonth: "monthly", permonth: "monthly",
    // bimonthly
    bimonthly: "bimonthly", every2ndmonth: "bimonthly", every2months: "bimonthly",
    everysecondmonth: "bimonthly", everyothermonth: "bimonthly", "2monthly": "bimonthly",
    // quarterly
    quarterly: "quarterly", onceaquarter: "quarterly", perquarter: "quarterly",
    every3months: "quarterly", every3rdmonth: "quarterly", "3monthly": "quarterly",
  };

  return SYNONYMS[key] ?? null;
}

export interface Rep {
  id: string;
  code: string;
  name: string;
  email: string;
  cell: string;
  homeAddress: string;
  homeGpsLat: string;
  homeGpsLng: string;
  teamId: string;
  workingHoursPerDay?: number; // default 8.5
  assignedChannels?: string[]; // channel IDs for channel_dedicated strategy
  // Which kind of visit this person performs. Absent = the primary sales role,
  // so every rep that predates visit roles keeps its existing behaviour.
  visitRoleId?: string;
}

/**
 * A visit role is the KIND of call a person makes on a store, not their
 * seniority in the org. The primary role is the sales rep whose visits are
 * driven by the store's own channel frequency; higher-level roles (QC,
 * training) visit the same stores on their own rhythm and for their own
 * length of time, and are linked to the store as a secondary or third rep.
 */
export interface VisitRole {
  id: string;
  name: string;
  frequency: FrequencyType; // how often this role calls on each of its stores
  duration: number; // minutes per visit
  // The primary role takes its frequency and duration from the store/channel
  // instead of from the role, and is matched via Store.repCode.
  isPrimary: boolean;
  // Higher-level roles legitimately cover a whole province, so out-of-range
  // flagging would fire on nearly every store. Off by default for them.
  checkOutliers: boolean;
}

export const PRIMARY_VISIT_ROLE_ID = "sales";

/**
 * The Channels spreadsheet's column headings for one non-primary visit role.
 *
 * Shared by the export and the import so the file round-trips: this is the only
 * definition of those names, and a role renamed on the Visit Roles page renames
 * its columns in both directions at once.
 *
 * The primary role has no entry here on purpose — its values ARE the channel's
 * own "Frequency" and "Duration (min)" columns, and giving it a second pair
 * would create two spreadsheet cells writing to one field.
 */
export function roleColumns(role: VisitRole) {
  return {
    calls: `${role.name} Calls`,
    frequency: `${role.name} Frequency`,
    duration: `${role.name} Duration (min)`,
  };
}

/**
 * The Stores spreadsheet's columns naming the rep who performs one non-primary
 * visit role at a store.
 *
 * One pair per role rather than the old SECONDARY/THIRD pair: two slots could
 * not hold three roles, and a slot never said which role it was for. Shared by
 * the upload template, the upload parser and the Stores export, so all three
 * agree and a renamed role renames its columns everywhere at once.
 *
 * Upper-cased to match the rest of the Stores template; header matching ignores
 * case either way.
 */
export function storeRoleColumns(role: VisitRole) {
  const label = role.name.toUpperCase();
  return { id: `${label} ID`, name: `${label} NAME` };
}

/**
 * The name of the visit role a rep performs.
 *
 * A rep with no `visitRoleId` IS the primary role — that absence is what keeps
 * every rep predating visit roles working — so this resolves to the primary
 * role's name rather than to an empty string. Rendering the absence as blank is
 * what made the exported Visit Role column look broken for all 227 reps.
 */
export function getVisitRoleName(
  visitRoleId: string | undefined,
  roles: VisitRole[]
): string {
  const match = visitRoleId ? roles.find((r) => r.id === visitRoleId) : undefined;
  return match?.name ?? roles.find((r) => r.isPrimary)?.name ?? "Sales Rep";
}

/**
 * "Dean Smith (Sales Rep)" — the one way a rep is named in the UI.
 *
 * Two people can cover the same store in different roles, so a bare name is
 * ambiguous wherever reps are picked or listed.
 */
export function repLabel(
  rep: { name: string; visitRoleId?: string },
  roles: VisitRole[]
): string {
  return `${rep.name} (${getVisitRoleName(rep.visitRoleId, roles)})`;
}

export const DEFAULT_VISIT_ROLES: VisitRole[] = [
  { id: PRIMARY_VISIT_ROLE_ID, name: "Sales Rep", frequency: "monthly", duration: 30, isPrimary: true, checkOutliers: true },
  { id: "qc", name: "QC", frequency: "quarterly", duration: 60, isPrimary: false, checkOutliers: false },
  { id: "training", name: "Training", frequency: "bimonthly", duration: 90, isPrimary: false, checkOutliers: false },
];

export interface Team {
  id: string;
  name: string;
  managerId: string; // User ID of the area/team manager
  managerName: string;
  managerEmail: string;
  managerCell: string;
  area: string; // geographic area this team covers
}

export interface Store {
  id: string;
  placeId: string;
  name: string;
  channelId: string;
  repCode: string; // primary rep — the one routing, capacity and the map work off
  /**
   * The non-primary rep calling on this store, one per visit role, keyed by
   * VisitRole.id.
   *
   * Replaces the fixed repCode2/repCode3 pair. Two slots could not hold three
   * non-primary roles, and a slot never said WHICH role it was for — the role
   * came from whoever happened to be put in it, so the same column meant
   * something different on every row.
   */
  roleReps?: Record<string, string>;
  /** @deprecated Superseded by roleReps. Still read for stores not yet migrated. */
  repCode2?: string;
  /** @deprecated Superseded by roleReps. Still read for stores not yet migrated. */
  repCode3?: string;
  gpsLat: string;
  gpsLng: string;
  monthlySales: number;
  frequency: FrequencyType;
  duration: number; // minutes
  dayOfWeek: string;
  weekNumber: string;
  rangeConfirmed?: boolean; // manager confirmed this store is in the rep's cycle despite being far from their area
  region?: string; // user-defined region
  province?: string; // auto-populated from GPS via Google Geocoding
}

export const SA_PROVINCES = [
  "Eastern Cape",
  "Free State",
  "Gauteng",
  "KwaZulu-Natal",
  "Limpopo",
  "Mpumalanga",
  "North West",
  "Northern Cape",
  "Western Cape",
] as const;

export interface Region {
  id: string;
  name: string;
}

// ---------- Store Call Frequency/Duration Overrides ----------

export type OverrideApprovalStatus = "pending" | "approved";

export interface StoreOverride {
  id: string;
  storeId: string;
  storeName: string; // denormalized for display/history
  placeId: string;
  channelId: string;
  repCode: string;
  // channel defaults captured at time of override (audit/reference)
  defaultFrequency: FrequencyType;
  defaultDuration: number;
  // override values that were applied to the store
  frequency: FrequencyType;
  duration: number;
  approvalStatus: OverrideApprovalStatus;
  requestedBy?: string;
  requestedAt?: string;
  decidedBy?: string;
  decidedAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type UserRole = "superAdmin" | "admin" | "teamManager" | "rep" | "viewer";

export interface User {
  id: string;
  name: string;
  email: string;
  password: string; // hashed
  role: UserRole;
  forcePasswordChange: boolean;
  cell?: string;
  profilePicUrl?: string;
}

export interface RolePermission {
  role: UserRole;
  label: string;
  description: string;
  permissions: string[];
}

export const ROLE_DEFINITIONS: RolePermission[] = [
  {
    role: "superAdmin",
    label: "Super Admin",
    description: "Full unrestricted access",
    permissions: ["manage_super_admins", "manage_users", "manage_roles", "manage_teams", "manage_reps", "manage_stores", "manage_store_overrides", "manage_channels", "manage_routes", "generate_routes", "import_reps", "manage_call_cycles", "manage_channel_map", "manage_regions", "manage_perigee", "view_dashboard", "view_map", "view_routes", "upload_stores", "upload_data", "export_data"],
  },
  {
    role: "admin",
    label: "Admin",
    description: "Manage reps, stores, channels, and view reports",
    permissions: ["manage_teams", "manage_reps", "manage_stores", "manage_store_overrides", "manage_channels", "manage_routes", "generate_routes", "import_reps", "manage_call_cycles", "manage_channel_map", "manage_regions", "manage_perigee", "view_dashboard", "view_map", "view_routes", "upload_stores", "upload_data", "export_data"],
  },
  {
    role: "teamManager",
    label: "Team Manager",
    description: "View and manage assigned team and reps",
    permissions: ["manage_reps", "manage_stores", "manage_store_overrides", "view_dashboard", "view_map", "view_routes"],
  },
  {
    role: "rep",
    label: "Rep",
    description: "View own routes and store assignments",
    permissions: ["view_dashboard", "view_map", "view_routes"],
  },
  {
    role: "viewer",
    label: "Viewer",
    description: "Read-only access to dashboards and reports",
    permissions: ["view_dashboard", "view_map", "view_routes"],
  },
];

export const ALL_PERMISSIONS = [
  { key: "manage_super_admins", label: "Manage Super Admins" },
  { key: "manage_users", label: "Manage Users" },
  { key: "manage_roles", label: "Manage Roles" },
  { key: "manage_teams", label: "Manage Teams" },
  { key: "manage_reps", label: "Manage Reps" },
  { key: "manage_stores", label: "Manage Stores" },
  { key: "manage_store_overrides", label: "Manage Store Call Overrides" },
  { key: "manage_channels", label: "Manage Channels" },
  { key: "manage_routes", label: "Manage Routes" },
  { key: "generate_routes", label: "Generate Routes" },
  { key: "import_reps", label: "Import Rep List" },
  { key: "manage_call_cycles", label: "Manage Call Cycles" },
  { key: "manage_channel_map", label: "Manage Channel Map" },
  { key: "manage_regions", label: "Manage Regions" },
  { key: "manage_perigee", label: "Manage Perigee API" },
  { key: "view_dashboard", label: "View Dashboard" },
  { key: "view_map", label: "View Map" },
  { key: "view_routes", label: "View Routes" },
  { key: "upload_stores", label: "Upload Stores" },
  { key: "upload_data", label: "Upload Data" },
  { key: "export_data", label: "Export Data" },
];

export interface SessionPayload {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
  forcePasswordChange?: boolean;
  repCode?: string;  // for rep users — matched by email at login
  teamId?: string;   // for teamManager users — matched by managerEmail at login
  cell?: string;
  profilePicUrl?: string;
}

// ---------- Call Cycle Types ----------

export type CallCycleStrategy = "channel_dedicated" | "geography";

export interface CallCycleType {
  id: string;
  name: string;
  strategy: CallCycleStrategy;
  description: string;
  active: boolean; // only one can be active at a time
}

export const DEFAULT_CALL_CYCLE_TYPES: CallCycleType[] = [
  {
    id: "cct-channel",
    name: "Channel Dedicated",
    strategy: "channel_dedicated",
    description: "Reps are assigned specific channels and only call on stores within those channels in their region.",
    active: false,
  },
  {
    id: "cct-geography",
    name: "Geography",
    strategy: "geography",
    description: "Reps are assigned geographic areas and call on any channel within their area, limited by daily store capacity.",
    active: false,
  },
];

// ---------- Route Plan Types ----------

export interface RouteStop {
  storeId: string;
  storeName: string;
  lat: number;
  lng: number;
  visitDuration: number; // minutes
  travelTimeFromPrev: number; // minutes
  distanceFromPrev: number; // km
  arrivalTime: string; // "HH:mm"
  departureTime: string; // "HH:mm"
  sequence: number;
}

export type WeekLabel = "Wk1" | "Wk2" | "Wk3" | "Wk4";
export type DayLabel = "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday";

export interface RouteDayPlan {
  day: DayLabel;
  week: WeekLabel;
  stops: RouteStop[];
  totalTravelTime: number; // minutes
  totalVisitTime: number; // minutes
  totalTime: number; // minutes (travel + visits)
  totalDistance: number; // km
  overCapacity: boolean;
  polyline?: string; // encoded Google polyline
}

export interface RepRoutePlan {
  repCode: string;
  repName: string;
  // Which kind of call this plan is for. Absent on plans generated before
  // visit roles existed — treat those as the primary sales role.
  visitRoleId?: string;
  visitRoleName?: string;
  homeLatLng: { lat: number; lng: number } | null;
  workingHoursPerDay: number;
  generatedAt: string; // ISO datetime
  days: RouteDayPlan[];
  stats: {
    totalStores: number;
    unassignedStores: { storeId: string; storeName: string; reason: string }[];
  };
}

export interface RoutePlanDocument {
  id: string;
  generatedAt: string; // ISO datetime
  generatedBy: string;
  callCycleTypeId?: string;   // which call cycle type generated this
  callCycleTypeName?: string; // human-readable name for display
  repPlans: RepRoutePlan[];
  config: {
    useGoogleMaps: boolean;
    defaultStartTime: string; // "HH:mm"
  };
}

// ---------- Perigee Integration Types ----------

/**
 * A visit as returned by the Perigee `/api/visits` endpoint, normalised.
 * `repCode` is resolved on import (Perigee identifies reps by email/username,
 * this app links stores to reps by `Store.repCode`).
 */
export interface PerigeeVisit {
  visitId: string;
  date: string; // YYYY-MM-DD (check-in date)
  repCode: string; // resolved against Rep.email / Store.repCode
  repName: string;
  repEmail: string;
  storeCode: string; // matches Store.placeId
  storeName: string;
  status: string; // Perigee call status, e.g. "Completed"
  durationMinutes: number;
  checkInAt: string; // ISO datetime, "" if not supplied
  checkOutAt: string;
  lat: number;
  lng: number;
}

export interface PerigeeSyncConfig {
  /** Perigee bearer token. */
  apiKey: string;
  /** Full URL, e.g. https://live.perigeeportal.co.za/api/visits */
  endpoint: string;
  /** Perigee customer/tenant name sent as `customers: [customer]`. */
  customer: string;
  /** Optional extra request-body fields, as a JSON string. */
  requestBody: string;
  enabled: boolean;
  lastVisitSync: string | null; // ISO datetime
}

export interface PerigeeSyncLogEntry {
  timestamp: string; // ISO datetime
  source: "manual" | "cron";
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
  recordsFetched: number;
  recordsImported: number;
  recordsSkipped: number;
  pagesFetched?: number;
  error?: string;
}

// ---------- Perigee poll schedule (cron) ----------

export interface PollSlot {
  id: string;
  time: string; // "HH:MM" SAST
  /** short = today only; long = last 7 days (catches back-dated edits). */
  type: "short" | "long";
  enabled: boolean;
}

export interface PollSchedule {
  slots: PollSlot[];
  timezone: string; // IANA, default Africa/Johannesburg
}

export interface CronLogEntry {
  timestamp: string; // ISO datetime
  matched: boolean;
  slotTime?: string;
  slotType?: string;
  result?: string;
  imported?: number;
  skipped?: number;
  error?: string;
}
