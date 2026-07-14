"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";

const demoPasswords: Record<string, string> = {
  "admin@opspilot.local": "OpsPilot!2026",
  "tech@opspilot.local": "Technician!2026",
  "auditor@opspilot.local": "Auditor!2026",
};

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@opspilot.local");
  const [password, setPassword] = useState("OpsPilot!2026");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const handler = (event: Event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-demo-email]");
      if (!button) return;
      const selected = button.dataset.demoEmail!;
      setEmail(selected);
      setPassword(demoPasswords[selected]);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      router.push("/overview");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign-in failed.");
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="login-form">
      <label>Email address<input name="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
      <label>Password<span className="password-wrap"><input name="password" type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /><button type="button" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow(!show)}>{show ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
      {error && <div className="form-error" role="alert">{error}</div>}
      <button className="primary-button login-submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <>Sign in to console <ArrowRight size={18} /></>}</button>
    </form>
  );
}
