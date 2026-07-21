export const REMOTE_PROVISIONING_TIMEOUT_MS = 30 * 60_000;

export type RemoteProviderState = "ready" | "failed" | "provisioning" | "stalled" | "awaiting-agent";

export type RemoteEndpointState = {
  status: string;
  lastVerifiedAt?: string | Date | null;
};

export function remoteProviderState(endpoint?: RemoteEndpointState | null, now = Date.now()): RemoteProviderState {
  if (!endpoint) return "awaiting-agent";
  if (endpoint.status === "ready") return "ready";
  if (endpoint.status === "failed") return "failed";

  const lastVerifiedAt = endpoint.lastVerifiedAt ? new Date(endpoint.lastVerifiedAt).getTime() : Number.NaN;
  if (!Number.isFinite(lastVerifiedAt) || now - lastVerifiedAt >= REMOTE_PROVISIONING_TIMEOUT_MS) return "stalled";
  return "provisioning";
}

export function hasReadyRemoteProvider(endpoints: Array<RemoteEndpointState | null | undefined>) {
  return endpoints.some((endpoint) => remoteProviderState(endpoint) === "ready");
}
