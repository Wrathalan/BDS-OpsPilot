# OpsPilot RMM

OpsPilot is a self-hosted RMM control plane for authenticated endpoint enrollment, operational host metrics, scoped policy evaluation, threshold alerts, an allowlisted agent task queue, reporting, and privileged-action auditing.

- Repository: [Wrathalan/BDS-OpsPilot](https://github.com/Wrathalan/BDS-OpsPilot)
- Deployment branch: `main`

OpsPilot is production-ready for a private, single-node LAN deployment or for access through a properly configured HTTPS reverse proxy. It is intentionally not presented as safe for direct public-internet exposure; see the deployment boundaries below.

## Docker quick start

Requirement: Docker Engine or Docker Desktop with Compose v2.

Clone the current main build:

```console
git clone https://github.com/Wrathalan/BDS-OpsPilot.git
cd BDS-OpsPilot
```

Windows:

```powershell
.\scripts\docker-setup.ps1
```

Linux or Unraid:

```bash
./scripts/docker-setup.sh
```

That single command verifies Docker, creates `.env` when it is missing, generates the session secret and initial root password, selects a LAN-reachable host address, builds the control plane and Windows endpoint executable, and starts the self-contained `opspilot-rmm` container. The web console, RustDesk ID server, and RustDesk relay share that one container and lifecycle. Setup waits until all three processes are healthy, validates the production configuration, and writes a verified database-and-server-identity backup. It is safe to rerun: an existing `.env`, administrator password, database volume, and RustDesk server identity are retained.

The generated sign-in details and application URL are printed when the first setup finishes. They remain available in the local `.env`, which is ignored by Git. To override automatic LAN detection, provide the host address explicitly:

```powershell
.\scripts\docker-setup.ps1 -HostAddress 192.168.2.107
```

```bash
OPSPILOT_HOST=192.168.2.107 ./scripts/docker-setup.sh
```

The container health check verifies the web server, database, RustDesk ID server, and RustDesk relay. SQLite is persisted at `/data/opspilot.db` in `opspilot-rmm-data`; the RustDesk identity remains in `opspilot-rustdesk-data`. Both volumes are mounted into the single `opspilot-rmm` container. The root filesystem is read-only, application and RustDesk processes run without root privileges, Linux capabilities are restricted, process count is capped, and container logs rotate.

On Unraid, the Docker list item includes the OpsPilot icon and an **Open WebUI** shortcut. Both use the deployed `APP_URL`, so the shortcut opens the same LAN or reverse-proxy address printed by setup.

```powershell
docker compose logs -f opspilot
docker compose down
```

`docker compose down` preserves both named data volumes. Use `docker compose down --volumes` only when you intentionally want to delete all control-plane data and the RustDesk server identity.

## Backups and recovery

Every successful one-command deployment writes a consistent SQLite snapshot, the RustDesk server identity, SHA-256 checksums, and a manifest under `./backups/<timestamp>/`. Backups older than `BACKUP_RETENTION_DAYS` are removed; the default is 30 days. Create an additional backup at any time:

```console
docker compose exec -T --user node opspilot node scripts/create-backup.mjs
```

Copy `backups/` to storage outside this Docker host on a schedule appropriate to the environment. To recover, stop the stack, verify the manifest checksums, restore `opspilot.db` to the `opspilot-rmm-data` volume and both `id_ed25519` files to `opspilot-rustdesk-data`, then start the stack and confirm its health check. Do not restore only one of the database and RustDesk identity when remote support continuity matters.

## Update an existing installation

Pull the latest commit for the checked-out branch, then rerun the same setup command. The scripts rebuild the changed image, remove obsolete multi-container services, and retain `.env`, the administrator account, enrolled endpoint data, and the RustDesk server identity.

Windows:

```powershell
git pull --ff-only
.\scripts\docker-setup.ps1
```

Linux or Unraid:

```bash
git pull --ff-only
./scripts/docker-setup.sh
```

## Native development

Requirements: Node.js 22.13 or newer and npm.

```powershell
npm install
Copy-Item .env.example .env
# Configure .env before continuing
npm run local
```

`npm run setup` generates the Prisma client, synchronizes the SQLite schema, and idempotently bootstraps the tenant, permissions, roles, root administrator, two low-risk agent actions, and a live endpoint baseline. It does not create endpoints, alerts, tickets, patches, or telemetry.

## Enroll an endpoint

1. Sign in and create an organization and location.
2. Select **Devices → Enroll endpoint**, choose the endpoint scope, and create an agent package.
3. Download the personalized Windows executable and copy it to the authorized endpoint.
4. Launch `opspilot-agent-windows-x64.exe` and approve the Windows elevation request. It connects to `AGENT_SERVER_URL`, enrolls itself, saves its protected credential, checks in, provisions both remote-support agents, and starts foreground monitoring without configuration prompts or command-line arguments.

The Windows x64 executable is self-contained: the endpoint does not need Node.js or .NET installed. OpsPilot embeds the control-plane address and scoped enrollment token into each personalized download without placing the token in the download URL. The agent collects actual host identity, OS, CPU, memory, disk, IP, user, uptime, reboot state, and minimal software inventory; enrolls the device; performs an authenticated check-in; and DPAPI-protects its agent secret for the enrolling Windows user.

The universal build still supports explicit CLI enrollment for development and recovery:

```powershell
.\opspilot-agent-windows-x64.exe enroll --server http://127.0.0.1:3000 --token <one-time-token>
.\opspilot-agent-windows-x64.exe once
.\opspilot-agent-windows-x64.exe run
```

The cross-platform Node.js agent remains available for repository and non-Windows testing:

```powershell
node agent/opspilot-agent.mjs enroll --server http://127.0.0.1:3000 --token <one-time-token> --data-dir .agent-data
node agent/opspilot-agent.mjs once --data-dir .agent-data
node agent/opspilot-agent.mjs run --data-dir .agent-data
```

Both agents use the same authenticated protocol. `once` performs one live cycle and exits; the cross-platform `run` command stays in the foreground while the native Windows agent runs from the notification area. Both poll for two allowlisted tasks: status refresh and inventory refresh. The native agent also retries approved remote-provider provisioning every 15 minutes. Neither agent executes a supplied shell command or arbitrary payload.

Platform program and state locations are documented in [agent/INSTALL_PATHS.md](agent/INSTALL_PATHS.md). The repository-local `.agent-data` path is ignored by Git.

## Remote support

- **RustDesk Server OSS 1.1.15** is the primary provider. OpsPilot opens the native RustDesk client with the self-hosted server key and supplies the endpoint's encrypted-at-rest permanent password through RustDesk's supported connection-link parameter.
- **Windows Remote Desktop** is the secondary LAN fallback. The agent reports it ready only when RDP is enabled, Network Level Authentication is required, and the configured port is listening. OpsPilot downloads a credential-prompting `.rdp` profile without drive, printer, COM-port, or smart-card redirection.
- The endpoint downloads the pinned RustDesk client only through its authenticated OpsPilot agent channel. RustDesk 1.4.9 is SHA-256 verified while the control-plane image is built. OpsPilot does not enable RDP or change endpoint firewall policy.
- Provider identifiers, readiness, versions, and verification time are stored per device. RustDesk passwords use AES-256-GCM under a key derived from `SESSION_SECRET` and are never returned in list/detail payloads.

The self-contained OpsPilot container publishes the console port plus RustDesk on TCP 21115–21119 and UDP 21116. Set `RUSTDESK_ID_SERVER` and `RUSTDESK_RELAY_SERVER` to LAN-reachable addresses before enrolling endpoints. RDP fallback profiles use the endpoint's authenticated inventory address and require authorized Windows credentials.

RustDesk server and client are AGPL-3.0; review the applicable license and source-distribution obligations before distributing a modified or hosted offering.

## Architecture

- Next.js 16 App Router, React 19, and TypeScript.
- Prisma 6 and SQLite for single-node persistence.
- Zod validation on authentication, operator actions, enrollment, check-ins, and task results.
- One-time enrollment tokens and separately revocable per-device agent credentials.
- Server-side RBAC and organization scoping.
- Database-backed telemetry, alert deduplication/recovery, task runs, and append-only audit workflows.
- A single self-contained Docker container with health checking and persistent control-plane and RustDesk identity volumes.

Important surfaces:

- `app/api/agent/enroll`: consumes a scoped enrollment token and returns an agent secret once.
- `app/api/agent/windows/download`: creates an authenticated, personalized zero-touch Windows executable.
- `app/api/agent/check-in`: accepts authenticated telemetry and evaluates live thresholds.
- `app/api/agent/tasks`: exposes queued allowlisted tasks to the enrolled device only.
- `app/api/agent/remote-support`: provides authenticated provider configuration, packages, and readiness reporting.
- `app/api/remote/session`: authorizes and audits operator remote-session requests.
- `app/api/actions/route.ts`: validates and authorizes operator actions.
- `agent/windows`: native self-contained Windows x64 endpoint agent source.
- `agent/opspilot-agent.mjs`: foreground cross-platform repository agent.
- `prisma/bootstrap.mjs`: idempotent tenant and root-account bootstrap.

## Security boundaries

- User passwords use bcrypt with cost 12.
- Session tokens and agent secrets are stored as hashes; the scoped enrollment token is embedded into the personalized executable and defaults to one endpoint install.
- Session cookies are HTTP-only and SameSite Strict. The Secure flag follows the `APP_URL` protocol, and `SESSION_COOKIE_SECURE=true` can force it when HTTPS terminates at a reverse proxy.
- Mutations validate origin, payload, tenant, organization scope, and permission.
- Agent tasks are hard-coded to `refresh-agent` and `inventory-refresh`; OpsPilot exposes remote desktop through the two configured providers but no arbitrary shell, script runner, process control, or supplied command payload.
- The native OpsPilot monitor runs in the Windows notification area. Enrollment installs RustDesk as a managed Windows service after elevation and only inspects the built-in RDP/NLA state.
- Starting a remote session requires the `remote.control` permission, organization scope, a ready provider mapping, and same-origin validation; every request is audited.
- Normal application routes do not expose audit edit or delete operations.
- `.env`, agent state, and credentials are ignored by Git.

Use HTTPS and set `AGENT_SERVER_URL` to an address reachable by endpoints before testing across machines; `APP_URL` remains the browser/control-plane origin. Treat an unused personalized executable as an enrollment credential, restrict the endpoint state-directory ACL, rotate any disclosed credential, and use test systems you are authorized to monitor.

## Privacy and outbound traffic

OpsPilot includes no product analytics, advertising identifiers, third-party browser beacons, or external crash reporting. Required endpoint health metrics stay in the configured OpsPilot database. Browser policy restricts connections, forms, images, scripts, and other active content to the same self-hosted origin.

Next.js, Prisma, the .NET CLI, and npm telemetry, checkpoints, audit submission, funding output, and update notices are explicitly disabled during builds and at runtime. The Windows agent also disables RustDesk automatic updates, LAN discovery, and remote configuration changes. No application runtime component initiates calls to an analytics, checkpoint, update, advertising, or crash-reporting service. The Docker service uses a standard bridge so its published console and RustDesk ports remain reachable; deployments that require blanket network egress filtering should enforce that policy at the Docker host or perimeter firewall. Image builds still require outbound access to retrieve pinned base images, npm/NuGet packages, and the checksum-pinned RustDesk client.

Use an HTTPS reverse proxy for any access beyond a trusted private LAN. The proxy must preserve the original `Host`, `Origin`, and client address headers, and `APP_URL` and `AGENT_SERVER_URL` must match the externally reachable HTTPS origin. Set `SESSION_COOKIE_SECURE=true` when TLS is terminated upstream.

## Commands

| Command | Purpose |
|---|---|
| `npm run local` | Bootstrap and launch the development server |
| `npm run setup` | Generate Prisma client, sync schema, and bootstrap live defaults |
| `npm run dev` | Start the local development server |
| `npm run build` | Create a production build |
| `npm start` | Start the production server |
| `npm run typecheck` | Run strict TypeScript validation |
| `npm run lint` | Run ESLint |
| `npm test` | Run the Vitest domain/security suite |
| `npm run test:e2e` | Run the root → enroll → check-in → task → audit workflow |
| `npm run check` | Typecheck, lint, unit tests, and production build |
| `.\scripts\docker-setup.ps1` | One-command Windows Docker setup and health verification |
| `./scripts/docker-setup.sh` | One-command Linux/Unraid Docker setup and health verification |
| `npm run docker:up` | Build and start the persistent Docker stack |
| `npm run docker:down` | Stop the Docker stack without deleting data |
| `npm run backup` | Create a verified SQLite and RustDesk identity backup inside the container |
| `npm run agent:build:windows` | Build the self-contained Windows x64 endpoint executable |
| `npm run test:e2e:windows-agent` | Build and validate the native executable, then exercise enrollment and task completion |

The Windows E2E command always builds and validates the personalized PE payload, then exercises the full enrollment protocol. Because the production executable correctly requests administrator rights for RustDesk service provisioning, set `OPSPILOT_E2E_RUN_ELEVATED_AGENT=1` only when the test shell is already elevated and native execution is desired.

## Production scope and remaining boundaries

- SQLite and in-process rate limiting target one control-plane instance.
- The OpsPilot monitor must remain running in the Windows notification area; RustDesk persists as its own Windows service and RDP remains managed by Windows.
- The Windows executable is unsigned, so Windows SmartScreen may require an explicit allow action until a trusted code-signing certificate is configured.
- Software inventory is intentionally minimal; the Windows executable reports its own runtime plus native host telemetry.
- Patch discovery/installation and arbitrary command execution are not implemented.
- Notifications are in-app only. Public-internet or multi-node operation still requires TLS, MFA/SSO, shared rate limiting, centralized secrets and persistence, signed agent releases, independent security review, and an environment-specific disaster-recovery plan.
