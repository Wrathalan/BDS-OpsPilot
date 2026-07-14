import { describe, expect, it } from "vitest";
import { alertFingerprint, canRunAutomation, conditionConsequences, makeAuditEvent, organizationAllowed, remediateSimulatedService, resolveEffectivePolicy, shouldCreateAlert, toCsv, transitionPatchState, type PolicyNode } from "@/lib/domain";

const root: PolicyNode = { id: "root", name: "Secure Baseline", settings: { cpuThreshold: 90, patchMode: "critical", notifications: ["in-app"] } };
const child: PolicyNode = { id: "child", name: "Server Guardrails", settings: { cpuThreshold: 80, rebootBehavior: "manual" }, parent: root };

describe("tenant and organization isolation", () => {
  const scoped = { tenantId: "tenant-a", allOrganizations: false, organizationIds: ["org-1"] };
  it("rejects a different tenant even if the organization id appears in scope", () => expect(organizationAllowed(scoped, "tenant-b", "org-1")).toBe(false));
  it("enforces organization scope for technicians", () => { expect(organizationAllowed(scoped, "tenant-a", "org-1")).toBe(true); expect(organizationAllowed(scoped, "tenant-a", "org-2")).toBe(false); });
  it("allows tenant administrators across organizations in their tenant", () => expect(organizationAllowed({ ...scoped, allOrganizations: true }, "tenant-a", "org-99")).toBe(true));
});

describe("policy engine", () => {
  it("inherits parent values and records the child override", () => {
    const result = resolveEffectivePolicy([{ level: "organization", policy: child }]);
    expect(result.settings).toMatchObject({ cpuThreshold: 80, patchMode: "critical", rebootBehavior: "manual" });
    expect(result.origins.cpuThreshold).toContain("organization assignment");
  });
  it("applies device over location over organization precedence", () => {
    const location: PolicyNode = { id: "location", name: "Location Policy", settings: { cpuThreshold: 75 } };
    const device: PolicyNode = { id: "device", name: "Device Exception", settings: { cpuThreshold: 70 } };
    const result = resolveEffectivePolicy([{ level: "device", policy: device }, { level: "organization", policy: root }, { level: "location", policy: location }]);
    expect(result.settings.cpuThreshold).toBe(70);
    expect(result.origins.cpuThreshold).toBe("Device Exception · device assignment");
  });
});

describe("monitoring and remediation", () => {
  it("deduplicates an unresolved condition by fingerprint", () => {
    const fingerprint = alertFingerprint("device-1", "service_stopped");
    expect(shouldCreateAlert([{ fingerprint, status: "open" }], fingerprint)).toBe(false);
    expect(shouldCreateAlert([{ fingerprint, status: "resolved" }], fingerprint)).toBe(true);
  });
  it("creates a ticket and selects approved remediation from a condition", () => expect(conditionConsequences({ active: true, createTicket: true, automationKey: "restart-service" })).toEqual({ createAlert: true, createTicket: true, automationKey: "restart-service" }));
  it("marks a simulated stopped service and alert recovered", () => expect(remediateSimulatedService({ serviceState: "stopped", deviceStatus: "critical", alertStatus: "open" })).toEqual({ serviceState: "running", deviceStatus: "online", alertStatus: "resolved" }));
});

describe("patch and automation safeguards", () => {
  it("allows only expected patch transitions", () => { expect(transitionPatchState("missing", "installing")).toBe("installing"); expect(() => transitionPatchState("installed", "missing")).toThrow("Invalid patch transition"); });
  it("requires permission, approval, and confirmation for high-risk automation", () => { expect(canRunAutomation(["automation.run"], true, "low")).toBe(true); expect(canRunAutomation([], true, "low")).toBe(false); expect(canRunAutomation(["automation.run"], true, "high")).toBe(false); expect(canRunAutomation(["automation.run"], true, "high", true)).toBe(true); });
});

describe("evidence and export", () => {
  it("builds an immutable audit event with a default success result", () => { const event = makeAuditEvent({ actorId: "user-1", tenantId: "tenant-a", action: "patch.approved", resourceType: "Patch", resourceId: "patch-1" }); expect(event.success).toBe(true); expect(event.immutable).toBe(true); expect(event.createdAt).toBeInstanceOf(Date); });
  it("escapes CSV values and preserves a header row", () => { const csv = toCsv([{ Hostname: "OPS-01", Notes: "Needs review, owner said \"later\"" }]); expect(csv.split("\r\n")).toHaveLength(2); expect(csv).toContain('"Needs review, owner said ""later"""'); });
});
