import { redirect } from "next/navigation";
import { Activity, LockKeyhole, Radar, ShieldCheck } from "lucide-react";
import { getSessionUser } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getSessionUser()) redirect("/overview");
  return (
    <main className="login-shell">
      <section className="login-story" aria-label="OpsPilot product summary">
        <div className="brand brand-large"><span className="brand-mark"><Radar size={22} /></span><span>OpsPilot <em>RMM</em></span></div>
        <div className="login-copy">
          <span className="eyebrow"><span className="live-dot" /> Simulator environment ready</span>
          <h1>See trouble early.<br />Resolve it safely.</h1>
          <p>A local, multi-tenant operations console for endpoint health, policy, patching, support, and accountable automation.</p>
        </div>
        <div className="login-proof-grid">
          <div><Activity /><strong>Live telemetry</strong><span>30 simulated endpoints</span></div>
          <div><ShieldCheck /><strong>Scoped control</strong><span>Role and organization access</span></div>
          <div><LockKeyhole /><strong>Safe actions</strong><span>Approved automations only</span></div>
        </div>
        <p className="simulator-disclosure">All endpoint interactions in this local MVP are simulated. No remote commands or real-machine changes are performed.</p>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <div className="mobile-brand brand"><span className="brand-mark"><Radar size={20} /></span><span>OpsPilot <em>RMM</em></span></div>
          <span className="eyebrow">Secure control plane</span>
          <h2>Welcome back</h2>
          <p>Sign in with a seeded local demonstration account.</p>
          <LoginForm />
          <div className="demo-accounts">
            <strong>Demo accounts</strong>
            <button type="button" data-demo-email="admin@opspilot.local">Administrator <span>admin@opspilot.local</span></button>
            <button type="button" data-demo-email="tech@opspilot.local">Technician <span>tech@opspilot.local</span></button>
            <button type="button" data-demo-email="auditor@opspilot.local">Auditor <span>auditor@opspilot.local</span></button>
          </div>
        </div>
      </section>
    </main>
  );
}
