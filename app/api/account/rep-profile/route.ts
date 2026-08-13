import { NextRequest, NextResponse } from "next/server";
import { getReps, saveReps, getUsers } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import { geocodeAddress, isConfidentGeocode, hasGoogleMapsKey } from "@/lib/google-maps";
import { Rep, SessionPayload } from "@/lib/types";

/**
 * A rep maintaining their OWN rep record — in practice, the home address the
 * route engine anchors their day on.
 *
 * This exists as a separate route from PUT /api/reps precisely so that it can
 * be narrow: it writes three fields, on one record, chosen by the server. The
 * rep record id is never read from the request body — a body-supplied id is
 * exactly how `/api/auth/change-password` became an account-takeover path.
 *
 * Capturing the device's coordinates is the point of the whole feature. The 24
 * addresses on file are largely informal ("Stand no 644 moletjie ga semenya
 * polokwane") and Google answers those with a suburb centroid and no error, so
 * no amount of geocoding will place them. A rep standing in their own kitchen
 * tapping "use my current location" is the only source that actually knows.
 */

/**
 * Which Rep record belongs to this login.
 *
 * By id when the account was created from a rep (which is what the Create
 * Account button does), falling back to the email match the session already
 * uses. The fallback is what keeps any account made before `repId` existed —
 * or made by hand in User Admin — working.
 */
async function resolveOwnRep(session: SessionPayload): Promise<Rep | null> {
  const reps = await getReps();
  const users = await getUsers();
  const user = users.find((u) => u.id === session.userId);

  if (user?.repId) {
    const byId = reps.find((r) => r.id === user.repId);
    if (byId) return byId;
  }
  if (session.repCode) {
    const byCode = reps.find((r) => r.code === session.repCode);
    if (byCode) return byCode;
  }
  const email = (session.email || "").toLowerCase().trim();
  return reps.find((r) => (r.email || "").toLowerCase().trim() === email) ?? null;
}

/** Never hand back the whole rep record — only what the profile page edits. */
function publicView(rep: Rep) {
  return {
    id: rep.id,
    code: rep.code,
    name: rep.name,
    homeAddress: rep.homeAddress || "",
    homeGpsLat: rep.homeGpsLat || "",
    homeGpsLng: rep.homeGpsLng || "",
    hasCoordinates: !!((rep.homeGpsLat || "").trim() && (rep.homeGpsLng || "").trim()),
  };
}

export async function GET() {
  try {
    const session = await requireSession();
    const rep = await resolveOwnRep(session);
    if (!rep) {
      // An admin has a login but no rep record, and that is normal — the page
      // just doesn't show the card. Not an error.
      return NextResponse.json({ rep: null });
    }
    return NextResponse.json({ rep: publicView(rep) });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("Unauthorized")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * Body: { homeAddress } to type an address, and/or { lat, lng } captured from
 * the device. Device coordinates are authoritative and are stored as given —
 * they are a measurement, not a guess, so they skip the confidence gate that
 * exists to catch bad geocodes.
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await requireSession();
    const rep = await resolveOwnRep(session);
    if (!rep) {
      return NextResponse.json(
        { error: "This login isn't linked to a rep record, so there is no profile to update. Ask your administrator." },
        { status: 404 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { homeAddress, lat, lng } = body as {
      homeAddress?: string;
      lat?: number;
      lng?: number;
    };

    const reps = await getReps();
    const idx = reps.findIndex((r) => r.id === rep.id);
    if (idx === -1) return NextResponse.json({ error: "Rep not found" }, { status: 404 });

    const hasDeviceFix = typeof lat === "number" && typeof lng === "number";
    if (hasDeviceFix && !isPlausibleCoordinate(lat, lng)) {
      return NextResponse.json(
        { error: "Those coordinates aren't a real place. Try again with location turned on." },
        { status: 400 }
      );
    }

    const addressGiven = typeof homeAddress === "string";
    const trimmedAddress = (homeAddress || "").trim();
    const addressChanged =
      addressGiven && trimmedAddress !== (reps[idx].homeAddress || "").trim();

    if (addressGiven) reps[idx].homeAddress = trimmedAddress;

    let note = "";
    let precise = false;

    if (hasDeviceFix) {
      reps[idx].homeGpsLat = String(lat);
      reps[idx].homeGpsLng = String(lng);
      precise = true;
      note = "Saved the exact spot you're standing in. Your route will now start from here.";
    } else if (addressChanged) {
      // A changed address invalidates coordinates derived from the old one —
      // the same rule PUT /api/reps follows. Leaving them would anchor the
      // rep's week on where they used to live, silently and plausibly.
      reps[idx].homeGpsLat = "";
      reps[idx].homeGpsLng = "";

      if (trimmedAddress && hasGoogleMapsKey()) {
        const g = await geocodeAddress(trimmedAddress);
        if (g && isConfidentGeocode(g)) {
          reps[idx].homeGpsLat = String(g.lat);
          reps[idx].homeGpsLng = String(g.lng);
          precise = true;
          note = `Found it — ${g.formattedAddress}. Your route will now start from there.`;
        } else if (g) {
          note =
            "We found the area but not the exact spot, so your route can't start from home yet. " +
            "Tap \"Use my current location\" while you're at home and it will be exact.";
        } else {
          note =
            "We couldn't find that address on the map. Tap \"Use my current location\" while " +
            "you're at home and we won't need to look it up at all.";
        }
      } else if (trimmedAddress) {
        note = "Address saved. Tap \"Use my current location\" while you're at home to pin it exactly.";
      }
    }

    await saveReps(reps);

    logActivity({
      action: "Rep updated own profile",
      actor: session.email,
      actorName: session.name,
      summary: `${reps[idx].name} (${reps[idx].code}) updated their home ${
        hasDeviceFix ? "location from their device" : "address"
      }`,
    });

    return NextResponse.json({
      rep: publicView(reps[idx]),
      precise,
      note,
    });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("Unauthorized")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * A sanity check, not a South Africa check — a rep could legitimately capture
 * their location while abroad. It only rejects the values that mean "no fix":
 * out-of-range numbers and the (0,0) placeholder in the Gulf of Guinea that
 * has bitten this app before.
 */
function isPlausibleCoordinate(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) return false;
  return true;
}
