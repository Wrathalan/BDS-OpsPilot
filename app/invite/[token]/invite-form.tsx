"use client";

import { useState } from "react";
import { ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";

export function InviteForm({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [username, setUsername] = useState(email.split("@", 1)[0]?.toLowerCase().replace(/[^a-z0-9._-]/g, "-") || "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirm) { setError("The passwords do not match."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/invitations/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, username, password }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Account setup failed.");
      router.push("/overview");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Account setup failed.");
    } finally { setBusy(false); }
  }

  return <form onSubmit={submit} className="login-form">
    <label>Email<input value={email} readOnly autoComplete="email" /></label>
    <label>Username<input name="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value.toLowerCase())} pattern="[a-z0-9._-]{3,40}" required /></label>
    <label>Password<span className="password-wrap"><input name="password" type={show ? "text" : "password"} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} required /><button type="button" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow(!show)}>{show ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
    <label>Confirm password<input name="confirm" type={show ? "text" : "password"} autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} minLength={12} required /></label>
    <p className="password-policy">Use at least 12 characters with upper- and lowercase letters, a number, and a symbol.</p>
    {error && <div className="form-error" role="alert">{error}</div>}
    <button className="primary-button login-submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <>Create technician account <ArrowRight size={18} /></>}</button>
  </form>;
}
