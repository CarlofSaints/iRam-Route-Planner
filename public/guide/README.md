# Guide screenshots

The guide at /guide expects the image files listed below. A slot with no file
renders as a labelled placeholder naming the shot, so a missing picture is
visible on the page rather than silently absent.

Either `.jpg` or `.png` works: the page tries jpg first, then png, then falls
back to the placeholder. Drop a file in with the exact name and it appears.
Nothing else to change.

| File | What to capture | Done |
|---|---|---|
| `channels-grid` | Control Centre > Channels, showing the per-role column groups with their switches, frequencies and durations | yes |
| `reps-import` | Reps page: Import Reps, Set Home GPS, Create Logins, and the Starts Day At and Login columns | yes |
| `store-upload` | Control Centre > Store Upload, showing the file chooser and the expected columns | yes |
| `visit-roles` | Control Centre > Visit Roles, showing each role with its fallback frequency, duration and range check | yes |
| `stores-gps` | Stores page with the GPS problems filter | yes |
| `routes-generate` | Routes page showing the call cycle type selector and the Generate Routes button | yes |
| `capacity` | Rep Capacity, showing utilisation per rep | yes |
| `map` | Map page showing every store coloured by rep | yes |
| `rep-account` | The /account page signed in as a REP, showing "Where your day starts" and the Use my current location button | **no** |

`rep-account` needs somebody signed in as a rep, so it cannot be captured from
an administrator's session. Ask a rep for a screenshot once they have set their
location, or make a throwaway rep with your own email and sign in as one.

Roughly 1400px wide is plenty. The page scales them to its own width.
