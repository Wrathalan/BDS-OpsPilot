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
          <span className="eyebrow"><span className="live-dot" /> Live agent gateway ready</span>
          <h1>See trouble early.<br />Resolve it safely.</h1>
          <p>A live-test, multi-tenant operations console for authenticated endpoint health, policy, patching, support, and accountable automation.</p>
        </div>
        <div className="login-proof-grid">
          <div><Activity /><strong>Live telemetry</strong><span>Authenticated agent check-ins</span></div>
          <div><ShieldCheck /><strong>Scoped control</strong><span>Role and organization access</span></div>
          <div><LockKeyhole /><strong>Safe actions</strong><span>Allowlisted agent tasks only</span></div>
        </div>
        <p className="live-disclosure">Live testing is enabled. The included foreground agent reports real host telemetry and accepts only inventory/status refresh tasks.</p>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <div className="mobile-brand brand"><span className="brand-mark"><Radar size={20} /></span><span>OpsPilot <em>RMM</em></span></div>
          <span className="eyebrow">Secure control plane</span>
          <h2>Welcome back</h2>
          <p>Sign in with the administrator created during live bootstrap.</p>
          <LoginForm />
          <div className="bootstrap-note"><LockKeyhole size={16} /><span>Bootstrap credentials come from environment variables and are never embedded in the client bundle.</span></div>
        </div>
      </section>
    </main>
  );
}
