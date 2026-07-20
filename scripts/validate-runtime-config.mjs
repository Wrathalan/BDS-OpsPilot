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

function validHostAndPort(value) {
  if (!value || /[/?#@\s]/.test(value)) return false;
  const separator = value.lastIndexOf(":");
  if (separator < 1) return false;
  const port = Number(value.slice(separator + 1));
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

requireValue("SESSION_SECRET", (value) => value.length >= 32 && !value.toLowerCase().includes("replace-with"), "must contain at least 32 non-placeholder characters");
requireValue("BOOTSTRAP_ADMIN_PASSWORD", (value) => value.length >= 8 && value !== "change-this-before-starting", "must contain at least 8 characters and must not be the example password");
requireValue("APP_URL", validHttpUrl, "must be a valid HTTP or HTTPS URL without embedded credentials");
requireValue("AGENT_SERVER_URL", validHttpUrl, "must be a valid endpoint-reachable HTTP or HTTPS URL without embedded credentials");
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
