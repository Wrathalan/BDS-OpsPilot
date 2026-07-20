const failures = [];

function requireValue(name, predicate, message) {
  const value = process.env[name]?.trim() ?? "";
  if (!predicate(value)) failures.push(`${name}: ${message}`);
}

function validHttpUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function encryptedOrExplicitlyAllowed(value) {
  const url = new URL(value);
  return url.protocol === "https:" || ["localhost", "127.0.0.1", "::1"].includes(url.hostname) || process.env.ALLOW_INSECURE_HTTP === "1";
}

function validBootstrapAdminPassword(value) {
  if (process.env.ALLOW_KNOWN_ADMIN_PASSWORD === "1" && value === "Ethic0n1") return true;
  return value.length >= 12 && !["Ethic0n1", "change-this-before-starting"].includes(value);
}

function validHostAndPort(value) {
  if (!value || /[/?#@\s]/.test(value)) return false;
  const separator = value.lastIndexOf(":");
  if (separator < 1) return false;
  const port = Number(value.slice(separator + 1));
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

requireValue("SESSION_SECRET", (value) => value.length >= 32 && !value.toLowerCase().includes("replace-with"), "must contain at least 32 non-placeholder characters");
requireValue("ALLOW_KNOWN_ADMIN_PASSWORD", (value) => value === "0" || value === "1", "must be 0 or 1");
requireValue("BOOTSTRAP_ADMIN_PASSWORD", validBootstrapAdminPassword, "must contain at least 12 characters and must not be a known development password unless the explicit legacy recovery exception is enabled");
requireValue("APP_URL", (value) => validHttpUrl(value) && encryptedOrExplicitlyAllowed(value), "must use HTTPS outside loopback unless ALLOW_INSECURE_HTTP=1 is explicitly set");
requireValue("AGENT_SERVER_URL", (value) => validHttpUrl(value) && encryptedOrExplicitlyAllowed(value), "must use HTTPS outside loopback unless ALLOW_INSECURE_HTTP=1 is explicitly set");
requireValue("APP_MODE", (value) => value === "live", "must be live");
requireValue("RUSTDESK_ID_SERVER", validHostAndPort, "must be a host and port");
requireValue("RUSTDESK_RELAY_SERVER", validHostAndPort, "must be a host and port");
requireValue("NEXT_TELEMETRY_DISABLED", (value) => value === "1", "must be 1");
requireValue("CHECKPOINT_DISABLE", (value) => value === "1", "must be 1");
requireValue("DOTNET_CLI_TELEMETRY_OPTOUT", (value) => value === "1", "must be 1");
requireValue("NPM_CONFIG_AUDIT", (value) => value === "false", "must be false");
requireValue("NPM_CONFIG_FUND", (value) => value === "false", "must be false");
requireValue("NPM_CONFIG_UPDATE_NOTIFIER", (value) => value === "false", "must be false");
requireValue("NO_UPDATE_NOTIFIER", (value) => value === "1", "must be 1");

if (failures.length) {
  console.error("OpsPilot production configuration is invalid:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("OpsPilot production configuration validated.");
