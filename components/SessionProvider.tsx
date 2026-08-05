"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import { SessionPayload } from "@/lib/types";

const SessionContext = createContext<{
  session: SessionPayload | null;
  permissions: string[];
  can: (permission: string) => boolean;
  loading: boolean;
  refresh: () => void;
}>({ session: null, permissions: [], can: () => false, loading: true, refresh: () => {} });

export function useSession() {
  return useContext(SessionContext);
}

/**
 * The session comes from the server (GET /api/auth), not from decoding the
 * cookie in the browser.
 *
 * The cookie is written once at login and lasts 30 days, so reading the role
 * out of it meant a promoted user kept their old permissions in the UI until
 * they happened to sign out — the reason a Super Admin was missing the
 * "Generate Routes" button. It is also client-editable, so it was never a
 * safe thing to make UI decisions from.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    fetch("/api/auth", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { session: null, permissions: [] }))
      .then((data) => {
        setSession(data.session ?? null);
        setPermissions(data.permissions ?? []);
      })
      .catch(() => {
        setSession(null);
        setPermissions([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [pathname, refresh]);

  const can = useCallback(
    (permission: string) => permissions.includes(permission),
    [permissions]
  );

  return (
    <SessionContext.Provider value={{ session, permissions, can, loading, refresh }}>
      {children}
    </SessionContext.Provider>
  );
}
