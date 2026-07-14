# OpsPilot installation paths

The included endpoint agent is a foreground live-test process. It does not create a service, scheduled task, launch daemon, startup item, or other persistence.

| Platform | Program path | Configuration/state path | Log behavior |
|---|---|---|---|
| Windows | `C:\Program Files\OpsPilot Agent` | `C:\ProgramData\OpsPilot\agent.json` | Foreground console output |
| Linux | `/opt/opspilot-agent` | `/var/lib/opspilot-agent/agent.json` | Foreground stdout/stderr |
| macOS | `/Library/Application Support/OpsPilot Agent` | `/Library/Application Support/OpsPilot Agent/agent.json` | Foreground stdout/stderr |
| Repository test | `<repo>\agent` | Pass `--data-dir <writable path>` | Foreground console output |

The configuration file contains an agent credential and is created with owner-only permissions where the platform supports POSIX modes. Restrict the Windows directory ACL to Administrators and SYSTEM before broader deployment.

The Docker control plane uses `/app` for application files and `/data/opspilot.db` for persistent SQLite data. Compose stores `/data` in the named volume `opspilot-rmm-data`.

For the first repository-local live test:

```powershell
node agent/opspilot-agent.mjs enroll --server http://127.0.0.1:3000 --token <one-time-token> --data-dir .agent-data
node agent/opspilot-agent.mjs once --data-dir .agent-data
node agent/opspilot-agent.mjs run --data-dir .agent-data
```

Delete `.agent-data` or revoke the endpoint credential to decommission a test enrollment. Never commit `agent.json`.
