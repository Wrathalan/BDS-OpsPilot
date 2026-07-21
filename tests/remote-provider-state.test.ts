import { describe, expect, it } from "vitest";
import { hasReadyRemoteProvider, remoteProviderState, REMOTE_PROVISIONING_TIMEOUT_MS } from "@/lib/remote-provider-state";

describe("remote provider state", () => {
  const now = new Date("2026-07-21T12:00:00.000Z").getTime();

  it("distinguishes an agent that has never reported from active provisioning", () => {
    expect(remoteProviderState(undefined, now)).toBe("awaiting-agent");
  });

  it("preserves terminal ready and failed reports", () => {
    expect(remoteProviderState({ status: "ready", lastVerifiedAt: new Date(0) }, now)).toBe("ready");
    expect(remoteProviderState({ status: "failed", lastVerifiedAt: new Date(0) }, now)).toBe("failed");
  });

  it("marks a recent non-terminal report as provisioning", () => {
    expect(remoteProviderState({ status: "provisioning", lastVerifiedAt: new Date(now - 60_000) }, now)).toBe("provisioning");
  });

  it("marks an overdue or undated non-terminal report as stalled", () => {
    expect(remoteProviderState({ status: "provisioning", lastVerifiedAt: new Date(now - REMOTE_PROVISIONING_TIMEOUT_MS) }, now)).toBe("stalled");
    expect(remoteProviderState({ status: "provisioning", lastVerifiedAt: null }, now)).toBe("stalled");
  });

  it("recognizes either ready provider as available remote support", () => {
    expect(hasReadyRemoteProvider([{ status: "failed" }, { status: "ready" }])).toBe(true);
    expect(hasReadyRemoteProvider([{ status: "failed" }, undefined])).toBe(false);
  });
});
