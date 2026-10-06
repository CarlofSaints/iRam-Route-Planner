import { NextRequest, NextResponse } from "next/server";
import { getReps, saveReps } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { logActivity } from "@/lib/activityLog";
import { geocodeAddress, isConfidentGeocode, hasGoogleMapsKey } from "@/lib/google-maps";
import { Rep } from "@/lib/types";
import { resolveOwnRep } from "@/lib/ownRep";
import { checkCoordinate } from "@/lib/saCoordinates";

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
    const { homeAddress, lat, lng, source } = body as {
      homeAddress?: string;
      lat?: number;
      lng?: number;
      /** "map" when the rep dropped the pin themselves; absent = device GPS. */
      source?: string;
    };
    const fromMap = source === "map";

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
    const hadPin = !!((reps[idx].homeGpsLat || "").trim() && (reps[idx].homeGpsLng || "").trim());

    if (addressGiven) reps[idx].homeAddress = trimmedAddress;

    let note = "";
    let precise = false;
    // Where Google THINKS the address is, when it is not sure enough to save.
    // The page opens the pin map there so the rep only has to nudge it onto
    // their house, instead of being left with an address and no pin, and a
    // weekly email telling them to do what they believe they already did.
    let approx: { lat: number; lng: number; formattedAddress: string } | null = null;

    if (hasDeviceFix) {
      reps[idx].homeGpsLat = String(lat);
      reps[idx].homeGpsLng = String(lng);
      precise = true;
      note = fromMap
        ? "Saved your pin. Your route will now start from there."
        : "Saved the exact spot you're standing in. Your route will now start from here.";
    } else if (addressChanged || (addressGiven && !hadPin)) {
      // A changed address invalidates coordinates derived from the old one —
      // the same rule PUT /api/reps follows. Leaving them would anchor the
      // rep's week on where they used to live, silently and plausibly.
      // An UNCHANGED address with no pin is looked up again too: those reps
      // (typed it weeks ago, never pinned) press Save expecting something to
      // happen, and need the map opened where Google thinks they live.
      reps[idx].homeGpsLat = "";
      reps[idx].homeGpsLng = "";

      if (trimmedAddress && hasGoogleMapsKey()) {
        const g = await geocodeAddress(trimmedAddress);
        if (g && isConfidentGeocode(g)) {
          reps[idx].homeGpsLat = String(g.lat);
          reps[idx].homeGpsLng = String(g.lng);
          precise = true;
          note = `Found it: ${g.formattedAddress}. Your route will now start from there.`;
        } else if (g) {
          // Only offered as a starting point when it is in South Africa. A
          // place name with no country can geocode to the USA, and a pin map
          // opened over another continent is no help to anyone.
          if (checkCoordinate(String(g.lat), String(g.lng)).problem === null) {
            approx = { lat: g.lat, lng: g.lng, formattedAddress: g.formattedAddress };
          }
          note =
            "We found the area but not your exact house, so your route can't start from home yet. " +
            "Drag the pin onto your house on the map and save it.";
        } else {
          note =
            'We couldn\'t find that address on the map. Tap "Drop a pin on the map" and put it on ' +
            'your house, or tap "Use my current location" while you\'re at home.';
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
        hasDeviceFix ? (fromMap ? "location by dropping a pin" : "location from their device") : "address"
      }`,
    });

    return NextResponse.json({
      rep: publicView(reps[idx]),
      precise,
      note,
      approx,
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
