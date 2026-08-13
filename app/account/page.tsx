"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "@/components/SessionProvider";
import { ManagerInfo } from "@/lib/manager";

interface ProfileUser {
  id: string;
  name: string;
  email: string;
  role: string;
  cell?: string;
  profilePicUrl?: string;
}

interface RepProfile {
  id: string;
  code: string;
  name: string;
  homeAddress: string;
  homeGpsLat: string;
  homeGpsLng: string;
  hasCoordinates: boolean;
}

/**
 * Declared at module level, not inside AccountPage — a component defined inside
 * the page remounts on every keystroke and steals focus from the input it
 * contains. Same reason the Reps page declares its copy of this outside.
 */
function CheckAddressOnGoogle({ address }: { address?: string }) {
  const value = (address || "").trim();
  return (
    <button
      type="button"
      onClick={() =>
        window.open(
          `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value)}`,
          "_blank",
          "noopener,noreferrer"
        )
      }
      disabled={!value}
      title={value ? "Open this address in Google Maps" : "Type your address first"}
      className="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs font-medium text-iram-green transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:border-gray-100 disabled:text-gray-300"
    >
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z" strokeLinejoin="round" />
        <circle cx="12" cy="10" r="2.5" />
      </svg>
      Check on Google
    </button>
  );
}

export default function AccountPage() {
  const { session, refresh } = useSession();
  const [user, setUser] = useState<ProfileUser | null>(null);
  const [manager, setManager] = useState<ManagerInfo | null>(null);
  const [loading, setLoading] = useState(true);

  // Editable fields
  const [name, setName] = useState("");
  const [cell, setCell] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  // Password change
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwMessage, setPwMessage] = useState("");
  const [pwSaving, setPwSaving] = useState(false);

  // Avatar
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Home address — only present when this login is attached to a rep record
  const [rep, setRep] = useState<RepProfile | null>(null);
  const [homeAddress, setHomeAddress] = useState("");
  const [homeSaving, setHomeSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [homeMessage, setHomeMessage] = useState("");
  const [homeError, setHomeError] = useState("");

  useEffect(() => {
    fetch("/api/account")
      .then((r) => r.json())
      .then((data) => {
        if (data.user) {
          setUser(data.user);
          setName(data.user.name);
          setCell(data.user.cell || "");
        }
        if (data.manager) setManager(data.manager);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    fetch("/api/account/rep-profile")
      .then((r) => r.json())
      .then((data) => {
        if (data.rep) {
          setRep(data.rep);
          setHomeAddress(data.rep.homeAddress || "");
        }
      })
      .catch(() => {
        /* an admin with no rep record is the normal case, not an error */
      });
  }, []);

  /** One writer for both paths, so the address and a device fix can't diverge. */
  const saveHome = async (payload: { homeAddress?: string; lat?: number; lng?: number }) => {
    setHomeMessage("");
    setHomeError("");
    const res = await fetch("/api/account/rep-profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setHomeError(data.error || "Could not save your address");
      return;
    }
    setRep(data.rep);
    setHomeAddress(data.rep.homeAddress || "");
    if (data.note) setHomeMessage(data.note);
  };

  const saveAddress = async () => {
    setHomeSaving(true);
    await saveHome({ homeAddress });
    setHomeSaving(false);
  };

  /**
   * The whole point of the feature: the rep is standing at home, so the device
   * knows the answer exactly and nothing has to be geocoded. `enableHighAccuracy`
   * asks for the GPS fix rather than the coarse network one.
   */
  const useCurrentLocation = () => {
    setHomeMessage("");
    setHomeError("");

    if (!navigator.geolocation) {
      setHomeError("This device can't share its location. Type your address instead.");
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        await saveHome({
          homeAddress,
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        // Each of these needs a different action from the rep, so they must not
        // collapse into one "location failed".
        if (err.code === err.PERMISSION_DENIED) {
          setHomeError(
            "Location is blocked for this site. Allow it in your browser settings, then tap the button again."
          );
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setHomeError("Your device couldn't get a location fix. Try again outdoors or near a window.");
        } else {
          setHomeError("That took too long. Try again in a moment.");
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const saveProfile = async () => {
    setSaving(true);
    setMessage("");
    const res = await fetch("/api/account", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, cell }),
    });
    const data = await res.json();
    if (res.ok) {
      setMessage("Profile updated");
      refresh();
    } else {
      setMessage(data.error || "Failed to save");
    }
    setSaving(false);
    setTimeout(() => setMessage(""), 3000);
  };

  const changePassword = async () => {
    setPwMessage("");
    if (newPw !== confirmPw) {
      setPwMessage("Passwords do not match");
      return;
    }
    if (newPw.length < 6) {
      setPwMessage("Password must be at least 6 characters");
      return;
    }
    setPwSaving(true);
    const res = await fetch("/api/account", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
    });
    const data = await res.json();
    if (res.ok) {
      setPwMessage("Password changed successfully");
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      refresh();
    } else {
      setPwMessage(data.error || "Failed to change password");
    }
    setPwSaving(false);
    setTimeout(() => setPwMessage(""), 4000);
  };

  const uploadAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/account/avatar", { method: "POST", body: fd });
    const data = await res.json();
    if (res.ok && data.url) {
      setUser((prev) => prev ? { ...prev, profilePicUrl: data.url } : prev);
      refresh();
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const getInitials = (n: string) => {
    const parts = n.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return n.slice(0, 2).toUpperCase();
  };

  const roleLabel = (r: string) => {
    const map: Record<string, string> = {
      superAdmin: "Super Admin",
      admin: "Admin",
      teamManager: "Team Manager",
      rep: "Rep",
      viewer: "Viewer",
    };
    return map[r] || r;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-8 h-8 border-2 border-iram-green border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user || !session) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500">Not logged in</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      {/* Profile Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center gap-5">
          {/* Avatar */}
          <div className="relative group">
            {user.profilePicUrl ? (
              <img
                src={user.profilePicUrl}
                alt={user.name}
                className="w-20 h-20 rounded-full object-cover border-2 border-gray-200"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-iram-green flex items-center justify-center text-white text-xl font-bold border-2 border-gray-200">
                {getInitials(user.name)}
              </div>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
            >
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
              </svg>
            </button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={uploadAvatar} />
          </div>

          <div>
            <h1 className="text-xl font-bold text-gray-900">{user.name}</h1>
            <p className="text-sm text-gray-500">{user.email}</p>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium mt-1 bg-iram-green/10 text-iram-green">
              {roleLabel(user.role)}
            </span>
          </div>
        </div>
      </div>

      {/* Personal Details */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Personal Details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Email</label>
            <input
              value={user.email}
              disabled
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Cell Number</label>
            <input
              value={cell}
              onChange={(e) => setCell(e.target.value)}
              placeholder="e.g. 082 123 4567"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
            />
          </div>
        </div>
        <div className="flex items-center gap-4 mt-4">
          <button
            onClick={saveProfile}
            disabled={saving}
            className="px-4 py-2 bg-iram-green text-white text-sm font-medium rounded-lg hover:bg-iram-green-dark disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
          {message && (
            <span className={`text-sm ${message.includes("updated") ? "text-green-600" : "text-red-600"}`}>
              {message}
            </span>
          )}
        </div>
      </div>

      {/* Where the working day starts — only for logins attached to a rep */}
      {rep && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-sm font-semibold text-gray-700">Where your day starts</h2>
          <p className="mt-1 text-xs text-gray-500">
            Your route is planned outwards from here, so the closer this is to your front door, the less
            driving you do.
          </p>

          {/* Current state, said plainly — a rep should never have to guess whether this is set */}
          <div
            className={`mt-4 flex items-start gap-2.5 rounded-lg border p-3 text-xs ${
              rep.hasCoordinates
                ? "border-iram-green/30 bg-iram-green/5 text-gray-700"
                : "border-amber-200 bg-amber-50 text-amber-900"
            }`}
          >
            <svg
              className={`mt-0.5 h-4 w-4 flex-shrink-0 ${rep.hasCoordinates ? "text-iram-green" : "text-amber-500"}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z" strokeLinejoin="round" />
              <circle cx="12" cy="10" r="2.5" />
            </svg>
            <span>
              {rep.hasCoordinates ? (
                <>
                  <strong className="font-semibold">Your route starts at your home.</strong> Pinned at{" "}
                  {Number(rep.homeGpsLat).toFixed(5)}, {Number(rep.homeGpsLng).toFixed(5)}.
                </>
              ) : (
                <>
                  <strong className="font-semibold">We don&apos;t know where you live yet.</strong> Until you
                  set this, your day is planned from the middle of your stores instead of from home.
                </>
              )}
            </span>
          </div>

          <div className="mt-4">
            <label className="block text-xs text-gray-500 mb-1">Home Address</label>
            <input
              value={homeAddress}
              onChange={(e) => setHomeAddress(e.target.value)}
              placeholder="e.g. 12 Kruger Street, Polokwane"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <CheckAddressOnGoogle address={homeAddress} />
              <button
                onClick={saveAddress}
                disabled={homeSaving || locating}
                className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-gray-900 disabled:opacity-50"
              >
                {homeSaving ? "Saving..." : "Save address"}
              </button>
            </div>
          </div>

          {/* The exact answer. A typed address in a rural area geocodes to a
              suburb centroid; standing in the doorway does not. */}
          <div className="mt-5 border-t border-gray-100 pt-4">
            <button
              onClick={useCurrentLocation}
              disabled={locating || homeSaving}
              className="inline-flex items-center gap-2 rounded-lg bg-iram-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-iram-green-dark disabled:opacity-50"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <circle cx="12" cy="12" r="3.5" />
                <path d="M12 2v3M12 19v3M2 12h3M19 12h3" strokeLinecap="round" />
              </svg>
              {locating ? "Getting your location..." : "Use my current location"}
            </button>
            <p className="mt-2 text-xs text-gray-500">
              Do this <strong className="font-semibold">while you are at home</strong> — it pins the exact
              spot, which matters most if your address is hard to find on a map.
            </p>
          </div>

          {homeMessage && (
            <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-700">{homeMessage}</p>
          )}
          {/* Deliberately not auto-dismissed: a message telling someone what to
              do next is useless if it disappears before they have read it. */}
          {homeError && (
            <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {homeError}
            </p>
          )}
        </div>
      )}

      {/* Manager Section */}
      {manager && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Your Manager</h2>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 text-sm font-bold">
              {getInitials(manager.name)}
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">{manager.name}</p>
              <p className="text-xs text-gray-500">{manager.title}</p>
              <p className="text-xs text-gray-400">{manager.email}{manager.cell ? ` | ${manager.cell}` : ""}</p>
            </div>
          </div>
        </div>
      )}

      {/* Change Password */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Change Password</h2>
        <div className="space-y-3 max-w-sm">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Current Password</label>
            <input
              type="password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">New Password</label>
            <input
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Confirm New Password</label>
            <input
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
            />
          </div>
        </div>
        <div className="flex items-center gap-4 mt-4">
          <button
            onClick={changePassword}
            disabled={pwSaving || !currentPw || !newPw || !confirmPw}
            className="px-4 py-2 bg-gray-800 text-white text-sm font-medium rounded-lg hover:bg-gray-900 disabled:opacity-50 transition-colors"
          >
            {pwSaving ? "Changing..." : "Change Password"}
          </button>
          {pwMessage && (
            <span className={`text-sm ${pwMessage.includes("successfully") ? "text-green-600" : "text-red-600"}`}>
              {pwMessage}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
