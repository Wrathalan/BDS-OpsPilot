import { readFile } from "node:fs/promises";

for (const [name, path] of [
  ["OpsPilot web process", "/tmp/opspilot-app.pid"],
  ["RustDesk ID server", "/tmp/opspilot-hbbs.pid"],
  ["RustDesk relay", "/tmp/opspilot-hbbr.pid"],
]) {
  const pid = Number.parseInt((await readFile(path, "utf8")).trim(), 10);
  if (!Number.isInteger(pid) || pid < 1) throw new Error(`${name} PID is invalid.`);
  const stat = await readFile(`/proc/${pid}/stat`, "utf8");
  const state = stat.slice(stat.lastIndexOf(")") + 2).split(" ", 1)[0];
  if (state === "Z") throw new Error(`${name} is a zombie process.`);
}

const response = await fetch("http://127.0.0.1:3000/api/health");
if (!response.ok) throw new Error(`OpsPilot health endpoint returned ${response.status}.`);
const health = await response.json();
if (health.status !== "healthy" || health.database !== "ready") {
  throw new Error("OpsPilot control plane is not ready.");
}
