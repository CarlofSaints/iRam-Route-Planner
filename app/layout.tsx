"use client";

import "./globals.css";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Image from "next/image";
import { SessionProvider, useSession } from "@/components/SessionProvider";

const TOP_NAV = [
  { href: "/", label: "Dashboard", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
  { href: "/reps", label: "Reps", icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" },
  { href: "/stores", label: "Stores", icon: "M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" },
  { href: "/map", label: "Map", icon: "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" },
  { href: "/routes", label: "Routes", icon: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" },
  { href: "/capacity", label: "Rep Capacity", icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" },
  { href: "/overrides", label: "Call Overrides", icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" },
];

const CONTROL_CENTRE_NAV = [
  { href: "/channels", label: "Channels", icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" },
  { href: "/teams", label: "Teams", icon: "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" },
  { href: "/admin/call-cycle-types", label: "Call Cycle Types", icon: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" },
  { href: "/admin/rep-channels", label: "Channel Map", icon: "M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" },
  { href: "/admin/regions", label: "Regions", icon: "M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  { href: "/admin/store-upload", label: "Store Upload", icon: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" },
  { href: "/admin/duplicates", label: "Duplicate Stores", icon: "M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" },
  { href: "/perigee", label: "Perigee API", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" },
  { href: "/activity-log", label: "Activity Log", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
];

const BOTTOM_NAV = [
  { href: "/admin", label: "User Admin", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" },
  { href: "/account", label: "Account", icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" },
];

function NavLink({ href, label, icon, active, indent }: { href: string; label: string; icon: string; active: boolean; indent?: boolean }) {
  return (
    <a
      href={href}
      className={`flex items-center gap-3 ${indent ? "pl-9 pr-4" : "px-4"} py-2 text-sm transition-colors ${
        active
          ? "bg-iram-green text-white"
          : "text-gray-300 hover:bg-gray-800 hover:text-white"
      }`}
    >
      <svg className={`${indent ? "w-4 h-4" : "w-5 h-5"} flex-shrink-0`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
      </svg>
      <span className={indent ? "text-xs" : ""}>{label}</span>
    </a>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { session } = useSession();
  const isLogin = pathname === "/login";

  // Auto-expand Control Centre if current path matches a child
  const ccChildActive = CONTROL_CENTRE_NAV.some((item) => pathname === item.href);
  const [ccOpen, setCcOpen] = useState(ccChildActive);

  // Keep in sync when pathname changes
  if (ccChildActive && !ccOpen) setCcOpen(true);

  const logout = async () => {
    await fetch("/api/auth", { method: "DELETE" });
    router.push("/login");
  };

  if (isLogin) return <>{children}</>;

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-iram-dark text-white flex flex-col flex-shrink-0">
        {/* Logo */}
        <div className="p-4 border-b border-gray-700 flex items-center gap-3">
          <Image src="/iram-logo.png" alt="iRam" width={36} height={36} className="rounded-lg" />
          <div>
            <h1 className="font-bold text-sm leading-tight">iRam</h1>
            <p className="text-[10px] text-gray-400">Route Planner</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 overflow-y-auto">
          {/* Top nav items */}
          {TOP_NAV.map((item) => (
            <NavLink key={item.href} {...item} active={pathname === item.href} />
          ))}

          {/* Control Centre group */}
          <button
            onClick={() => setCcOpen(!ccOpen)}
            className={`flex items-center gap-3 px-4 py-2 text-sm w-full transition-colors ${
              ccChildActive && !ccOpen
                ? "bg-iram-green text-white"
                : "text-gray-300 hover:bg-gray-800 hover:text-white"
            }`}
          >
            <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
            <span className="flex-1 text-left">Control Centre</span>
            <svg
              className={`w-4 h-4 transition-transform ${ccOpen ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {ccOpen && (
            <div className="mt-0.5">
              {CONTROL_CENTRE_NAV.map((item) => (
                <NavLink key={item.href} {...item} active={pathname === item.href} indent />
              ))}
            </div>
          )}

          {/* Bottom nav items */}
          <div className="mt-2 pt-2 border-t border-gray-700/50">
            {BOTTOM_NAV.map((item) => (
              <NavLink key={item.href} {...item} active={pathname === item.href} />
            ))}
          </div>
        </nav>

        {/* User */}
        <div className="border-t border-gray-700 p-4">
          {session && (
            <div className="mb-3">
              <p className="text-sm font-medium truncate">{session.name}</p>
              <p className="text-[10px] text-gray-400 truncate">{session.email}</p>
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium mt-1 bg-iram-green/25 text-iram-green-light">
                {session.role}
              </span>
            </div>
          )}
          <button onClick={logout} className="text-xs text-gray-400 hover:text-white">
            Sign out
          </button>
        </div>

        {/* Powered by */}
        <div className="px-4 pb-3 flex items-center gap-2 border-t border-gray-700 pt-3">
          <Image src="/outerjoin-logo.png" alt="OuterJoin" width={20} height={20} className="rounded" />
          <span className="text-[9px] text-gray-500">Powered by OuterJoin</span>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-50">
        <SessionProvider>
          <AppShell>{children}</AppShell>
        </SessionProvider>
      </body>
    </html>
  );
}
