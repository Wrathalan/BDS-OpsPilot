# OpsPilot installation paths

The included endpoint agent is a foreground live-test process. It does not create a service, scheduled task, launch daemon, startup item, or other persistence.

| Platform | Program path | Configuration/state path | Log behavior |
|---|---|---|---|
| Windows x64 executable | Any authorized local path; recommended `C:\Program Files\OpsPilot Agent\opspilot-agent-windows-x64.exe` | `C:\ProgramData\OpsPilot Agent\windows-agent.json`, with `%LOCALAPPDATA%\OpsPilot Agent` fallback | Foreground console output |
| Linux | `/opt/opspilot-agent` | `/var/lib/opspilot-agent/agent.json` | Foreground stdout/stderr |
| macOS | `/Library/Application Support/OpsPilot Agent` | `/Library/Application Support/OpsPilot Agent/agent.json` | Foreground stdout/stderr |
| Repository test | `<repo>\agent` | Pass `--data-dir <writable path>` | Foreground console output |

The native Windows configuration contains a DPAPI-protected agent credential bound to the Windows user who performed enrollment. The cross-platform Node configuration contains an agent credential and is created with owner-only permissions where POSIX modes are supported.

The Docker control plane uses `/app` for application files and `/data/opspilot.db` for persistent SQLite data. Compose stores `/data` in the named volume `opspilot-rmm-data`.

For a native Windows live test, issue a token in OpsPilot, download the executable from the token screen, and double-click it. The guided prompt requests the server URL and masks the enrollment token. A trusted terminal can use:

```powershell
.\opspilot-agent-windows-x64.exe enroll --server http://127.0.0.1:3000 --token <one-time-token>
.\opspilot-agent-windows-x64.exe once
.\opspilot-agent-windows-x64.exe run
```

Build the executable with `npm run agent:build:windows`. The artifact is written to `dist\windows-agent` and copied to `public\downloads` for the local control plane.

For the cross-platform repository agent:

```powershell
node agent/opspilot-agent.mjs enroll --server http://127.0.0.1:3000 --token <one-time-token> --data-dir .agent-data
node agent/opspilot-agent.mjs once --data-dir .agent-data
node agent/opspilot-agent.mjs run --data-dir .agent-data
```

Delete `.agent-data` or revoke the endpoint credential to decommission a test enrollment. Never commit `agent.json`.
