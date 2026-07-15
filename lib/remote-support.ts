import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";

export type RemoteProvider = "rustdesk" | "rdp";
export type RemotePackageProvider = "rustdesk";

const secretKey = () => createHash("sha256").update(`opspilot-remote-support:${process.env.SESSION_SECRET || ""}`).digest();

export function encryptRemoteSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

export function decryptRemoteSecret(value: string) {
  const packed = Buffer.from(value, "base64url");
  if (packed.length < 29) throw new Error("The stored remote-support secret is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), packed.subarray(0, 12));
  decipher.setAuthTag(packed.subarray(12, 28));
  return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString("utf8");
}

export function remotePackagePath(provider: RemotePackageProvider) {
  const directory = process.env.REMOTE_PACKAGE_DIR || path.join("remote", "packages");
  return path.join(/*turbopackIgnore: true*/ directory, `${provider}-windows-x64.exe`);
}

export async function remotePackageAvailable(provider: RemotePackageProvider) {
  try {
    await access(remotePackagePath(provider));
    return true;
  } catch {
    return false;
  }
}

export async function rustDeskPublicKey() {
  const keyPath = process.env.RUSTDESK_PUBLIC_KEY_PATH || path.join("remote", "rustdesk", "id_ed25519.pub");
  try {
    return (await readFile(/*turbopackIgnore: true*/ keyPath, "utf8")).trim();
  } catch {
    return "";
  }
}

export function remoteServerUrl(provider: RemoteProvider) {
  return provider === "rustdesk" ? process.env.RUSTDESK_ID_SERVER || "" : "";
}

export function createRustDeskDeepLink(externalId: string, idServer: string, publicKey: string, password?: string) {
  const parameters = new URLSearchParams({ key: publicKey });
  if (password) parameters.set("password", password);
  return `rustdesk://${externalId}/r@${idServer}?${parameters.toString()}`;
}

export function createRdpProfile(target: string, port = 3389) {
  const host = target.trim();
  if (!isIP(host) && !/^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(host)) throw new Error("The RDP target is invalid.");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("The RDP port is invalid.");
  const address = isIP(host) === 6 ? `[${host}]:${port}` : `${host}:${port}`;
  return [
    "screen mode id:i:2",
    "use multimon:i:1",
    "session bpp:i:32",
    "compression:i:1",
    "keyboardhook:i:2",
    "audiocapturemode:i:0",
    "videoplaybackmode:i:1",
    "connection type:i:7",
    "networkautodetect:i:1",
    "bandwidthautodetect:i:1",
    "displayconnectionbar:i:1",
    "disable wallpaper:i:1",
    "allow font smoothing:i:1",
    "allow desktop composition:i:1",
    "bitmapcachepersistenable:i:1",
    `full address:s:${address}`,
    "audiomode:i:0",
    "redirectprinters:i:0",
    "redirectcomports:i:0",
    "redirectsmartcards:i:0",
    "redirectclipboard:i:1",
    "redirectdrives:i:0",
    "devicestoredirect:s:",
    "autoreconnection enabled:i:1",
    "authentication level:i:2",
    "prompt for credentials:i:1",
    "negotiate security layer:i:1",
    "remoteapplicationmode:i:0",
    "gatewayusagemethod:i:0",
    "promptcredentialonce:i:0",
  ].join("\r\n") + "\r\n";
}

export function parseRdpEndpoint(value: string) {
  const separator = value.lastIndexOf(":");
  if (separator < 1) throw new Error("The stored RDP endpoint is invalid.");
  const host = value.slice(0, separator).replace(/^\[|\]$/g, "");
  const port = Number.parseInt(value.slice(separator + 1), 10);
  createRdpProfile(host, port);
  return { host, port };
}
