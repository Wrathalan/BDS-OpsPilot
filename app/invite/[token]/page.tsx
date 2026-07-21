import Link from "next/link";
import { Activity, LockKeyhole, Radar, ShieldCheck, UserRoundPlus } from "lucide-react";
import { db } from "@/lib/db";
import { hashTechnicianInviteToken, technicianInviteStatus } from "@/lib/technician-invitations";
import { InviteForm } from "./invite-form";

export const metadata = { title: "Accept operator invitation" };

export default async function TechnicianInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await db.technicianInvite.findUnique({ where: { tokenHash: hashTechnicianInviteToken(token) }, include: { tenant: true, role: true, organizationScopes: { include: { organization: true } } } });
  const active = invite && technicianInviteStatus(invite) === "pending";
  return <main className="login-shell">
    <section className="login-window" aria-label="OpsPilot operator invitation">
      <header className="login-titlebar"><div className="brand"><span className="brand-mark"><Radar size={17} /></span><span>OpsPilot <em>Control Console</em></span></div><span className="environment-badge"><span className={`status-dot ${active ? "status-dot-online" : "status-dot-offline"}`} /> OPERATOR ACCESS</span></header>
      <div className="login-workspace">
        <aside className="login-context" aria-label="Invitation details">
          <div className="login-context-head"><span className="context-icon"><Activity size={17} /></span><div><strong>{invite?.tenant.name ?? "OpsPilot Live"}</strong><span>Self-hosted operations service</span></div></div>
          <dl>
            <div><dt>Access role</dt><dd>{invite?.role.name ?? "Unavailable"}</dd></div>
            <div><dt>Organization scope</dt><dd>{invite?.allOrganizations ? "All organizations" : invite?.organizationScopes.map(({ organization }) => organization.name).join(", ") || "Unavailable"}</dd></div>
            <div><dt>Invitation security</dt><dd>Single use · Time limited</dd></div>
          </dl>
          <div className="login-security-note"><ShieldCheck size={16} /><span>Your password is stored as a bcrypt hash and the invitation token cannot be recovered from the server.</span></div>
        </aside>
        <section className="login-panel"><div className="login-card">
          <span className="eyebrow">Operator enrollment</span>
          {active && invite ? <><h1>Set up your account</h1><p>You were invited as {invite.name}. Choose your username and a strong password to join the console.</p><InviteForm token={token} email={invite.email} /><div className="bootstrap-note"><LockKeyhole size={14} /><span>This link expires {invite.expiresAt.toLocaleString()} and is invalidated immediately after use.</span></div></> : <><UserRoundPlus size={25} className="invite-unavailable-icon" /><h1>Invitation unavailable</h1><p>This link is invalid, expired, revoked, or has already been used.</p><Link className="primary-button login-submit" href="/login">Return to sign in</Link></>}
        </div></section>
      </div>
      <footer className="login-footer"><span>OpsPilot RMM</span><span>Role- and organization-scoped access</span></footer>
    </section>
  </main>;
}
