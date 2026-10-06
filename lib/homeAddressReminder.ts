/**
 * The weekly nudge that gets a rep's home onto the map.
 *
 * Ported from Clippa Rep Router on 14 Sep 2026, where it has run since 3 Sep.
 *
 * A rep's week is planned outwards from where they live. When the app has no
 * coordinates for a rep's home, `generateRepRoute` falls back to the CENTROID of
 * their own stores: a point in the middle of their patch that nobody lives at.
 * Measured on live iRam data 14 Sep 2026: 184 of 231 reps had no home fix.
 *
 * ⚠️ "Set their home address" and "has a home the router can use" are NOT the
 * same test, and this module deliberately uses the second one. A typed address
 * that never resolved to a confident geocode leaves `homeGpsLat/Lng` blank, so
 * the rep's day still starts from the centroid while the Reps page shows an
 * address sitting in the field (25 reps were in exactly that state). Chasing the
 * address alone would mark those reps done while nothing about their route had
 * changed. The gate is the same `parseRepHome` the route engine itself calls, so
 * the two can never disagree.
 *
 * Nothing here sends anything or touches storage. It decides WHO and writes the
 * words; the route decides whether today is a day for sending them.
 */

import { parseRepHome } from "./saCoordinates";
import { BRAND, escapeHtml, resolveAppUrl } from "./welcomeEmail";
import { normaliseEmail } from "./manager";
import type { Rep, ReminderBlockReason, ReminderStateMap, Store, Team, User } from "./types";

// The persisted shapes live in lib/types.ts with every other stored record, so
// lib/data.ts can name them without pulling in the route engine and the mail markup.
export type { ReminderBlockReason, ReminderRun, ReminderState, ReminderStateMap } from "./types";

/** Amber, for "held back". Red would read as an error and this is a rule, not a fault. */
const WARN = "#B45309";

export interface OutstandingRep {
  repId: string;
  code: string;
  name: string;
  email: string;
  /** Stores allocated to this rep code. */
  activeStores: number;
  /** An address is on file but it never became coordinates. */
  hasAddressWithoutGps: boolean;
  teamId: string;
  teamName: string;
  managerName: string;
  /** The usable manager addresses, joined for display. Empty when there are none. */
  managerEmail: string;
  /**
   * Every usable address in the team's manager email field.
   *
   * A list because a live iRam team keeps THREE managers in that one field:
   * "a@example.co.,za; b@example.co.za; c@example.co.za". Read as a single
   * address it is invalid, and all 26 of that team's reps were held back.
   */
  managerEmails: string[];
  /** Reminders already sent, before this run. */
  timesReminded: number;
  lastRemindedAt: string | null;
  /**
   * Set when this rep will NOT be written to, and why. Absent means they will.
   *
   * Carried on the rep rather than kept in a second list so the two can never
   * disagree about the same person: every table that shows a rep can also show
   * why they are or are not being mailed, from the one field.
   */
  blockedReason?: ReminderBlockReason;
  /** Set by the sender when the mail to this rep was refused, so no table says "Emailed". */
  sendFailed?: boolean;
}

export interface BlockedRep extends OutstandingRep {
  reason: ReminderBlockReason;
}

export interface SettledRep {
  repId: string;
  code: string;
  name: string;
  /** How many reminders it took. */
  timesReminded: number;
}

export interface ReminderPlan {
  /** Every rep the router cannot start from home, regardless of contactability. */
  outstanding: OutstandingRep[];
  /** Of those, the ones that will actually be written to. */
  mailable: OutstandingRep[];
  /** Of those, the ones that will NOT, with the reason, so it can be fixed. */
  blocked: BlockedRep[];
  /** Reps who have a home fix now and had been reminded before. */
  settled: SettledRep[];
  /** One entry per manager ADDRESS with at least one outstanding rep. */
  managerDigests: ManagerDigest[];
  /**
   * Outstanding reps with no manager to copy: no team, or a team whose manager
   * has no email address. These are HELD BACK, not merely uncopied. Nobody is
   * chased without their manager on the same run.
   */
  repsWithNoManagerContact: number;
  /** Teams whose manager email field holds something that is not an address. */
  managerAddressIssues: ManagerAddressIssue[];
  totalReps: number;
  repsWithHome: number;
}

/**
 * A manager email field with a part that cannot be sent to.
 *
 * Said out loud rather than silently skipped. If the other addresses in the
 * field work, the team's reps are still chased and those managers copied, but
 * the broken one is never copied until somebody fixes it on the Teams page.
 */
export interface ManagerAddressIssue {
  teamName: string;
  /** Exactly what is stored, so it can be found and corrected. */
  storedValue: string;
  /** How many addresses in the field DO work. 0 means the team's reps are held back. */
  usableCount: number;
  /** Outstanding reps in that team, i.e. how much the bad value is costing. */
  outstandingReps: number;
}

export interface ManagerDigest {
  managerName: string;
  managerEmail: string;
  /**
   * Every team this address manages that has an outstanding rep, joined.
   *
   * iRam differs from Clippa here: 21 teams share 19 manager addresses, so one
   * manager can run two teams. The digest is one mail per ADDRESS, and naming
   * only the first team would make the second team's reps look misfiled.
   */
  teamName: string;
  reps: OutstandingRep[];
}

export interface ClassifyInput {
  reps: Rep[];
  users: User[];
  teams: Team[];
  stores: Store[];
  state: ReminderStateMap;
}

/**
 * Has this rep got a home the route engine will actually anchor on?
 *
 * Delegates to the engine's own parser rather than re-testing "both fields are
 * non-blank". The engine rejects (0,0) and out-of-range values too, and a rep
 * carrying "0"/"0" would otherwise be counted as done here and still routed from
 * the centroid there.
 */
export function hasRoutableHome(rep: Rep): boolean {
  return parseRepHome(rep.homeGpsLat, rep.homeGpsLng) !== null;
}

/** The same shape the Reps page uses, so both agree on an unusable address. */
export function hasUsableEmail(rep: Pick<Rep, "email">): boolean {
  // Every domain label must be non-empty: "a@example.co.,za" split on the comma
  // leaves "a@example.co.", which the looser pattern accepted and Resend refuses.
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test((rep.email || "").trim());
}

/**
 * Does this rep have a login they could sign in with?
 *
 * By `repId` first, which is what the Create Account button stores, falling back
 * to the email match. Getting this wrong in the lenient direction is the
 * expensive one: mailing "sign in and set your address" to somebody with no
 * account sends them at a login screen that will refuse them.
 */
export function findRepLogin(rep: Rep, users: User[]): User | null {
  const byId = users.find((u) => u.repId && u.repId === rep.id);
  if (byId) return byId;
  const email = normaliseEmail(rep.email);
  if (!email) return null;
  return users.find((u) => normaliseEmail(u.email) === email) ?? null;
}

/**
 * Where the run summary goes, from a comma- or semicolon-separated setting.
 *
 * A list rather than one address because iRam asked for two people. Kept out of
 * the code because this repository is public, so real addresses live in the
 * REMINDER_SUMMARY_TO environment variable. Anything that is not an address is
 * dropped, and duplicates collapse, so a stray comma cannot mail nobody twice.
 */
export function parseRecipients(value: string | undefined | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of (value || "").split(/[,;]/)) {
    const email = part.trim();
    if (!hasUsableEmail({ email })) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

/**
 * Stores per rep code.
 *
 * Unlike Clippa, an iRam store has no "closed" flag, so every allocated store
 * counts. The number only orders the list and gives the rep a reason; it gates
 * nothing.
 */
function storesByCode(stores: Store[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const s of stores) {
    const code = String(s.repCode || "").trim().toUpperCase();
    if (!code) continue;
    counts.set(code, (counts.get(code) || 0) + 1);
  }
  return counts;
}

export function classifyReps(input: ClassifyInput): ReminderPlan {
  const { reps, users, teams, stores, state } = input;
  const counts = storesByCode(stores);
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const outstanding: OutstandingRep[] = [];
  const settled: SettledRep[] = [];
  let repsWithHome = 0;

  for (const rep of reps) {
    const prior = state[rep.id];

    if (hasRoutableHome(rep)) {
      repsWithHome++;
      // Only worth reporting if we had been chasing them. A rep who was set up
      // correctly on day one is not news every week for the rest of time.
      if (prior && prior.count > 0) {
        settled.push({ repId: rep.id, code: rep.code, name: rep.name, timesReminded: prior.count });
      }
      continue;
    }

    const team = rep.teamId ? teamById.get(rep.teamId) : undefined;
    const managerEmails = team ? parseRecipients(team.managerEmail) : [];
    outstanding.push({
      repId: rep.id,
      code: rep.code,
      name: rep.name,
      email: (rep.email || "").trim(),
      activeStores: counts.get(String(rep.code || "").trim().toUpperCase()) ?? 0,
      hasAddressWithoutGps: !!(rep.homeAddress || "").trim(),
      teamId: rep.teamId || "",
      // Live iRam team names carry trailing spaces ("Eastern Cape ", "RVL ").
      teamName: (team?.name || "").trim(),
      managerName: (team?.managerName || "").trim(),
      managerEmail: managerEmails.join(", "),
      managerEmails,
      timesReminded: prior?.count ?? 0,
      lastRemindedAt: prior?.lastSentAt ?? null,
    });
  }

  // Most stores first, so the person costing the most driving is the first name
  // anyone reads, not whoever sorts alphabetically.
  outstanding.sort((a, b) => b.activeStores - a.activeStores || a.code.localeCompare(b.code));

  const repById = new Map(reps.map((r) => [r.id, r]));
  let repsWithNoManagerContact = 0;

  // The blocking rules, most specific first. A rep is written to only when all
  // three hold: somewhere to send it, an account to sign into, and a manager
  // who is copied on the same run.
  for (const o of outstanding) {
    const rep = repById.get(o.repId)!;
    const managerReachable = o.managerEmails.length > 0;
    if (!managerReachable) repsWithNoManagerContact++;

    if (!hasUsableEmail(rep)) o.blockedReason = "no_email";
    else if (!findRepLogin(rep, users)) o.blockedReason = "no_login";
    // Carl's rule, 3 Sep 2026: nobody is chased unless their manager is chased
    // with them. An automated mail nobody is following up gets ignored.
    else if (!managerReachable) o.blockedReason = "no_manager";
  }

  const mailable = outstanding.filter((o) => !o.blockedReason);
  const blocked = outstanding.filter((o) => o.blockedReason).map((o) => ({ ...o, reason: o.blockedReason! }));

  // Managers are copied about their own reps only. The digest lists every one of
  // their outstanding reps, INCLUDING any held back for a missing login or email:
  // "this one needs an account" is exactly the thing a manager can act on.
  const digests = new Map<string, ManagerDigest & { teams: string[] }>();
  // One digest per ADDRESS: a team with several managers copies each of them.
  for (const o of outstanding) {
    for (const address of o.managerEmails) {
      const key = normaliseEmail(address);
      const existing = digests.get(key);
      if (existing) {
        if (!existing.reps.includes(o)) existing.reps.push(o);
        if (o.teamName && !existing.teams.includes(o.teamName)) existing.teams.push(o.teamName);
      } else {
        digests.set(key, {
          managerName: o.managerName,
          managerEmail: address,
          teamName: "",
          teams: o.teamName ? [o.teamName] : [],
          reps: [o],
        });
      }
    }
  }

  // A manager field holding anything unsendable is reported, whether or not the
  // rest of the field works. Only teams that have someone outstanding: a typo on
  // a team with nobody to chase is not this job's news.
  const outstandingByTeam = new Map<string, number>();
  for (const o of outstanding) if (o.teamId) outstandingByTeam.set(o.teamId, (outstandingByTeam.get(o.teamId) || 0) + 1);
  const managerAddressIssues: ManagerAddressIssue[] = [];
  for (const t of teams) {
    const stored = (t.managerEmail || "").trim();
    const outstandingReps = outstandingByTeam.get(t.id) || 0;
    if (!stored || !outstandingReps) continue;
    const parts = stored.split(/[,;]/).map((p) => p.trim()).filter(Boolean);
    const usableCount = parseRecipients(stored).length;
    if (parts.every((p) => hasUsableEmail({ email: p }))) continue;
    managerAddressIssues.push({ teamName: (t.name || "").trim(), storedValue: stored, usableCount, outstandingReps });
  }

  return {
    outstanding,
    mailable,
    blocked,
    settled,
    // Joined with a comma, not "&": a live iRam team is called "Makro & CC (Main Store)".
    managerDigests: [...digests.values()].map(({ teams: names, ...d }) => ({ ...d, teamName: names.join(", ") })),
    repsWithNoManagerContact,
    managerAddressIssues,
    totalReps: reps.length,
    repsWithHome,
  };
}

// ── The mails ────────────────────────────────────────────────────────────
//
// No em dashes in anything a rep or manager reads: they read as machine-written.

/** Shared chrome, so all three read as one system, in iRam's colours. */
function shell(title: string, preview: string, body: string): string {
  // The logo is grey on transparent, so every panel behind it must stay light.
  const logoUrl = `${resolveAppUrl()}/iram-logo.png`;
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${title}</title>
  </head>
  <body style="margin:0;padding:0;background:${BRAND.greenLighter};">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preview}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.greenLighter};">
      <tr>
        <td align="center" style="padding:32px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #e6ebe0;border-radius:14px;overflow:hidden;">
            <tr>
              <td align="center" style="padding:30px 32px 22px 32px;background:#ffffff;">
                <img src="${logoUrl}" alt="iRam" width="120" style="display:block;border:0;outline:none;text-decoration:none;width:120px;height:auto;">
              </td>
            </tr>
            <tr><td style="height:4px;line-height:4px;font-size:0;background:${BRAND.green};">&nbsp;</td></tr>
${body}
            <tr>
              <td style="padding:26px 32px 26px 32px;">
                <div style="height:1px;background:#eef1ea;font-size:0;line-height:0;">&nbsp;</div>
              </td>
            </tr>
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
            <tr>
              <td align="center" style="padding:16px 12px 0 12px;font-family:Helvetica,Arial,sans-serif;font-size:11px;color:${BRAND.grey};">
                iRam Route Planner &middot; Powered by OuterJoin
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export interface RepReminderInput {
  name: string;
  /** Reminders already sent. 0 means this is the first one. */
  timesReminded: number;
  activeStores: number;
  /** They typed an address but it never resolved, so the ask is different. */
  hasAddressWithoutGps: boolean;
}

/**
 * The mail the rep gets.
 *
 * It asks for ONE thing and gives the reason in the rep's own currency: less
 * driving. Nothing is escalated as the count rises. A mail that starts polite
 * and turns stern reads as an automated telling-off, and the person on the
 * receiving end usually never got the first one. It carries a forgot-password
 * link, because "sign in" is useless advice to somebody whose welcome mail is
 * weeks buried or never arrived.
 */
export function buildRepReminderEmail(input: RepReminderInput): { subject: string; html: string; text: string } {
  const appUrl = resolveAppUrl();
  const accountUrl = `${appUrl}/account`;
  const forgotUrl = `${appUrl}/forgot-password`;
  const name = escapeHtml(input.name);
  const storeWord = input.activeStores === 1 ? "store" : "stores";

  const storeLine =
    input.activeStores > 0
      ? `You call on <strong>${input.activeStores} ${storeWord}</strong>, and right now every one of those days is planned from the middle of your area instead of from your front door.`
      : `Your week is planned from the middle of your area instead of from your front door.`;

  const ask = input.hasAddressWithoutGps
    ? `We have an address for you, but we could not pin it on the map, so your route still cannot start from home. ` +
      `Standing at home, open your profile and tap <strong>Use my current location</strong>. That fixes it exactly.`
    : `Open your profile and tell us where you live. It takes about a minute.`;

  const body = `
            <tr>
              <td style="padding:32px 32px 8px 32px;font-family:Helvetica,Arial,sans-serif;">
                <h1 style="margin:0 0 6px 0;font-size:22px;line-height:1.3;color:${BRAND.dark};font-weight:bold;">Where does your day start?</h1>
                <p style="margin:0;font-size:14px;color:${BRAND.grey};">About a minute, and it saves you driving</p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 0 32px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${BRAND.dark};">
                <p style="margin:0 0 14px 0;">Hi ${name},</p>
                <p style="margin:0 0 14px 0;">${storeLine}</p>
                <p style="margin:0;">${ask}</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:26px 32px 6px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="center" style="background:${BRAND.green};border-radius:8px;">
                      <a href="${accountUrl}" style="display:inline-block;padding:13px 30px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">Set my home address</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:12px 32px 0 32px;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:${BRAND.grey};">
                or paste this into your browser:<br>
                <a href="${accountUrl}" style="color:${BRAND.greenDark};text-decoration:none;">${accountUrl}</a>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 0 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.greenLighter};border:1px solid ${BRAND.greenLight};border-radius:10px;">
                  <tr>
                    <td style="padding:16px 20px 18px 20px;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.7;color:${BRAND.dark};">
                      <strong style="font-size:14px;">How to do it</strong><br>
                      1. Sign in and open <strong>Account</strong>.<br>
                      2. Find <strong>Where your day starts</strong>.<br>
                      3. Standing at home, tap <strong>Use my current location</strong>.<br>
                      <span style="color:${BRAND.grey};">Step 3 is the one that matters: it pins your home exactly, even if your address is hard to find on a map.</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 0 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-left:3px solid ${BRAND.green};">
                  <tr>
                    <td style="padding:2px 0 2px 14px;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:${BRAND.dark};">
                      Can't sign in? <a href="${forgotUrl}" style="color:${BRAND.greenDark};">Set a new password here</a> and we'll email you a link.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 0 32px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${BRAND.dark};">
                <p style="margin:0;">Thanks,<br><strong>The iRam Team</strong></p>
              </td>
            </tr>`;

  const text = [
    `Hi ${input.name},`,
    ``,
    input.activeStores > 0
      ? `You call on ${input.activeStores} ${storeWord}, and right now every one of those days is planned from the middle of your area instead of from your front door.`
      : `Your week is planned from the middle of your area instead of from your front door.`,
    ``,
    input.hasAddressWithoutGps
      ? `We have an address for you, but we could not pin it on the map, so your route still cannot start from home. Standing at home, open your profile and tap "Use my current location". That fixes it exactly.`
      : `Open your profile and tell us where you live. It takes about a minute.`,
    ``,
    `Set your home address: ${accountUrl}`,
    ``,
    `How to do it:`,
    `  1. Sign in and open Account.`,
    `  2. Find "Where your day starts".`,
    `  3. Standing at home, tap "Use my current location".`,
    ``,
    `Step 3 is the one that matters: it pins your home exactly, even if your`,
    `address is hard to find on a map.`,
    ``,
    `Can't sign in? Set a new password at ${forgotUrl} and we'll email you a link.`,
    ``,
    `Thanks,`,
    `The iRam Team`,
  ].join("\n");

  return {
    subject: "Please set your home address on iRam Route Planner",
    html: shell("Where does your day start?", "Your route is planned from your front door, once we know where it is.", body),
    text,
  };
}

/** What a row says about a rep who is not being written to this week. */
function rowStatus(r: OutstandingRep): string {
  if (r.sendFailed) return "Send failed";
  if (!r.blockedReason) return "Emailed";
  if (r.blockedReason === "no_login") return "Needs a login first";
  if (r.blockedReason === "no_email") return "No email address";
  return "Not emailed";
}

/**
 * A plain HTML table of reps, used by both the manager and the admin mail.
 *
 * The status column is not decoration. A manager reading a list of names
 * assumes every one of them got the mail, and would chase the one person who
 * never did for ignoring a message they never received.
 */
function repTable(reps: OutstandingRep[], includeReminderCount: boolean, includeStatus = false): string {
  const head = ["Rep", "Code", "Stores", ...(includeReminderCount ? ["Reminders"] : []), ...(includeStatus ? ["Status"] : [])]
    .map(
      (h) =>
        `<th align="left" style="padding:6px 10px;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${BRAND.grey};border-bottom:1px solid #e6ebe0;">${h}</th>`
    )
    .join("");
  const rows = reps
    .map((r) => {
      const cells = [
        escapeHtml(r.name),
        escapeHtml(r.code),
        String(r.activeStores),
        ...(includeReminderCount ? [String(r.timesReminded)] : []),
        ...(includeStatus
          ? [r.blockedReason ? `<span style="color:${WARN};">${escapeHtml(rowStatus(r))}</span>` : escapeHtml(rowStatus(r))]
          : []),
      ];
      return `<tr>${cells
        .map(
          (c) =>
            `<td style="padding:7px 10px;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:${BRAND.dark};border-bottom:1px solid #f1f4ee;">${c}</td>`
        )
        .join("")}</tr>`;
    })
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${head}</tr>${rows}</table>`;
}

export interface ManagerDigestEmailInput {
  managerName: string;
  teamName: string;
  reps: OutstandingRep[];
}

/**
 * What a team manager gets: their own reps only, and the fact that the reps have
 * already been written to. A manager who thinks they are the first to hear about
 * it chases people the app has already chased.
 */
export function buildManagerDigestEmail(input: ManagerDigestEmailInput): { subject: string; html: string; text: string } {
  const name = escapeHtml(input.managerName || "there");
  const team = escapeHtml(input.teamName || "your team");
  const n = input.reps.length;
  const stores = input.reps.reduce((sum, r) => sum + r.activeStores, 0);
  const storeWord = stores === 1 ? "store" : "stores";

  const body = `
            <tr>
              <td style="padding:32px 32px 8px 32px;font-family:Helvetica,Arial,sans-serif;">
                <h1 style="margin:0 0 6px 0;font-size:22px;line-height:1.3;color:${BRAND.dark};font-weight:bold;">${n} ${n === 1 ? "rep has" : "reps have"} no home address</h1>
                <p style="margin:0;font-size:14px;color:${BRAND.grey};">${team}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 0 32px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${BRAND.dark};">
                <p style="margin:0 0 14px 0;">Hi ${name},</p>
                <p style="margin:0 0 14px 0;">
                  Routes are planned outwards from where a rep lives. Until these reps set their home
                  address, their days are planned from the middle of their area instead, which usually
                  means more driving and fewer calls. Between them they cover
                  <strong>${stores} ${storeWord}</strong>.
                </p>
                <p style="margin:0;">
                  Everyone marked <strong>Emailed</strong> below has been written to directly with
                  instructions. You are copied so you know who to ask about it.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 32px 0 32px;">${repTable(input.reps, true, true)}</td>
            </tr>
            <tr>
              <td style="padding:22px 32px 0 32px;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:${BRAND.grey};">
                "Reminders" is how many times we have already asked. All they need to do is sign in,
                open Account, and tap "Use my current location" while standing at home. Anyone not
                marked Emailed could not be written to, and needs sorting out on the Route Planner first.
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 0 32px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${BRAND.dark};">
                <p style="margin:0;">Thanks,<br><strong>iRam Route Planner</strong></p>
              </td>
            </tr>`;

  const text = [
    `Hi ${input.managerName || "there"},`,
    ``,
    `${n} ${n === 1 ? "rep" : "reps"} in ${input.teamName || "your team"} ${n === 1 ? "has" : "have"} no home address on iRam Route Planner.`,
    ``,
    `Routes are planned outwards from where a rep lives. Until they set it, their`,
    `days are planned from the middle of their area instead, which usually means`,
    `more driving and fewer calls. Between them they cover ${stores} ${storeWord}.`,
    ``,
    ...input.reps.map(
      (r) =>
        `  ${r.code.padEnd(10)} ${r.name.padEnd(28)} ${String(r.activeStores).padStart(4)} stores   ${r.timesReminded} reminder(s)   ${rowStatus(r)}`
    ),
    ``,
    `Everyone marked Emailed has been written to directly with instructions. You are`,
    `copied so you know who to ask about it. Anyone not marked Emailed could not be`,
    `written to and needs sorting out on the Route Planner first.`,
    ``,
    `Thanks,`,
    `iRam Route Planner`,
  ].join("\n");

  return {
    subject: `${input.teamName || "Your team"}: ${n} ${n === 1 ? "rep has" : "reps have"} no home address`,
    html: shell("Reps with no home address", `${n} of your reps are still routed from the middle of their area rather than home.`, body),
    text,
  };
}

export interface AdminSummaryInput {
  plan: ReminderPlan;
  sent: number;
  failed: { code: string; name: string; email: string; reason: string }[];
  dryRun: boolean;
  managersEmailed: number;
  trigger: "cron" | "manual";
}

export const BLOCK_REASON_LABEL: Record<ReminderBlockReason, string> = {
  no_email: "No email address on file",
  no_login: "No login yet: create one on the Reps page",
  no_manager: "No team manager to copy: put them in a team on the Teams page",
};

/**
 * The run summary. It exists for two reasons and the second matters more: it
 * reports the run, and it PROVES the run happened at all. A cron that silently
 * stops has no symptom except mail that does not arrive, so this is sent even
 * when there was nothing to do, and it says so.
 */
export function buildAdminSummaryEmail(input: AdminSummaryInput): { subject: string; html: string; text: string } {
  const { plan, sent, failed, dryRun, managersEmailed, trigger } = input;
  const prefix = dryRun ? "[PREVIEW, nothing sent] " : "";

  const stat = (label: string, value: string | number, note = "") => `
              <tr>
                <td style="padding:8px 0;border-bottom:1px solid #f1f4ee;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:${BRAND.grey};">${label}${
                  note ? `<br><span style="font-size:11px;">${note}</span>` : ""
                }</td>
                <td align="right" style="padding:8px 0;border-bottom:1px solid #f1f4ee;font-family:Helvetica,Arial,sans-serif;font-size:17px;font-weight:bold;color:${BRAND.dark};">${value}</td>
              </tr>`;

  const settledBlock = plan.settled.length
    ? `
            <tr>
              <td style="padding:22px 32px 0 32px;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:${BRAND.dark};">
                <strong>Done since we started asking</strong><br>
                ${plan.settled
                  .map(
                    (s) =>
                      `${escapeHtml(s.code)} ${escapeHtml(s.name)} <span style="color:${BRAND.grey};">(after ${s.timesReminded} reminder${s.timesReminded === 1 ? "" : "s"})</span>`
                  )
                  .join("<br>")}
              </td>
            </tr>`
    : "";

  // Grouped by reason. Ungrouped, a long run of identical lines buries the few
  // rows that are a genuinely different problem.
  const byReason = new Map<ReminderBlockReason, BlockedRep[]>();
  for (const b of plan.blocked) {
    const list = byReason.get(b.reason);
    if (list) list.push(b);
    else byReason.set(b.reason, [b]);
  }

  const blockedBlock = plan.blocked.length
    ? `
            <tr>
              <td style="padding:22px 32px 0 32px;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:${BRAND.dark};">
                <strong>Not emailed (${plan.blocked.length})</strong><br>
                <span style="color:${BRAND.grey};font-size:13px;">These reps need a home address and were held back. Each line says what to fix.</span>
                ${[...byReason.entries()]
                  .map(
                    ([reason, list]) => `<br><br>
                <span style="color:${WARN};font-weight:bold;">${BLOCK_REASON_LABEL[reason]} (${list.length})</span><br>
                ${list.map((b) => `${escapeHtml(b.code)} ${escapeHtml(b.name)} <span style="color:${BRAND.grey};">(${b.activeStores} stores)</span>`).join("<br>")}`
                  )
                  .join("")}
              </td>
            </tr>`
    : "";

  const failedBlock = failed.length
    ? `
            <tr>
              <td style="padding:22px 32px 0 32px;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:${BRAND.dark};">
                <strong style="color:#B91C1C;">Failed to send (${failed.length})</strong><br>
                ${failed
                  .map(
                    (f) =>
                      `${escapeHtml(f.code)} ${escapeHtml(f.name)} &lt;${escapeHtml(f.email)}&gt;<br><span style="color:${BRAND.grey};font-size:12px;">${escapeHtml(f.reason)}</span>`
                  )
                  .join("<br>")}
              </td>
            </tr>`
    : "";

  const issuesBlock = plan.managerAddressIssues.length
    ? `
            <tr>
              <td style="padding:22px 32px 0 32px;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:${BRAND.dark};">
                <strong style="color:${WARN};">Manager email needs fixing on the Teams page (${plan.managerAddressIssues.length})</strong><br>
                ${plan.managerAddressIssues
                  .map(
                    (i) =>
                      `${escapeHtml(i.teamName)}: <code>${escapeHtml(i.storedValue)}</code><br><span style="color:${BRAND.grey};font-size:12px;">${
                        i.usableCount > 0
                          ? `${i.usableCount} of the addresses work and were used. The broken part is never copied.`
                          : `Nothing in it can be sent to, so its ${i.outstandingReps} reps are held back.`
                      }</span>`
                  )
                  .join("<br>")}
              </td>
            </tr>`
    : "";

  const top = plan.outstanding.slice(0, 10);

  const body = `
            <tr>
              <td style="padding:32px 32px 8px 32px;font-family:Helvetica,Arial,sans-serif;">
                <h1 style="margin:0 0 6px 0;font-size:22px;line-height:1.3;color:${BRAND.dark};font-weight:bold;">Home address reminders</h1>
                <p style="margin:0;font-size:14px;color:${BRAND.grey};">${
                  dryRun ? "Preview only, no email was sent to any rep" : trigger === "cron" ? "Weekly run" : "Sent by hand"
                }</p>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 32px 0 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${stat("Reps with no home the router can use", plan.outstanding.length, `of ${plan.totalReps} reps`)}
${stat(dryRun ? "Would be emailed" : "Reminders sent", dryRun ? plan.mailable.length : sent)}
${stat(dryRun ? "Managers who would be copied" : "Team managers copied", dryRun ? plan.managerDigests.length : managersEmailed)}
${stat("Held back, no team manager", plan.repsWithNoManagerContact, plan.repsWithNoManagerContact > 0 ? "Put them in a team and they join the next run" : "")}
${stat("Reps now anchored on home", plan.repsWithHome)}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 32px 6px 32px;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:${BRAND.dark};">
                <strong>Most stores first${plan.outstanding.length > top.length ? `, top ${top.length}` : ""}</strong>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px;">${repTable(top, true, true)}</td>
            </tr>
${issuesBlock}
${settledBlock}
${blockedBlock}
${failedBlock}
            <tr>
              <td style="padding:26px 32px 0 32px;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:${BRAND.grey};">
                A rep counts as done only when the router can actually start from their home. An
                address that never resolved to coordinates still leaves them planned from the middle
                of their area. Runs every Monday at 08:00.
              </td>
            </tr>`;

  const text = [
    `${prefix}Home address reminders: ${dryRun ? "preview" : trigger === "cron" ? "weekly run" : "sent by hand"}`,
    ``,
    `Reps with no usable home: ${plan.outstanding.length} of ${plan.totalReps}`,
    `${dryRun ? "Would be emailed" : "Reminders sent"}:      ${dryRun ? plan.mailable.length : sent}`,
    `Team managers copied:     ${dryRun ? plan.managerDigests.length : managersEmailed}`,
    `Held back, no manager:    ${plan.repsWithNoManagerContact}${plan.repsWithNoManagerContact > 0 ? ` (put them in a team and they join the next run)` : ""}`,
    `Reps anchored on home:    ${plan.repsWithHome}`,
    ``,
    `Most stores first:`,
    ...top.map(
      (r) =>
        `  ${r.code.padEnd(10)} ${r.name.padEnd(28)} ${String(r.activeStores).padStart(4)} stores   ${r.timesReminded} reminder(s)   ${rowStatus(r)}`
    ),
    ...(plan.managerAddressIssues.length
      ? [
          ``,
          `Manager email needs fixing on the Teams page (${plan.managerAddressIssues.length}):`,
          ...plan.managerAddressIssues.map(
            (i) =>
              `  ${i.teamName}: "${i.storedValue}" (${
                i.usableCount > 0 ? `${i.usableCount} address(es) work and were used` : `nothing usable, ${i.outstandingReps} reps held back`
              })`
          ),
        ]
      : []),
    ...(plan.settled.length
      ? [``, `Done since we started asking:`, ...plan.settled.map((s) => `  ${s.code} ${s.name} (after ${s.timesReminded} reminder(s))`)]
      : []),
    ...(plan.blocked.length
      ? [
          ``,
          `Not emailed (${plan.blocked.length}):`,
          ...[...byReason.entries()].flatMap(([reason, list]) => [
            ``,
            `  ${BLOCK_REASON_LABEL[reason]} (${list.length}):`,
            ...list.map((b) => `    ${b.code} ${b.name} (${b.activeStores} stores)`),
          ]),
        ]
      : []),
    ...(failed.length ? [``, `Failed to send (${failed.length}):`, ...failed.map((f) => `  ${f.code} ${f.name} <${f.email}>: ${f.reason}`)] : []),
    ``,
    `A rep counts as done only when the router can actually start from their home.`,
    `Runs every Monday at 08:00.`,
  ].join("\n");

  return {
    subject: `${prefix}Home addresses: ${plan.outstanding.length} outstanding, ${dryRun ? plan.mailable.length : sent} ${
      dryRun ? "would be emailed" : "emailed"
    }`,
    html: shell("Home address reminders", `${plan.outstanding.length} reps still have no home fix.`, body),
    text,
  };
}
