"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Force password change state
  // Arriving from a completed reset: prefill the address so the only thing left
  // to type is the password they just chose.
  useEffect(() => {
    const fromReset = params.get("email");
    if (fromReset) setEmail(fromReset);
  }, [params]);

  const [showChangePassword, setShowChangePassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Where to go once signed in. A rep has no dashboard — the middleware would
  // bounce them from "/" to their profile, so send them there directly rather
  // than through a redirect. Held in state because the password-change step
  // happens after the role is known but before the redirect.
  const [landing, setLanding] = useState("/");

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
      const destination = data.user?.role === "rep" ? "/account" : "/";
      setLanding(destination);

      if (data.user?.forcePasswordChange) {
        setShowChangePassword(true);
        return;
      }
      router.push(destination);
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
        // No userId: the server takes the account from the session cookie it
        // already set at sign-in. Sending one used to be how this route chose
        // whose password to overwrite.
        body: JSON.stringify({ newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to change password");
        return;
      }
      router.push(landing);
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
            <a
              href="/forgot-password"
              className="block text-center text-xs text-gray-500 hover:text-iram-green transition-colors"
            >
              Forgot your password?
            </a>
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

/**
 * useSearchParams needs a Suspense boundary, or this whole route opts out of
 * static rendering and the build says so.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
