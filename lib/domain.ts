export type PolicySettings = Record<string, unknown>;
export type PolicyNode = { id: string; name: string; settings: PolicySettings; parent?: PolicyNode | null };
export type PolicyCandidate = { level: "organization" | "location" | "device"; policy: PolicyNode };

function mergeWithOrigins(target: PolicySettings, origins: Record<string, string>, source: PolicySettings, origin: string) {
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (value && typeof value === "object" && !Array.isArray(value) && typeof target[key] === "object" && !Array.isArray(target[key])) {
      const nested = { ...(target[key] as PolicySettings) };
      mergeWithOrigins(nested, origins, value as PolicySettings, origin);
      target[key] = nested;
    } else {
      target[key] = value;
      origins[key] = origin;
    }
  }
}

export function resolveInheritedPolicy(policy: PolicyNode): { settings: PolicySettings; origins: Record<string, string> } {
  const settings: PolicySettings = {};
  const origins: Record<string, string> = {};
  if (policy.parent) {
    const parent = resolveInheritedPolicy(policy.parent);
    mergeWithOrigins(settings, origins, parent.settings, `Inherited from ${policy.parent.name}`);
  }
  mergeWithOrigins(settings, origins, policy.settings, policy.name);
  return { settings, origins };
}

export function resolveEffectivePolicy(candidates: PolicyCandidate[]) {
  const order = { organization: 1, location: 2, device: 3 };
  const sorted = [...candidates].sort((a, b) => order[a.level] - order[b.level]);
  const settings: PolicySettings = {};
  const origins: Record<string, string> = {};
  for (const candidate of sorted) {
    const inherited = resolveInheritedPolicy(candidate.policy);
    mergeWithOrigins(settings, origins, inherited.settings, `${candidate.policy.name} · ${candidate.level} assignment`);
  }
  return { settings, origins, precedence: sorted.map((item) => ({ level: item.level, policy: item.policy.name })) };
}

export function alertFingerprint(deviceId: string, conditionType: string) {
  return `${deviceId}:${conditionType}`;
}

export function shouldCreateAlert(existing: { fingerprint: string; status: string }[], fingerprint: string) {
  return !existing.some((alert) => alert.fingerprint === fingerprint && !["resolved", "closed"].includes(alert.status));
}

const patchTransitions: Record<string, string[]> = {
  missing: ["scheduled", "installing", "held"],
  scheduled: ["installing", "held", "missing"],
  installing: ["installed", "failed"],
  failed: ["scheduled", "installing", "held"],
  held: ["scheduled", "missing"],
  installed: [],
};

export function transitionPatchState(current: string, next: string) {
  if (!patchTransitions[current]?.includes(next)) throw new Error(`Invalid patch transition: ${current} → ${next}`);
  return next;
}

export function canRunAutomation(permissionKeys: string[], approved: boolean, riskLevel: string, confirmed = false) {
  if (!permissionKeys.includes("automation.run") || !approved) return false;
  return riskLevel !== "high" || confirmed;
}

export function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [headers.map(escape).join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\r\n");
}

export function organizationAllowed(user: { tenantId: string; allOrganizations: boolean; organizationIds: string[] }, tenantId: string, organizationId: string) {
  return user.tenantId === tenantId && (user.allOrganizations || user.organizationIds.includes(organizationId));
}

export function conditionConsequences(condition: { active: boolean; createTicket: boolean; automationKey?: string | null }) {
  return { createAlert: condition.active, createTicket: condition.active && condition.createTicket, automationKey: condition.active ? condition.automationKey ?? null : null };
}

export function makeAuditEvent(input: { actorId: string; tenantId: string; action: string; resourceType: string; resourceId: string; success?: boolean }) {
  return { ...input, success: input.success ?? true, createdAt: new Date(), immutable: true as const };
}
