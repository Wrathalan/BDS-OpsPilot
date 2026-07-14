"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Activity, Bell, Bot, Building2, ChevronDown, CircleUserRound, FileBarChart, LayoutDashboard, ListChecks, LogOut, Menu, Moon, Radar, Search, ShieldCheck, Sun, TicketCheck, Wrench, X } from "lucide-react";
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

  useEffect(() => {
    if (!user.permissionKeys.includes("device.manage")) return;
    const pulse = () => fetch("/api/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "simulatorPulse" }) }).catch(() => undefined);
    const timer = window.setInterval(pulse, 45_000);
    return () => window.clearInterval(timer);
  }, [user.permissionKeys]);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next); document.documentElement.dataset.theme = next; localStorage.setItem("opspilot-theme", next);
  }
  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); router.refresh(); }
  function search(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); const value = new FormData(event.currentTarget).get("q"); router.push(`/devices?search=${encodeURIComponent(String(value ?? ""))}`); }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
        <div className="sidebar-head"><Link href="/overview" className="brand"><span className="brand-mark"><Radar size={20} /></span><span>OpsPilot <em>RMM</em></span></Link><button className="icon-button sidebar-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={19} /></button></div>
        <div className="tenant-switch"><span className="tenant-avatar">N</span><span><small>Tenant</small><strong>Northstar Managed IT</strong></span><ChevronDown size={15} /></div>
        <nav aria-label="Primary navigation">
          <span className="nav-label">Operations</span>
          {navItems.slice(0, 8).map(([label, href, Icon]) => <Link key={href} href={href} className={pathname === href || (href === "/devices" && pathname.startsWith("/devices/")) ? "active" : ""} onClick={() => setMobileOpen(false)}><Icon size={17} /><span>{label}</span>{label === "Alerts" && <b className="nav-count">8</b>}</Link>)}
          <span className="nav-label nav-label-second">Control</span>
          {navItems.slice(8).map(([label, href, Icon]) => <Link key={href} href={href} className={pathname === href ? "active" : ""} onClick={() => setMobileOpen(false)}><Icon size={17} /><span>{label}</span></Link>)}
        </nav>
        <div className="sidebar-foot"><div className="sim-status"><span className="pulse-ring"><i /></span><span><strong>Agent simulator</strong><small>Telemetry is active</small></span></div><button onClick={logout} className="profile-button"><span className="user-avatar">{user.name.split(" ").map((part) => part[0]).join("")}</span><span><strong>{user.name}</strong><small>{user.roleName}</small></span><LogOut size={16} /></button></div>
      </aside>
      {mobileOpen && <button className="sidebar-scrim" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}
      <div className="app-main">
        <header className="topbar">
          <button className="icon-button menu-button" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={20} /></button>
          <form className="global-search" onSubmit={search}><Search size={17} /><input ref={searchRef} name="q" placeholder="Search devices, alerts, tickets…" aria-label="Global search" /><kbd>/</kbd></form>
          <div className="topbar-actions"><span className="sim-badge"><span /> SIMULATOR</span><button className="icon-button" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>{theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}</button><div className="notification-wrap"><button className="icon-button" onClick={() => setNotifications(!notifications)} aria-label="Notifications"><Bell size={18} /><i /></button>{notifications && <div className="notification-popover"><strong>Notifications</strong><button onClick={() => router.push("/alerts")}>Critical service condition detected <small>2 minutes ago</small></button><button onClick={() => router.push("/patching")}>Patch test ring is ready <small>18 minutes ago</small></button><button onClick={() => router.push("/tickets")}>SLA target approaching <small>41 minutes ago</small></button></div>}</div></div>
        </header>
        <main className="content-area">{children}</main>
      </div>
    </div>
  );
}
