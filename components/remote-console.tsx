"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, ExternalLink, LoaderCircle, MonitorUp, ShieldAlert } from "lucide-react";

type Endpoint = { provider: string; externalId: string; status: string; serverUrl: string };
type Session = { provider: "rustdesk" | "rdp"; url: string; server: string };

export function RemoteConsole({ device, canRemote }: { device: { id: string; displayName: string; hostname: string; remoteEndpoints: Endpoint[] }; canRemote: boolean }) {
  const rustdesk = device.remoteEndpoints.find((endpoint) => endpoint.provider === "rustdesk");
  const rdp = device.remoteEndpoints.find((endpoint) => endpoint.provider === "rdp");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function requestSession(provider: "rustdesk" | "rdp") {
    setBusy(provider); setError(""); setNotice("");
    try {
      const response = await fetch("/api/remote/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId: device.id, provider }) });
      const result = await response.json() as Session & { error?: string };
      if (!response.ok) throw new Error(result.error || "The remote session could not be started.");
      if (provider === "rustdesk") {
        setNotice("The native RustDesk client is opening with endpoint authentication supplied by OpsPilot.");
        window.location.assign(result.url);
      } else {
        setNotice("RDP profile downloaded. Open it and authenticate with an authorized Windows account.");
        window.location.assign(result.url);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The remote session could not be started.");
    } finally {
      setBusy("");
    }
  }

  return <div className="remote-workspace">
    <div className="remote-commandbar">
      <Link className="ghost-button" href={`/devices/${device.id}`}><ArrowLeft size={14} /> Device</Link>
      <div className="remote-command-identity"><MonitorUp size={15} /><span><strong>{device.displayName}</strong><small className="mono">{device.hostname}</small></span></div>
      <span className="remote-primary-label">Primary · RustDesk</span>
      <div className="remote-command-actions">
        <button className="ghost-button" disabled={!canRemote || rustdesk?.status !== "ready" || Boolean(busy)} onClick={() => requestSession("rustdesk")}>
          {busy === "rustdesk" ? <LoaderCircle className="spin" size={14} /> : <ExternalLink size={14} />} Open RustDesk
        </button>
        <button className="ghost-button" disabled={!canRemote || rdp?.status !== "ready" || Boolean(busy)} onClick={() => requestSession("rdp")}>
          {busy === "rdp" ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />} RDP fallback
        </button>
      </div>
    </div>

    {error && <div className="remote-notice error"><ShieldAlert size={15} />{error}</div>}
    {notice && <div className="remote-notice">{notice}</div>}
    {!canRemote && <div className="remote-empty"><ShieldAlert size={24} /><strong>Remote control permission required</strong><p>Your role does not include remote.control.</p></div>}
    {canRemote && rustdesk?.status !== "ready" && <div className="remote-empty"><MonitorUp size={24} /><strong>RustDesk is not ready on this endpoint</strong><p>Keep the OpsPilot tray agent running. It retries provider setup every 15 minutes.</p>{rdp?.status === "ready" && <button className="primary-button" onClick={() => requestSession("rdp")}><Download size={14} /> Download RDP fallback</button>}</div>}
    {canRemote && rustdesk?.status === "ready" && busy !== "rustdesk" && <div className="remote-empty"><MonitorUp size={24} /><strong>RustDesk remote control is ready</strong><p>OpsPilot supplies endpoint authentication automatically when the native client opens.</p><button className="primary-button" onClick={() => requestSession("rustdesk")}><ExternalLink size={14} /> Start primary session</button></div>}
    {canRemote && rustdesk?.status === "ready" && busy === "rustdesk" && <div className="remote-empty"><LoaderCircle className="spin" size={24} /><strong>Opening RustDesk</strong><p>Preparing the native primary session.</p></div>}
  </div>;
}
