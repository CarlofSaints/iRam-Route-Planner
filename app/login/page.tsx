"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Force password change state
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [userId, setUserId] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Login failed");
        return;
      }
      if (data.user?.forcePasswordChange) {
        setUserId(data.user.userId);
        setShowChangePassword(true);
        return;
      }
      router.push("/");
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to change password");
        return;
      }
      router.push("/");
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-iram-dark flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <Image src="/iram-logo.png" alt="iRam" width={180} height={60} className="mx-auto mb-3" />
          <p className="text-gray-400 text-sm">Rep Router</p>
        </div>

        {showChangePassword ? (
          /* Change Password Form */
          <form onSubmit={handleChangePassword} className="bg-white rounded-xl p-6 shadow-lg space-y-4">
            <div className="text-center mb-2">
              <h2 className="text-lg font-bold text-gray-900">Change Password</h2>
              <p className="text-xs text-gray-500">You must set a new password before continuing</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iram-green"
                placeholder="Min 6 characters"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iram-green"
                placeholder="Re-enter password"
                required
              />
            </div>
            {error && <p className="text-red-600 text-xs">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-iram-green text-white py-2.5 rounded-lg text-sm font-medium hover:bg-iram-green-dark disabled:opacity-50 transition-colors"
            >
              {loading ? "Saving..." : "Set New Password"}
            </button>
          </form>
        ) : (
          /* Login Form */
          <form onSubmit={handleSubmit} className="bg-white rounded-xl p-6 shadow-lg space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iram-green"
                placeholder="you@company.com"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iram-green"
                placeholder="Enter password"
                required
              />
            </div>
            {error && <p className="text-red-600 text-xs">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-iram-green text-white py-2.5 rounded-lg text-sm font-medium hover:bg-iram-green-dark disabled:opacity-50 transition-colors"
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        )}

        {/* Footer */}
        <div className="mt-6 flex items-center justify-center gap-2">
          <Image src="/outerjoin-logo.png" alt="OuterJoin" width={16} height={16} className="rounded" />
          <span className="text-gray-500 text-[10px]">Powered by OuterJoin</span>
        </div>
      </div>
    </div>
  );
}
