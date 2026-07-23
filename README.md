# iRam Route Planner

Builds optimal rep call-cycle routes from store allocations, and pulls actual visits back
from **Perigee** for planned-vs-actual reporting.

Next.js (App Router, TypeScript) + Vercel Blob + Google Maps / Leaflet. Adapted from the
Clippa Sales Rep Router; the Repsly integration has been replaced with Perigee.

## Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `BLOB_READ_WRITE_TOKEN` | yes | Vercel Blob store. Without it the app falls back to local JSON files under `data/`. |
| `GOOGLE_MAPS_API_KEY` | recommended | Directions API, used to order each day's stops and to geocode provinces. Falls back to Haversine nearest-neighbour if absent. |
| `CRON_SECRET` | yes (prod) | Vercel sends this as `Authorization: Bearer <secret>` to `/api/cron/poll-visits`. Without it, only a signed-in admin can trigger a poll. |
| `RESEND_API_KEY`, `RESEND_FROM` | optional | Welcome emails for new users. |
| `NEXT_PUBLIC_APP_URL` | optional | Used in the welcome email link. |

The Perigee endpoint, bearer token and customer are **not** environment variables — they are
configured in the UI at **Control Centre → Perigee API** and stored in Blob.

## First run

1. `npm install && npm run dev`
2. `POST /api/seed` creates the super admin (`carl@outerjoin.co.za` / `iram2026`). Change the
   password immediately.
3. Upload the store list at **Control Centre → Store Upload**. `Representative ID` on each row
   is the store↔rep link — there is no separate allocation step.
4. Configure Perigee at **Control Centre → Perigee API**.

## Perigee integration

`POST https://live.perigeeportal.co.za/api/visits` with `Authorization: Bearer <token>` and a
body of `{ startDate, endDate, customers: [...], page }`. The response is a Laravel-style
paginator (`{ visits: { data: [...], current_page, last_page, total } }`), so
`lib/perigeeApi.ts` walks **every** page rather than just the first, with guards for servers
that ignore the `page` parameter.

- `lib/perigeeApi.ts` — paginating fetch, request-body builder, raw row → `PerigeeVisit`
- `lib/perigeeData.ts` — Blob-backed config, schedule, visits, and logs
- `lib/perigeeImport.ts` — fetch → map → resolve rep → de-duplicate → store (shared by the
  admin page and the cron poller)
- `app/perigee/page.tsx` — connection settings, manual date-range pull, poll schedule, logs

Perigee identifies a rep by their login email. Visits are matched to a `repCode` by rep email,
then rep name, then falling back to whoever the visited store is allocated to. The admin page
reports how many visits in an import could not be matched.

## Scheduled polling

`vercel.json` runs `/api/cron/poll-visits` every 30 minutes. That endpoint does nothing unless
the current SAST time lands within 15 minutes of a **poll slot** configured in the UI:

- **short** — pulls today only
- **long** — pulls the last 7 days, so back-dated or edited visits are picked up

Imports are idempotent: re-pulling a range only stores visits that are not already held.
"Run Poll Now" on the admin page hits the same endpoint with `?force=true`.

## Known gaps

- `app/api/routes/perigee-export/route.ts` still uses the best-guess Repsly "Import Schedules"
  column layout. Confirm the headers against Perigee's own call-cycle import template.
- `app/api/stores/upload/route.ts` detects a site export by the `ID` / `Name` /
  `Representative ID` headers, which came from Repsly. Confirm against a real Perigee export.
