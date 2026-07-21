import { redirect } from "next/navigation";
import { Activity, Radar } from "lucide-react";
import { getSessionUser } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getSessionUser()) redirect("/overview");
  return (
    <main className="login-shell">
      <section className="login-window" aria-label="OpsPilot Control Console sign in">
        <header className="login-titlebar"><div className="brand"><span className="brand-mark"><Radar size={17} /></span><span>OpsPilot <em>Control Console</em></span></div><span className="environment-badge"><span className="status-dot status-dot-online" /> CONTROL PLANE ONLINE</span></header>
        <div className="login-workspace">
          <aside className="login-context" aria-label="Control plane status">
            <div className="login-context-head"><span className="context-icon"><Activity size={17} /></span><div><strong>Local operations service</strong><span>Live endpoint management</span></div></div>
            <dl>
              <div><dt>Environment</dt><dd>OpsPilot Live</dd></div>
              <div><dt>Agent gateway</dt><dd><span className="status-dot status-dot-online" /> Accepting check-ins</dd></div>
              <div><dt>Authentication</dt><dd>Local control plane</dd></div>
              <div><dt>Access model</dt><dd>Role and organization scoped</dd></div>
            </dl>
          </aside>
          <section className="login-panel">
            <div className="login-card">
              <span className="eyebrow">Operator authentication</span>
              <h1>Sign in</h1>
              <p>Use the bootstrap administrator or an invited operator account.</p>
              <LoginForm />
            </div>
          </section>
        </div>
        <footer className="login-footer"><span>OpsPilot RMM</span><span>Self-hosted endpoint operations console</span></footer>
      </section>
    </main>
  );
}
