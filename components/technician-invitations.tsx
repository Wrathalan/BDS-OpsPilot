"use client";

import { ShieldCheck, UserRoundPlus, X } from "lucide-react";
import type { ConsoleData } from "@/lib/data";

const formatTime = (value: string | Date) => new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function status(invite: ConsoleData["technicianInvites"][number], now: number) {
  if (invite.acceptedAt) return "accepted";
  if (invite.revokedAt) return "revoked";
  if (new Date(invite.expiresAt).getTime() <= now) return "expired";
  return "pending";
}

export function TechnicianInvitations({ data, canManage, busy, onInvite, onMutate }: { data: ConsoleData; canManage: boolean; busy: boolean; onInvite: () => void; onMutate: (payload: Record<string, unknown>, message: string) => Promise<unknown> }) {
  if (!canManage) return null;
  const now = new Date(data.generatedAt).getTime();
  const pending = data.technicianInvites.filter((invite) => status(invite, now) === "pending").length;
  return <section className="panel technician-invite-panel">
    <div className="panel-head"><div><h2>Operator invitations</h2><p>Single-use enrollment with role and organization scope</p></div><div className="panel-head-actions"><span>{pending} pending</span><button className="primary-button" onClick={onInvite}><UserRoundPlus size={15} /> Invite operator</button></div></div>
    <div className="data-table-wrap embedded"><table className="data-table technician-invite-table"><thead><tr><th>Invitee</th><th>Role</th><th>Scope</th><th>Issued by</th><th>Expires</th><th>Status</th><th>Action</th></tr></thead><tbody>{data.technicianInvites.slice(0, 20).map((invite) => { const inviteStatus = status(invite, now); return <tr key={invite.id}><td><span className="two-line"><strong>{invite.name}</strong><small>{invite.email}</small></span></td><td>{invite.role.name}</td><td>{invite.allOrganizations ? "All organizations" : invite.organizationScopes.map(({ organization }) => organization.name).join(", ")}</td><td>{invite.createdBy.name}</td><td className="mono">{formatTime(invite.expiresAt)}</td><td><span className={`status-pill status-${inviteStatus}`}><i />{inviteStatus}</span></td><td>{inviteStatus === "pending" ? <button className="small-button" disabled={busy} onClick={() => onMutate({ action: "revokeTechnicianInvite", inviteId: invite.id }, "Operator invitation revoked.")}><X size={13} /> Revoke</button> : <span className="muted">No action</span>}</td></tr>; })}</tbody></table>{!data.technicianInvites.length && <div className="empty-state compact"><ShieldCheck size={18} /><p>No operator invitations have been issued.</p></div>}</div>
  </section>;
}
