"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Activity, Bell, Bot, Building2, ChevronDown, CircleUserRound, FileBarChart, LayoutDashboard, ListChecks, LogOut, Menu, Moon, Search, ShieldCheck, Sun, TicketCheck, Wrench, X } from "lucide-react";
import type { SessionUser } from "@/lib/rbac";

const navItems = [
  ["Overview", "/overview", LayoutDashboard], ["Organizations", "/organizations", Building2], ["Devices", "/devices", Activity], ["Alerts", "/alerts", ShieldCheck], ["Patching", "/patching", ListChecks], ["Automation", "/automation", Bot], ["Tickets", "/tickets", TicketCheck], ["Reports", "/reports", FileBarChart], ["Audit Log", "/audit-log", Wrench], ["Administration", "/administration", CircleUserRound],
] as const;

export function AppShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [theme, setTheme] = useState("dark");

  useEffect(() => {
    const stored = localStorage.getItem("opspilot-theme") ?? "dark";
    document.documentElement.dataset.theme = stored;
    const frame = requestAnimationFrame(() => setTheme(stored));
    const key = (event: KeyboardEvent) => { if (event.key === "/" && !(event.target instanceof HTMLInputElement)) { event.preventDefault(); searchRef.current?.focus(); } };
    window.addEventListener("keydown", key);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("keydown", key); };
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next); document.documentElement.dataset.theme = next; localStorage.setItem("opspilot-theme", next);
  }
  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); router.refresh(); }
  function search(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); const value = new FormData(event.currentTarget).get("q"); router.push(`/devices?search=${encodeURIComponent(String(value ?? ""))}`); }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
        <button className="icon-button sidebar-close sidebar-close-floating" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={17} /></button>
        <button className="tenant-switch" type="button"><span className="tenant-avatar">OP</span><span><small>Management scope</small><strong>OpsPilot Live</strong></span><ChevronDown size={13} /></button>
        <nav aria-label="Primary navigation">
          <span className="nav-label">Operations</span>
          {navItems.slice(0, 8).map(([label, href, Icon]) => <Link key={href} href={href} className={pathname === href || (href === "/devices" && pathname.startsWith("/devices/")) ? "active" : ""} onClick={() => setMobileOpen(false)}><Icon size={17} /><span>{label}</span></Link>)}
          <span className="nav-label nav-label-second">Control</span>
          {navItems.slice(8).map(([label, href, Icon]) => <Link key={href} href={href} className={pathname === href ? "active" : ""} onClick={() => setMobileOpen(false)}><Icon size={17} /><span>{label}</span></Link>)}
        </nav>
        <div className="sidebar-foot"><div className="gateway-status"><span className="status-dot status-dot-online" /><span><strong>Agent gateway</strong><small>Enrollment available</small></span></div><button onClick={logout} className="profile-button"><span className="user-avatar">{user.name.split(" ").map((part) => part[0]).join("")}</span><span><strong>{user.name}</strong><small>{user.roleName}</small></span><LogOut size={14} /></button></div>
      </aside>
      {mobileOpen && <button className="sidebar-scrim" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}
      <div className="app-main">
        <header className="topbar">
          <button className="icon-button menu-button" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={20} /></button>
          <form className="global-search" onSubmit={search}><Search size={15} /><input ref={searchRef} name="q" placeholder="Search devices, alerts, tickets" aria-label="Global search" /><kbd>/</kbd></form>
          <div className="topbar-actions"><span className="environment-badge"><span className="status-dot status-dot-online" /> LIVE</span><button className="icon-button" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>{theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}</button><div className="notification-wrap"><button className="icon-button" onClick={() => setNotifications(!notifications)} aria-label="Notifications"><Bell size={16} /><i /></button>{notifications && <div className="notification-popover"><strong>Notifications</strong><button onClick={() => router.push("/alerts")}>Live agent alerts <small>Open alert center</small></button><button onClick={() => router.push("/devices")}>Endpoint check-ins <small>View enrolled devices</small></button><button onClick={() => router.push("/administration")}>Enrollment tokens <small>Manage agent access</small></button></div>}</div></div>
        </header>
        <main className="content-area">{children}</main>
      </div>
    </div>
  );
}
