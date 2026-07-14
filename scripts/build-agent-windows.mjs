import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const project = path.join(root, "agent", "windows", "OpsPilot.Agent.csproj");
const output = path.join(root, "dist", "windows-agent");
const publicOutput = path.join(root, "public", "downloads");
const fileName = "opspilot-agent-windows-x64.exe";

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
const publish = spawnSync("dotnet", ["publish", project, "-c", "Release", "-r", "win-x64", "--self-contained", "true", "-o", output, "-p:PublishSingleFile=true", "-p:PublishTrimmed=false", "-p:IncludeNativeLibrariesForSelfExtract=true"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
if (publish.status !== 0) process.exit(publish.status ?? 1);

const executable = path.join(output, fileName);
const checksum = createHash("sha256").update(readFileSync(executable)).digest("hex");
mkdirSync(publicOutput, { recursive: true });
copyFileSync(executable, path.join(publicOutput, fileName));
writeFileSync(path.join(output, `${fileName}.sha256`), `${checksum}  ${fileName}\n`);
writeFileSync(path.join(publicOutput, `${fileName}.sha256`), `${checksum}  ${fileName}\n`);
console.log(`Windows agent ready: ${executable}`);
console.log(`SHA-256: ${checksum}`);
