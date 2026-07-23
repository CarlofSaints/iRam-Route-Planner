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
  }, []);

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
