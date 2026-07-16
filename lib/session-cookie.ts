const secureValues = new Set(["1", "true", "yes", "on"]);
const insecureValues = new Set(["0", "false", "no", "off"]);

export function resolveSecureSessionCookie(appUrl: string | undefined, override: string | undefined, nodeEnv: string | undefined) {
  const configured = override?.trim().toLowerCase();
  if (configured) {
    if (secureValues.has(configured)) return true;
    if (insecureValues.has(configured)) return false;
    throw new Error("SESSION_COOKIE_SECURE must be true or false when it is set.");
  }

  if (appUrl) {
    const protocol = new URL(appUrl).protocol;
    if (protocol === "https:") return true;
    if (protocol === "http:") return false;
    throw new Error("APP_URL must use http or https.");
  }

  return nodeEnv === "production";
}

export function shouldUseSecureSessionCookie() {
  return resolveSecureSessionCookie(process.env.APP_URL, process.env.SESSION_COOKIE_SECURE, process.env.NODE_ENV);
}
