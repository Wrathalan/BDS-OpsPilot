#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const AGENT_VERSION = "0.2.0";
const args = process.argv.slice(2);
const command = args.shift();

function option(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function defaultDataDir() {
  if (process.platform === "win32") return "C:\\ProgramData\\OpsPilot";
  if (process.platform === "darwin") return "/Library/Application Support/OpsPilot Agent";
  return "/var/lib/opspilot-agent";
}

const dataDir = path.resolve(option("data-dir", process.env.OPSPILOT_AGENT_HOME || defaultDataDir()));
const configPath = path.join(dataDir, "agent.json");

function primaryAddress() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) if (address.family === "IPv4" && !address.internal) return address.address;
  }
  return "127.0.0.1";
}

function platformName() {
  if (process.platform === "win32") return "Windows";
  if (process.platform === "darwin") return "macOS";
  return `${os.type()} Linux`;
}

function disk() {
  try {
    const root = path.parse(process.cwd()).root;
    const stats = fs.statfsSync(root);
    const capacity = stats.blocks * stats.bsize;
    const free = stats.bavail * stats.bsize;
    return { capacityGb: Math.round(capacity / 1024 ** 3), usedPercent: capacity ? Math.round((1 - free / capacity) * 1000) / 10 : 0 };
  } catch { return { capacityGb: 0, usedPercent: 0 }; }
}

async function cpuPercent() {
  const snapshot = () => os.cpus().reduce((total, cpu) => {
    const times = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
    return { idle: total.idle + cpu.times.idle, total: total.total + times };
  }, { idle: 0, total: 0 });
  const first = snapshot();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const second = snapshot();
  const total = second.total - first.total;
  return total ? Math.round((100 - (second.idle - first.idle) / total * 100) * 10) / 10 : 0;
}

async function inventory() {
  const diskState = disk();
  return {
    hostname: os.hostname(),
    displayName: os.hostname(),
    role: process.platform === "win32" ? "Windows Endpoint" : process.platform === "darwin" ? "macOS Endpoint" : "Linux Endpoint",
    operatingSystem: platformName(),
    osVersion: os.release(),
    manufacturer: "Reported by operating system",
    model: os.arch(),
    serialNumber: "Not reported",
    cpu: os.cpus()[0]?.model || "Unknown CPU",
    memoryGb: Math.max(1, Math.round(os.totalmem() / 1024 ** 3)),
    diskCapacityGb: diskState.capacityGb,
    diskUsedPercent: diskState.usedPercent,
    ipAddress: primaryAddress(),
    lastLoggedInUser: (() => { try { return os.userInfo().username; } catch { return "Unknown"; } })(),
    agentVersion: AGENT_VERSION,
    uptimeMinutes: Math.floor(os.uptime() / 60),
  };
}

async function checkInPayload() {
  const diskState = disk();
  const memory = Math.round((1 - os.freemem() / os.totalmem()) * 1000) / 10;
  return {
    cpu: await cpuPercent(),
    memory,
    diskUsedPercent: diskState.usedPercent,
    diskCapacityGb: diskState.capacityGb,
    latencyMs: 0,
    uptimeMinutes: Math.floor(os.uptime() / 60),
    pendingReboot: false,
    agentVersion: AGENT_VERSION,
    ipAddress: primaryAddress(),
    lastLoggedInUser: (() => { try { return os.userInfo().username; } catch { return "Unknown"; } })(),
    hardware: { biosVersion: "Not reported", tpmVersion: null, cpuCores: os.cpus().length, macAddress: Object.values(os.networkInterfaces()).flat().find((item) => item && !item.internal)?.mac || "Not reported" },
    software: [
      { name: "OpsPilot Agent", version: AGENT_VERSION, vendor: "OpsPilot" },
      { name: "Node.js Runtime", version: process.version, vendor: "OpenJS Foundation" },
    ],
  };
}

async function request(server, endpoint, init = {}) {
  const response = await fetch(`${server.replace(/\/$/, "")}${endpoint}`, { ...init, headers: { "Content-Type": "application/json", "User-Agent": `OpsPilot-Agent/${AGENT_VERSION}`, ...(init.headers || {}) } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}

async function enroll() {
  const server = option("server", process.env.OPSPILOT_SERVER || "http://127.0.0.1:3000");
  const token = option("token", process.env.OPSPILOT_ENROLLMENT_TOKEN);
  if (!token) throw new Error("Provide --token or OPSPILOT_ENROLLMENT_TOKEN.");
  const result = await request(server, "/api/agent/enroll", { method: "POST", body: JSON.stringify({ token, ...(await inventory()) }) });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify({ server, deviceId: result.deviceId, agentSecret: result.agentSecret, intervalSeconds: result.intervalSeconds || 60 }, null, 2)}\n`, { mode: 0o600 });
  try { fs.chmodSync(configPath, 0o600); } catch {}
  console.log(`Enrolled ${os.hostname()} as ${result.deviceId}. Configuration saved to ${configPath}.`);
  console.log(`Run one check-in with: node agent/opspilot-agent.mjs once --data-dir "${dataDir}"`);
  console.log(`Run continuously with: node agent/opspilot-agent.mjs run --data-dir "${dataDir}"`);
}

function loadConfig() {
  if (!fs.existsSync(configPath)) throw new Error(`Agent configuration was not found at ${configPath}. Enroll first or pass --data-dir.`);
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

async function sendCheckIn(config) {
  const started = Date.now();
  const payload = await checkInPayload();
  payload.latencyMs = Date.now() - started;
  await request(config.server, "/api/agent/check-in", { method: "POST", headers: { Authorization: `Bearer ${config.agentSecret}` }, body: JSON.stringify(payload) });
  console.log(`[${new Date().toISOString()}] Check-in accepted: CPU ${payload.cpu}% · memory ${payload.memory}% · disk ${payload.diskUsedPercent}%`);
}

async function processTasks(config) {
  const { tasks } = await request(config.server, "/api/agent/tasks", { headers: { Authorization: `Bearer ${config.agentSecret}` } });
  for (const task of tasks || []) {
    let status = "succeeded";
    let output = "Authenticated live agent check-in completed.";
    let failureReason;
    try {
      if (!["refresh-agent", "inventory-refresh"].includes(task.action)) throw new Error("Action is not in the live-test allowlist.");
      await sendCheckIn(config);
    } catch (error) { status = "failed"; failureReason = error.message; output = ""; }
    await request(config.server, `/api/agent/tasks/${task.id}/complete`, { method: "POST", headers: { Authorization: `Bearer ${config.agentSecret}` }, body: JSON.stringify({ status, output, failureReason }) });
  }
}

async function run() {
  const config = loadConfig();
  console.log(`OpsPilot Agent ${AGENT_VERSION} running in the foreground. Data path: ${dataDir}`);
  console.log("Press Ctrl+C to stop. No service, scheduled task, or startup entry is installed.");
  while (true) {
    try { await sendCheckIn(config); await processTasks(config); }
    catch (error) { console.error(`[${new Date().toISOString()}] ${error.message}`); }
    await new Promise((resolve) => setTimeout(resolve, Math.max(15, config.intervalSeconds || 60) * 1000));
  }
}

async function once() {
  const config = loadConfig();
  await sendCheckIn(config);
  await processTasks(config);
}

try {
  if (command === "enroll") await enroll();
  else if (command === "once") await once();
  else if (command === "run") await run();
  else {
    console.log("OpsPilot foreground live-test agent\n\nCommands:\n  enroll --server <url> --token <token> [--data-dir <path>]\n  once [--data-dir <path>]\n  run [--data-dir <path>]\n\nThe agent has no arbitrary command runner and installs no background persistence.");
    process.exitCode = command ? 1 : 0;
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
