# OpsPilot RMM

OpsPilot RMM is a local, simulator-first remote monitoring and management console. It demonstrates multi-tenant device operations, policy evaluation, alerting, approved remediation, patch workflows, ticketing, reporting, and privileged-action auditing without connecting to real endpoints.

## Quick start

Requirements: Node.js 22.13 or newer and npm.

```powershell
npm install
Copy-Item .env.example .env
npm run local
```

`npm run local` is the single fresh-workspace command: it generates the Prisma client, creates/updates the SQLite schema, seeds the demonstration tenant, and starts OpsPilot at [http://127.0.0.1:3000](http://127.0.0.1:3000).

For later launches, when the database is already prepared:

```powershell
npm run dev
```

## Demo accounts

These credentials exist only in the local seed data. They are not production defaults.

| Role | Email | Password | Scope |
|---|---|---|---|
| System Administrator | `admin@opspilot.local` | `OpsPilot!2026` | Entire tenant |
| Technician | `tech@opspilot.local` | `Technician!2026` | Redwood Dental and Kite & Harbor |
| Read-Only Auditor | `auditor@opspilot.local` | `Auditor!2026` | Entire tenant, read-only |

Run `npm run db:seed` at any time to reset the local demonstration data. Never carry these users or passwords into a deployed environment.

## What is included

- Original, responsive operations-console UI with dark/light themes and keyboard-accessible controls.
- Tenant → organization → location → device hierarchy with organization-scoped technicians.
- 30 seeded simulated endpoints across Windows, Windows Server, macOS, and Ubuntu.
- Hardware/software inventory, telemetry, status history, bulk selection, search, sorting, and filters.
- Parent/child policy inheritance plus device > location > organization assignment precedence.
- Effective-policy display that identifies the origin of every setting.
- Alert deduplication, acknowledgement, suppression, resolution, notification, ticket, and remediation flows.
- Safe automation library with no shell, PowerShell, credential, persistence, or arbitrary-command capability.
- Simulated patch catalog, approval, test/production rings, install state transitions, failures, reboot state, and CSV compliance reporting.
- Integrated ticket board and SLA metadata.
- Explicitly labeled simulated diagnostic sessions with requester/approval/end history and read-only process, service, and file inventory examples.
- Saved report definitions, CSV export, dashboard trends, and append-only audit events.
- Thirty days of seeded chart data plus an in-browser telemetry pulse every 45 seconds while an authorized operator is signed in.

## Architecture

- **Next.js 16 App Router + React 19 + TypeScript** for server-rendered routes and interactive console components.
- **Tailwind CSS 4** is available through the global stylesheet; the product design system uses explicit CSS variables and semantic component classes for dense control-plane layouts.
- **Prisma 6 + SQLite** for zero-configuration persistence. The checked-in initial migration is in `prisma/migrations`; `prisma/schema.prisma` is the domain source of truth.
- **Zod** validates every authentication and action payload.
- **Route handlers** implement authentication, privileged actions, simulator transitions, and CSV exports.
- **Database-backed automation runs, agent sessions, metrics, alerts, tickets, reports, and audit records** model background/scheduled work and evidence. The MVP runs simulator pulses from the active console; a production worker can claim the same records later.
- **Vitest** covers domain and security rules. **Playwright** covers the administrator create → enroll → alert → remediate → audit workflow.

Important server surfaces:

- `app/api/auth/*`: rate-limited password sign-in and secure session lifecycle.
- `app/api/actions/route.ts`: validated, permission-checked control-plane operations.
- `app/api/reports/[report]/route.ts`: scoped CSV exports.
- `lib/rbac.ts`: role and organization authorization.
- `lib/domain.ts`: policy resolution, deduplication, patch transitions, CSV, and domain rules.
- `prisma/seed.ts`: deterministic demonstration estate.

## Security boundaries

OpsPilot treats the console as a privileged control plane even in local mode:

- Passwords are hashed with bcrypt cost 12.
- Random session tokens are stored only as SHA-256 hashes; cookies are HTTP-only, SameSite Strict, and Secure in production.
- Authentication is rate-limited per request source.
- Mutation origins are checked and all inputs are schema-validated.
- Role and organization checks run on the server for every protected operation and query.
- Technicians cannot access unassigned organizations; auditors cannot mutate state.
- High-impact actions require permission/confirmation and must exist in the approved automation catalog.
- Audit events record actor, tenant, organization, action, resource, time, request context, before/after summary, and result. Normal routes expose no audit edit/delete operation.
- `.env` is ignored. Copy `.env.example` and use a unique `SESSION_SECRET` outside local development.

The local in-memory login limiter is appropriate for one process only. A distributed deployment must move rate-limit state to a shared store and enforce HTTPS, secret rotation, stronger CSRF tokens where cross-site flows are introduced, MFA/SSO, session revocation, and database-level immutable audit retention.

## Simulator boundary

Every endpoint, telemetry sample, service, process, file path, patch install, reboot, support session, and automation result is simulated. OpsPilot never claims a real connection. There is no remote desktop, remote shell, arbitrary script runner, credential harvesting, or persistence mechanism.

The executor interface is represented by approved `Automation` definitions and recorded `AutomationRun` state transitions. A production extension should require separately reviewed, signed, versioned packages and an authenticated agent transport rather than adding generic command execution.

## Commands

| Command | Purpose |
|---|---|
| `npm run local` | Prepare, seed, and launch a fresh local app |
| `npm run setup` | Generate Prisma client, sync SQLite schema, and reseed |
| `npm run dev` | Start development server |
| `npm run build` | Create production build |
| `npm start` | Start production build |
| `npm run typecheck` | Strict TypeScript validation |
| `npm run lint` | ESLint validation |
| `npm test` | Vitest domain/security suite |
| `npm run test:e2e` | Playwright administrator workflow |
| `npm run check` | Typecheck, lint, tests, and production build |
| `npm run db:seed` | Reset deterministic demonstration data |

## Testing

The Vitest suite covers tenant isolation, organization scope, policy inheritance and precedence, alert deduplication, condition-to-ticket behavior, automatic simulated recovery, patch transitions, automation authorization, audit-event construction, and CSV escaping.

The Playwright scenario signs in as the administrator; creates an organization, location, and policy; generates an endpoint; triggers a stopped-service condition; confirms an alert; runs the approved restart automation; verifies recovery/resolution; and confirms `automation.executed` in the audit log.

## Current MVP limitations

- SQLite and the in-process rate limiter target a single local instance.
- Telemetry scheduling runs while an authorized console is open; there is no separate durable worker daemon yet.
- Notifications are in-app only, report charts are local, and printable views use browser printing.
- Patch/download/service/process/file data are simulator records, not a real agent protocol.
- Policy editing starts from safe defaults; a full visual rule/maintenance-window editor is a logical next UI increment.
- Session approval is represented by an explicit recorded demo user, not an external end-user consent client.

## Production-hardening path

1. Move to managed PostgreSQL, shared rate limiting, durable job claims, and immutable audit storage.
2. Add OIDC/SAML, MFA, SCIM, short-lived privileged elevation, and centralized session revocation.
3. Define a mutually authenticated agent protocol with certificate rotation, signed payloads, replay protection, and per-tenant enrollment tokens.
4. Build an isolated, signed-package automation runner with review, versioning, staged rollout, and kill switches.
5. Add distributed policy evaluation, maintenance-window scheduling, retry/idempotency semantics, outbound notification integrations, backups, observability, and security testing.
6. Commission threat modeling, penetration testing, dependency/SBOM controls, privacy review, and compliance retention policy before real endpoint use.
