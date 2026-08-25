"use client";

import { useState } from "react";
import Image from "next/image";

/**
 * Ask for a reset link.
 *
 * The screen says the same thing whether or not the address has an account,
 * because the API does. That is a deliberate trade: somebody who mistypes their
 * address waits for a mail that never comes, which is annoying, and the
 * alternative is handing anyone a way to test which addresses have logins. The
 * copy therefore tells them to check the spelling if nothing arrives.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      setMessage(data.message || "If that email address has an account, a link is on its way.");
      setSent(true);
    } catch {
      setMessage("Could not reach the server. Check your connection and try again.");
      setSent(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Image src="/iram-logo.png" alt="iRam" width={180} height={60} className="h-12 w-auto" priority />
        </div>

        <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
          {sent ? (
            <>
              <div className="mb-3 flex items-center gap-2">
                <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <h1 className="text-base font-semibold text-gray-900">Check your email</h1>
              </div>
              <p className="text-sm leading-relaxed text-gray-600">{message}</p>
              <p className="mt-3 text-xs leading-relaxed text-gray-500">
                Nothing after a few minutes? Look in your junk folder, and check the address you typed. For your
                security this page cannot tell you whether an account exists.
              </p>
              <a
                href="/login"
                className="mt-5 block w-full rounded-lg bg-iram-green px-4 py-2.5 text-center text-sm font-medium text-white transition-colors hover:bg-iram-green-dark"
              >
                Back to sign in
              </a>
            </>
          ) : (
            <>
              <h1 className="text-base font-semibold text-gray-900">Forgot your password?</h1>
              <p className="mt-1 text-sm leading-relaxed text-gray-600">
                Type the email address you sign in with. We will send you a link to choose a new password.
              </p>
              <form onSubmit={submit} className="mt-5">
                <label htmlFor="email" className="mb-1 block text-xs font-medium text-gray-500">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@iram.co.za"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-iram-green"
                />
                <button
                  type="submit"
                  disabled={loading || !email.trim()}
                  className="mt-4 w-full rounded-lg bg-iram-green px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-iram-green-dark disabled:opacity-50"
                >
                  {loading ? "Sending..." : "Send me a link"}
                </button>
              </form>
              <a href="/login" className="mt-4 block text-center text-xs text-gray-500 hover:text-gray-700">
                Back to sign in
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
