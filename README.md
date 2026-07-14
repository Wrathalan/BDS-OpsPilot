# OpsPilot RMM

OpsPilot is a local-first RMM control plane for authenticated endpoint enrollment, real host telemetry, scoped policy evaluation, threshold alerts, an allowlisted agent task queue, reporting, and privileged-action auditing.

## Docker quick start

Requirements: Docker Desktop with Compose.

```powershell
Copy-Item .env.example .env
# Set unique values for SESSION_SECRET and BOOTSTRAP_ADMIN_PASSWORD in .env
docker compose up --build -d
docker compose ps
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000) and sign in with the username configured by `BOOTSTRAP_ADMIN_USERNAME` and its configured password. The container health check verifies both the web server and database. SQLite is persisted at `/data/opspilot.db` in the named volume `opspilot-rmm-data`.

```powershell
docker compose logs -f opspilot
docker compose down
```

`docker compose down` preserves the named data volume. Use `docker compose down --volumes` only when you intentionally want to delete all control-plane data.

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
2. Select **Devices → Enroll endpoint** and issue a short-lived, scoped token.
3. Copy the token immediately; only its server-side hash is retained.
4. Download **Windows self-enrollment agent** from the token screen and copy it to the authorized endpoint.
5. Double-click `opspilot-agent-windows-x64.exe`, enter the OpsPilot URL, and paste the one-time token when prompted.

The Windows x64 executable is self-contained: the endpoint does not need Node.js or .NET installed. It collects actual host identity, OS, CPU, memory, disk, IP, user, uptime, reboot state, and minimal software inventory; enrolls the device; performs an authenticated check-in; and DPAPI-protects its agent secret for the enrolling Windows user. It can then remain open for continuous foreground monitoring.

For unattended test enrollment from a trusted terminal:

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

Both agents use the same authenticated protocol. `once` performs one live cycle and exits; `run` stays in the foreground and polls for two allowlisted tasks: status refresh and inventory refresh. Neither agent executes a supplied shell command or arbitrary payload.

Platform program and state locations are documented in [agent/INSTALL_PATHS.md](agent/INSTALL_PATHS.md). The repository-local `.agent-data` path is ignored by Git.

## Architecture

- Next.js 16 App Router, React 19, and TypeScript.
- Prisma 6 and SQLite for single-node persistence.
- Zod validation on authentication, operator actions, enrollment, check-ins, and task results.
- One-time enrollment tokens and separately revocable per-device agent credentials.
- Server-side RBAC and organization scoping.
- Database-backed telemetry, alert deduplication/recovery, task runs, and append-only audit workflows.
- Docker health checking and a persistent named volume.

Important surfaces:

- `app/api/agent/enroll`: consumes a scoped enrollment token and returns an agent secret once.
- `app/api/agent/check-in`: accepts authenticated telemetry and evaluates live thresholds.
- `app/api/agent/tasks`: exposes queued allowlisted tasks to the enrolled device only.
- `app/api/actions/route.ts`: validates and authorizes operator actions.
- `agent/windows`: native self-contained Windows x64 endpoint agent source.
- `agent/opspilot-agent.mjs`: foreground cross-platform repository agent.
- `prisma/bootstrap.mjs`: idempotent tenant and root-account bootstrap.

## Security boundaries

- User passwords use bcrypt with cost 12.
- Session tokens and agent secrets are stored as hashes; plaintext enrollment and agent credentials are returned only once.
- Session cookies are HTTP-only and SameSite Strict, and become Secure in production.
- Mutations validate origin, payload, tenant, organization scope, and permission.
- Agent tasks are hard-coded to `refresh-agent` and `inventory-refresh`; there is no remote shell, script runner, file browser, service control, process control, credential collection, or persistence installer.
- The agent does not create a Windows service, scheduled task, launch daemon, startup item, or background installation.
- Normal application routes do not expose audit edit or delete operations.
- `.env`, agent state, and credentials are ignored by Git.

Use HTTPS and a reachable `APP_URL` before testing across machines. Restrict the endpoint state-directory ACL, rotate any disclosed credential, and use test systems you are authorized to monitor.

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
| `npm run docker:up` | Build and start the persistent Docker stack |
| `npm run docker:down` | Stop the Docker stack without deleting data |
| `npm run agent:build:windows` | Build the self-contained Windows x64 endpoint executable |
| `npm run test:e2e:windows-agent` | Build and exercise the native executable through enrollment and task completion |

## Current live-test limits

- SQLite and in-process rate limiting target one control-plane instance.
- The agent must remain open in a foreground terminal; service installation is intentionally absent.
- The Windows executable is an unsigned live-test build, so Windows SmartScreen may require an explicit allow action until a trusted code-signing certificate is configured.
- Software inventory is intentionally minimal and uses only cross-platform Node.js host APIs.
- Patch discovery and installation, remote support, command execution, and endpoint persistence are not implemented.
- Notifications are in-app only. Production use needs managed persistence, shared rate limiting, TLS, MFA/SSO, credential rotation, backups, replay protection, signed agent releases, observability, and independent security testing.
