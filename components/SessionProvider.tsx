"use client";

import { createContext, useContext, useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { SessionPayload } from "@/lib/types";

const SessionContext = createContext<{
  session: SessionPayload | null;
  refresh: () => void;
}>({ session: null, refresh: () => {} });

export function useSession() {
  return useContext(SessionContext);
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [session, setSession] = useState<SessionPayload | null>(null);

  const refresh = () => {
    const cookie = document.cookie
      .split("; ")
      .find((c) => c.startsWith("iram_session="));
    if (cookie) {
      try {
        const val = cookie.split("=")[1];
        const decoded = JSON.parse(atob(val));
        setSession(decoded);
      } catch {
        setSession(null);
      }
    } else {
      setSession(null);
    }
  };

  useEffect(() => {
    refresh();
  }, [pathname]);

  return (
    <SessionContext.Provider value={{ session, refresh }}>
      {children}
    </SessionContext.Provider>
  );
}
