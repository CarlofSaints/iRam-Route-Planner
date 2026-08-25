"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";

/**
 * Spend a reset link and choose a new password.
 *
 * The link is checked BEFORE the form is shown, so somebody with a stale link
 * finds out immediately instead of typing a password twice and then being told.
 */

function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get("token") || "";

  const [checking, setChecking] = useState(true);
  const [valid, setValid] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("That link is missing its code. Ask for a new one.");
      setChecking(false);
      return;
    }
    fetch(`/api/auth/reset-password?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.valid) {
          setValid(true);
          setEmail(d.email || "");
          setName(d.name || "");
        } else {
          setError(d.error || "That link is no longer valid.");
        }
      })
      .catch(() => setError("Could not check that link. Try again in a moment."))
      .finally(() => setChecking(false));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not set your password.");
        return;
      }
      setDone(true);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setSaving(false);
    }
  };

  if (checking) {
    return (
      <div className="flex justify-center py-8">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-iram-green border-t-transparent" />
      </div>
    );
  }

  if (done) {
    return (
      <>
        <div className="mb-3 flex items-center gap-2">
          <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <h1 className="text-base font-semibold text-gray-900">Password changed</h1>
        </div>
        <p className="text-sm leading-relaxed text-gray-600">
          Sign in with your new password. That link will not work again.
        </p>
        <a
          href={`/login?email=${encodeURIComponent(email)}`}
          className="mt-5 block w-full rounded-lg bg-iram-green px-4 py-2.5 text-center text-sm font-medium text-white transition-colors hover:bg-iram-green-dark"
        >
          Sign in
        </a>
      </>
    );
  }

  if (!valid) {
    return (
      <>
        <h1 className="text-base font-semibold text-gray-900">This link cannot be used</h1>
        <p className="mt-1 text-sm leading-relaxed text-gray-600">{error}</p>
        <a
          href="/forgot-password"
          className="mt-5 block w-full rounded-lg bg-iram-green px-4 py-2.5 text-center text-sm font-medium text-white transition-colors hover:bg-iram-green-dark"
        >
          Send me a new link
        </a>
        <a href="/login" className="mt-3 block text-center text-xs text-gray-500 hover:text-gray-700">
          Back to sign in
        </a>
      </>
    );
  }

  return (
    <>
      <h1 className="text-base font-semibold text-gray-900">
        {name ? `Hi ${name.split(" ")[0]}, choose a new password` : "Choose a new password"}
      </h1>
      <p className="mt-1 text-sm text-gray-600">for {email}</p>

      <form onSubmit={submit} className="mt-5">
        {/* Present and hidden so password managers file the new credential
            against the right account rather than prompting for a username. */}
        <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />

        <label htmlFor="pw" className="mb-1 block text-xs font-medium text-gray-500">
          New password
        </label>
        <input
          id="pw"
          type="password"
          required
          autoFocus
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
        />
        <p className="mt-1 text-[11px] text-gray-500">At least 8 characters, with a letter and a number.</p>

        <label htmlFor="pw2" className="mb-1 mt-3 block text-xs font-medium text-gray-500">
          Type it again
        </label>
        <input
          id="pw2"
          type="password"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
        />

        {/* Not auto-dismissed: a message telling somebody what to fix is useless
            if it vanishes before they have read it. */}
        {error && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        )}

        <button
          type="submit"
          disabled={saving || !password || !confirm}
          className="mt-4 w-full rounded-lg bg-iram-green px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-iram-green-dark disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save my new password"}
        </button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Image src="/iram-logo.png" alt="iRam" width={180} height={60} className="h-12 w-auto" priority />
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
          {/* useSearchParams needs a Suspense boundary or the whole route opts
              out of static rendering and the build complains. */}
          <Suspense
            fallback={
              <div className="flex justify-center py-8">
                <div className="h-7 w-7 animate-spin rounded-full border-2 border-iram-green border-t-transparent" />
              </div>
            }
          >
            <ResetPasswordForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
