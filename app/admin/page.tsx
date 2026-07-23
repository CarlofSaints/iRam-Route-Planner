"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "@/components/SessionProvider";
import { UserRole, RolePermission, ROLE_DEFINITIONS, ALL_PERMISSIONS } from "@/lib/types";

interface UserData {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  forcePasswordChange?: boolean;
}

const ROLES: { value: UserRole; label: string; description: string }[] = [
  { value: "superAdmin", label: "Super Admin", description: "Full access to all settings, users, and data" },
  { value: "admin", label: "Admin", description: "Can manage reps, stores, channels, and view reports" },
  { value: "teamManager", label: "Team Manager", description: "Can view and manage their assigned team and reps" },
  { value: "rep", label: "Rep", description: "Can view their own routes and store assignments" },
  { value: "viewer", label: "Viewer", description: "Read-only access to dashboards and reports" },
];

const ROLE_COLORS: Record<UserRole, string> = {
  superAdmin: "bg-red-50 text-red-700",
  admin: "bg-blue-50 text-blue-700",
  teamManager: "bg-green-50 text-green-700",
  rep: "bg-purple-50 text-purple-700",
  viewer: "bg-gray-100 text-gray-600",
};

const ROLE_DOTS: Record<UserRole, string> = {
  superAdmin: "bg-iram-green",
  admin: "bg-blue-500",
  teamManager: "bg-green-500",
  rep: "bg-purple-500",
  viewer: "bg-gray-400",
};

export default function AdminPage() {
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newUser, setNewUser] = useState({ name: "", email: "", password: "", role: "viewer" as UserRole });
  const [editing, setEditing] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<UserData & { password: string }>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState<"info" | "success" | "error">("info");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Set Password state (Super Admin only)
  const [setPwUser, setSetPwUser] = useState<UserData | null>(null);
  const [setPwValue, setSetPwValue] = useState("");
  const [setPwConfirm, setSetPwConfirm] = useState("");
  const [setPwForce, setSetPwForce] = useState(false);
  const [setPwSaving, setSetPwSaving] = useState(false);
  const [setPwVisible, setSetPwVisible] = useState(false);

  // Role Permissions state
  const { session } = useSession();
  const isSuperAdmin = session?.role === "superAdmin";
  const [rolePerms, setRolePerms] = useState<RolePermission[]>(ROLE_DEFINITIONS);
  const [savedPerms, setSavedPerms] = useState<RolePermission[]>(ROLE_DEFINITIONS);
  const [permsSaving, setPermsSaving] = useState(false);
  const permsDirty = JSON.stringify(rolePerms) !== JSON.stringify(savedPerms);

  const loadPerms = useCallback(async () => {
    try {
      const res = await fetch("/api/role-permissions");
      if (res.ok) {
        const data: RolePermission[] = await res.json();
        setRolePerms(data);
        setSavedPerms(data);
      }
    } catch { /* use defaults */ }
  }, []);

  useEffect(() => {
    if (isSuperAdmin) loadPerms();
  }, [isSuperAdmin, loadPerms]);

  const togglePermission = (role: UserRole, permKey: string) => {
    if (role === "superAdmin") return;
    setRolePerms((prev) =>
      prev.map((rp) => {
        if (rp.role !== role) return rp;
        const has = rp.permissions.includes(permKey);
        return {
          ...rp,
          permissions: has
            ? rp.permissions.filter((k) => k !== permKey)
            : [...rp.permissions, permKey],
        };
      })
    );
  };

  const savePerms = async () => {
    setPermsSaving(true);
    try {
      const res = await fetch("/api/role-permissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rolePerms),
      });
      if (res.ok) {
        const data = await res.json();
        setRolePerms(data);
        setSavedPerms(data);
        showMsg("Permissions saved", "success");
      } else {
        const err = await res.json();
        showMsg(err.error || "Save failed", "error");
      }
    } catch {
      showMsg("Save failed", "error");
    } finally {
      setPermsSaving(false);
    }
  };

  const discardPerms = () => {
    setRolePerms([...savedPerms]);
  };

  const showMsg = (text: string, type: "info" | "success" | "error" = "info") => {
    setMsg(text);
    setMsgType(type);
    setTimeout(() => setMsg(""), 5000);
  };

  const load = () => {
    fetch("/api/users")
      .then((r) => r.json())
      .then((data) => {
        setUsers(data);
        setLoading(false);
      });
  };

  useEffect(() => { load(); }, []);

  const addUser = async () => {
    if (!newUser.name || !newUser.email || !newUser.password) {
      showMsg("All fields required", "error");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newUser),
    });
    const data = await res.json();
    if (!res.ok) {
      showMsg(data.error || "Error", "error");
    } else {
      showMsg(`User ${data.name} created`, "success");
      setShowAdd(false);
      setNewUser({ name: "", email: "", password: "", role: "viewer" });
      load();
    }
    setSaving(false);
  };

  const saveEdit = async (id: string) => {
    setSaving(true);
    await fetch("/api/users", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...editData }),
    });
    setEditing(null);
    setEditData({});
    setSaving(false);
    load();
  };

  const deleteUser = async (id: string) => {
    if (!confirm("Delete this user?")) return;
    await fetch("/api/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    load();
  };

  const forcePwChange = async (user: UserData) => {
    setActionLoading(user.id + "-pw");
    const res = await fetch("/api/users", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: user.id, forcePasswordChange: true }),
    });
    if (res.ok) {
      showMsg(`${user.name} will be required to change password on next login`, "success");
      load();
    } else {
      showMsg("Failed to set force password change", "error");
    }
    setActionLoading(null);
  };

  const sendWelcome = async (user: UserData) => {
    setActionLoading(user.id + "-email");
    try {
      const res = await fetch("/api/users/send-welcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        showMsg(data.error || "Failed to send welcome email", "error");
      } else if (data.sent) {
        showMsg(`Welcome email sent to ${user.email}`, "success");
      } else if (data.message) {
        showMsg(`${data.message} Temp PW: ${data.tempPassword}`, "error");
      } else {
        showMsg(`Temp password for ${user.email}: ${data.tempPassword} (no email service configured — share manually)`, "info");
      }
      load();
    } catch {
      showMsg("Network error sending welcome email", "error");
    }
    setActionLoading(null);
  };

  const openSetPw = (user: UserData) => {
    setSetPwUser(user);
    setSetPwValue("");
    setSetPwConfirm("");
    setSetPwForce(false);
    setSetPwVisible(false);
  };

  const closeSetPw = () => {
    setSetPwUser(null);
    setSetPwValue("");
    setSetPwConfirm("");
    setSetPwForce(false);
  };

  const submitSetPw = async () => {
    if (!setPwUser) return;
    if (setPwValue.length < 6) {
      showMsg("Password must be at least 6 characters", "error");
      return;
    }
    if (setPwValue !== setPwConfirm) {
      showMsg("Passwords do not match", "error");
      return;
    }
    setSetPwSaving(true);
    try {
      const payload: Record<string, unknown> = { id: setPwUser.id, password: setPwValue };
      if (setPwForce) payload.forcePasswordChange = true;
      const res = await fetch("/api/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        showMsg(`Password updated for ${setPwUser.name}`, "success");
        closeSetPw();
        load();
      } else {
        const data = await res.json();
        showMsg(data.error || "Failed to set password", "error");
      }
    } catch {
      showMsg("Network error setting password", "error");
    } finally {
      setSetPwSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-8 h-8 border-2 border-iram-green border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Admin &amp; Permissions</h1>
          <p className="text-sm text-gray-500">{users.length} users</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="bg-iram-green text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-iram-green-dark"
        >
          + Add User
        </button>
      </div>

      {msg && (
        <div className={`p-3 rounded-lg text-sm ${
          msgType === "success" ? "bg-green-50 text-green-700" :
          msgType === "error" ? "bg-red-50 text-red-700" :
          "bg-blue-50 text-blue-700"
        }`}>
          {msg}
        </div>
      )}

      {/* Set Password Modal */}
      {setPwUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6 w-full max-w-md mx-4">
            <h3 className="font-semibold text-gray-900 mb-1">Set Password</h3>
            <p className="text-sm text-gray-500 mb-4">
              Setting password for <span className="font-medium text-gray-700">{setPwUser.name}</span> ({setPwUser.email})
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">New Password</label>
                <div className="relative">
                  <input
                    type={setPwVisible ? "text" : "password"}
                    value={setPwValue}
                    onChange={(e) => setSetPwValue(e.target.value)}
                    placeholder="Min 6 characters"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setSetPwVisible(!setPwVisible)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
                    tabIndex={-1}
                  >
                    {setPwVisible ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Confirm Password</label>
                <div className="relative">
                  <input
                    type={setPwVisible ? "text" : "password"}
                    value={setPwConfirm}
                    onChange={(e) => setSetPwConfirm(e.target.value)}
                    placeholder="Re-enter password"
                    onKeyDown={(e) => e.key === "Enter" && submitSetPw()}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
                  />
                  <button
                    type="button"
                    onClick={() => setSetPwVisible(!setPwVisible)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
                    tabIndex={-1}
                  >
                    {setPwVisible ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={setPwForce}
                  onChange={(e) => setSetPwForce(e.target.checked)}
                  className="rounded border-gray-300 text-iram-green focus:ring-iram-green"
                />
                <span className="text-sm text-gray-600">Force user to change password on next login</span>
              </label>
            </div>
            <div className="mt-5 flex gap-2 justify-end">
              <button
                onClick={closeSetPw}
                className="text-gray-500 px-4 py-2 rounded-lg text-sm hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={submitSetPw}
                disabled={setPwSaving || setPwValue.length < 6 || setPwValue !== setPwConfirm}
                className="bg-iram-green text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-iram-green-dark disabled:opacity-50"
              >
                {setPwSaving ? "Saving..." : "Set Password"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add User */}
      {showAdd && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="font-semibold text-gray-900 mb-4">New User</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
              <input
                value={newUser.name}
                onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <input
                type="email"
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Password</label>
              <input
                type="password"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
              <select
                value={newUser.role}
                onChange={(e) => setNewUser({ ...newUser, role: e.target.value as UserRole })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={addUser} disabled={saving} className="bg-iram-green text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-iram-green-dark disabled:opacity-50">
              {saving ? "Saving..." : "Create User"}
            </button>
            <button onClick={() => setShowAdd(false)} className="text-gray-500 px-4 py-2 rounded-lg text-sm hover:bg-gray-100">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Users Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Users</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-6 py-3">Name</th>
                <th className="px-6 py-3">Email</th>
                <th className="px-6 py-3">Role</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50">
                  {editing === user.id ? (
                    <>
                      <td className="px-6 py-3">
                        <input
                          value={editData.name || ""}
                          onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                          className="border border-gray-200 rounded px-2 py-1 text-sm w-full"
                        />
                      </td>
                      <td className="px-6 py-3">
                        <input
                          value={editData.email || ""}
                          onChange={(e) => setEditData({ ...editData, email: e.target.value })}
                          className="border border-gray-200 rounded px-2 py-1 text-sm w-full"
                        />
                      </td>
                      <td className="px-6 py-3">
                        <select
                          value={editData.role || "viewer"}
                          onChange={(e) => setEditData({ ...editData, role: e.target.value as UserRole })}
                          className="border border-gray-200 rounded px-2 py-1 text-sm"
                        >
                          {ROLES.map((r) => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-6 py-3" />
                      <td className="px-6 py-3 text-right space-x-2">
                        <button onClick={() => saveEdit(user.id)} disabled={saving} className="text-green-600 hover:text-green-800 text-xs font-medium">Save</button>
                        <button onClick={() => { setEditing(null); setEditData({}); }} className="text-gray-400 hover:text-gray-600 text-xs font-medium">Cancel</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-6 py-3 font-medium text-gray-900">{user.name}</td>
                      <td className="px-6 py-3 text-gray-600">{user.email}</td>
                      <td className="px-6 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[user.role] || "bg-gray-100 text-gray-600"}`}>
                          {ROLES.find((r) => r.value === user.role)?.label || user.role}
                        </span>
                      </td>
                      <td className="px-6 py-3">
                        {user.forcePasswordChange && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
                            PW Change Required
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => forcePwChange(user)}
                            disabled={actionLoading === user.id + "-pw"}
                            title="Force password change on next login"
                            className="text-amber-600 hover:text-amber-800 text-xs font-medium px-2 py-1 rounded hover:bg-amber-50 disabled:opacity-50"
                          >
                            {actionLoading === user.id + "-pw" ? (
                              <span className="inline-block w-3 h-3 border border-amber-600 border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <svg className="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                              </svg>
                            )}
                          </button>
                          <button
                            onClick={() => sendWelcome(user)}
                            disabled={actionLoading === user.id + "-email"}
                            title="Send welcome email with temp password"
                            className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 disabled:opacity-50"
                          >
                            {actionLoading === user.id + "-email" ? (
                              <span className="inline-block w-3 h-3 border border-blue-600 border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <svg className="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                              </svg>
                            )}
                          </button>
                          {isSuperAdmin && (
                            <button
                              onClick={() => openSetPw(user)}
                              title="Set password for this user"
                              className="text-emerald-600 hover:text-emerald-800 text-xs font-medium px-2 py-1 rounded hover:bg-emerald-50"
                            >
                              Set PW
                            </button>
                          )}
                          <button
                            onClick={() => { setEditing(user.id); setEditData({ name: user.name, email: user.email, role: user.role }); }}
                            className="text-iram-green hover:text-red-800 text-xs font-medium px-2 py-1 rounded hover:bg-red-50"
                          >
                            Edit
                          </button>
                          <button onClick={() => deleteUser(user.id)} className="text-gray-400 hover:text-red-600 text-xs font-medium px-2 py-1 rounded hover:bg-gray-50">
                            Delete
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Roles & Permissions Matrix */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-900">Roles &amp; Permissions</h3>
            <p className="text-xs text-gray-500 mt-1">
              {isSuperAdmin ? "Click checkmarks to toggle permissions" : "Permission matrix for each role"}
            </p>
          </div>
          {permsDirty && isSuperAdmin && (
            <div className="flex gap-2">
              <button
                onClick={discardPerms}
                className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-50"
              >
                Discard
              </button>
              <button
                onClick={savePerms}
                disabled={permsSaving}
                className="px-3 py-1.5 bg-iram-green text-white rounded-lg text-xs font-medium hover:bg-iram-green-dark disabled:opacity-50"
              >
                {permsSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          )}
        </div>
        <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-6 py-3 text-left sticky left-0 bg-gray-50 z-20">Permission</th>
                {rolePerms.map((rd) => (
                  <th key={rd.role} className="px-4 py-3 text-center bg-gray-50">
                    <div className="flex items-center justify-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${ROLE_DOTS[rd.role]}`} />
                      <span>{rd.label}</span>
                      {rd.role === "superAdmin" && (
                        <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                        </svg>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {ALL_PERMISSIONS.map((perm) => (
                <tr key={perm.key} className="hover:bg-gray-50">
                  <td className="px-6 py-3 text-gray-700 font-medium sticky left-0 bg-white z-[5]">{perm.label}</td>
                  {rolePerms.map((rd) => {
                    const has = rd.permissions.includes(perm.key);
                    const locked = rd.role === "superAdmin";
                    const canClick = isSuperAdmin && !locked;
                    return (
                      <td key={rd.role} className="px-4 py-3 text-center">
                        <button
                          onClick={() => canClick && togglePermission(rd.role, perm.key)}
                          disabled={!canClick}
                          className={`inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors ${
                            canClick ? "cursor-pointer hover:bg-gray-100" : "cursor-default"
                          }`}
                          title={
                            locked
                              ? "Super Admin always has all permissions"
                              : !isSuperAdmin
                                ? "Only Super Admins can edit permissions"
                                : has
                                  ? `Remove "${perm.label}" from ${rd.label}`
                                  : `Grant "${perm.label}" to ${rd.label}`
                          }
                        >
                          {has ? (
                            <svg className={`w-5 h-5 ${locked ? "text-green-400" : "text-green-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-3 border-t border-gray-100">
          <div className="flex flex-wrap gap-4">
            {rolePerms.map((rd) => (
              <div key={rd.role} className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${ROLE_DOTS[rd.role]}`} />
                <span className="text-xs text-gray-500">{rd.label}: {rd.description}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
