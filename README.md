# Supabase Watchdog

Free, open-source error monitoring for Supabase projects. Get Telegram alerts on your phone when something breaks across Edge Functions, Auth, Postgres, Storage, Realtime, or any other Supabase service. Includes a status dashboard and one-click deploy.

[![Deploy on Deno](https://deno.com/button)](https://console.deno.com/new?clone=https://github.com/HumanMaschine/supabase-watchdog)

## Features

- Monitors all 7 Supabase log sources: Edge Functions, Auth, Postgres, Storage, Realtime, API Gateway, Supavisor
- Status dashboard with health matrix, poll history, and daily stats
- `/healthz` JSON endpoint for external monitoring
- Telegram alerts with HTML formatting and rate limiting
- Interactive bot commands (`/check`, `/errors`, `/status`, `/help`)
- Cross-restart deduplication via Deno KV persistence
- Telegram webhook support for Deno Deploy (explicit via `WATCHDOG_TELEGRAM_MODE`)
- Two config paths: YAML for Docker, environment variables for Deno Deploy
- One-click deploy to Deno Deploy with guided setup page
- Optional dashboard authentication
- Dark mode (follows OS preference)

## Quick Start — Deno Deploy (Recommended)

1. Click the **Deploy on Deno** button above
2. If prompted, connect your GitHub account and grant Deno Deploy access to your repositories
3. In your project settings, go to **KV** and create a database (required for dashboard data and dedup)
4. The app starts and shows a setup page at your deploy URL
5. Add environment variables in the Deno Deploy dashboard:
   - `SUPABASE_ACCESS_TOKEN` — [get it here](https://supabase.com/dashboard/account/tokens)
   - `TELEGRAM_BOT_TOKEN` — [create via @BotFather](https://t.me/BotFather)
   - `TELEGRAM_CHAT_ID` — [find via @userinfobot](https://t.me/userinfobot)
   - `WATCHDOG_PROJECTS` — format: `ref:name,ref:name` (find your ref in the Supabase dashboard URL)
   - `WATCHDOG_TELEGRAM_MODE` — set to `webhook`
   - `WATCHDOG_BASE_URL` — your deploy URL (e.g. `https://your-app.deno.dev`)
6. The app restarts automatically and begins monitoring

## Quick Start — Docker / Local

1. **Clone and configure**
   ```bash
   git clone https://github.com/HumanMaschine/supabase-watchdog
   cd supabase-watchdog
   cp watchdog.config.example.yaml watchdog.config.yaml
   # Edit watchdog.config.yaml with your project refs
   ```

2. **Set environment variables**
   ```bash
   export SUPABASE_ACCESS_TOKEN="sbp_your_token"
   export TELEGRAM_BOT_TOKEN="your_bot_token"
   export TELEGRAM_CHAT_ID="your_chat_id"
   ```

3. **Run**
   ```bash
   deno task start
   ```

   The dashboard is available at `http://localhost:8000`. Telegram bot uses long-polling by default.

## Dashboard

The dashboard is served at `/` and shows the current state of your monitoring:

- **Status banner** — Healthy (green), Late (yellow), or Down (red)
- **Stat cards** — polls in the last 24h, errors found, alerts sent, project count
- **Health matrix** — green/red dot per project per log source
- **Recent polls** — last 20 poll cycles with timing and results

### Health States

| State | Meaning |
|-------|---------|
| **Healthy** | Last poll succeeded within 2x the configured interval |
| **Late** | Last poll exceeded 2x the interval, or last poll failed |
| **Down** | 3+ consecutive failures, or no poll in 5x the interval |

### `/healthz` Endpoint

Returns JSON with the current health status. Always accessible (not gated by dashboard auth).

```json
{
  "status": "healthy",
  "configured": true,
  "last_poll": { "timestamp": "2026-03-30T10:00:00Z", "ok": true },
  "uptime_since": "2026-03-30T08:00:00Z",
  "projects": 2,
  "daily_stats": { "polls": 120, "errors_found": 5, "alerts_sent": 3 }
}
```

When unconfigured (setup mode), returns `{ "status": "setup_required", "configured": false }`.

### Dashboard Authentication

Set `WATCHDOG_DASHBOARD_TOKEN` to require a token for dashboard access. Pass it as `?token=...` in the URL or via `Authorization: Bearer ...` header. `/healthz` and `/telegram-webhook` are always accessible without a token.

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `SUPABASE_ACCESS_TOKEN` | Personal access token from [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) |
| `TELEGRAM_BOT_TOKEN` | Bot token from [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_CHAT_ID` | Target chat or group ID. Use [@userinfobot](https://t.me/userinfobot) to find yours |
| `WATCHDOG_PROJECTS` | Comma-separated `ref:name` pairs, e.g. `abc123def456:my-app,xyz789ghi012:staging`. Only needed if not using YAML config. |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `WATCHDOG_TELEGRAM_MODE` | `polling` | `webhook` for Deno Deploy, `polling` for Docker/local |
| `WATCHDOG_BASE_URL` | — | Public URL for webhook mode (e.g. `https://your-app.deno.dev`). Required when mode is `webhook`. |
| `WATCHDOG_DASHBOARD_TOKEN` | — | If set, dashboard requires this token for access |
| `WATCHDOG_INTERVAL` | `5m` | Polling interval (e.g. `5m`, `1h`, `2h30m`) |
| `WATCHDOG_SOURCES` | all 7 | Comma-separated log sources to monitor |
| `WATCHDOG_MIN_STATUS` | `500` | Minimum HTTP status code to treat as error |
| `WATCHDOG_IGNORE_PATTERNS` | — | Comma-separated patterns to ignore (substring match) |
| `WATCHDOG_MAX_ALERTS` | `20` | Max alerts per poll cycle |

## Bot Commands

| Command | Description | Example |
|---------|-------------|---------|
| `/check` | Poll all projects for errors now | `/check` |
| `/check <project>` | Poll a specific project by name or ref | `/check my-app-prod` |
| `/errors <timeframe>` | Show errors from last N minutes/hours | `/errors 30m`, `/errors 2h` |
| `/status` | Show monitoring status | `/status` |
| `/help` | List available commands | `/help` |

## Configuration

### YAML Config (Docker / Local)

For Docker and local deployments, configuration lives in `watchdog.config.yaml`. Environment variables are referenced with `${VAR_NAME}` syntax and resolved at startup.

```bash
cp watchdog.config.example.yaml watchdog.config.yaml
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `supabase.access_token` | string (env ref) | **required** | Supabase personal access token |
| `projects[].ref` | string | **required** | 12+ char project reference ID |
| `projects[].name` | string | **required** | Human-readable project name |
| `polling.interval` | duration | `"5m"` | Polling frequency |
| `polling.sources` | string[] | all 7 | Which log sources to query |
| `filters.min_status_code` | number | `500` | Minimum HTTP status code for errors |
| `filters.ignore_patterns` | string[] | `[]` | Patterns to exclude |
| `filters.max_alerts_per_interval` | number | `20` | Max alerts per poll cycle |
| `channels.telegram.bot_token` | string (env ref) | **required** | Telegram bot token |
| `channels.telegram.chat_id` | string (env ref) | **required** | Target chat/group ID |

### Webhook Mode (Deno Deploy)

Deno Deploy does not support long-polling. Set these env vars for webhook-based bot commands:

```
WATCHDOG_TELEGRAM_MODE=webhook
WATCHDOG_BASE_URL=https://your-app.deno.dev
```

The app registers a webhook with Telegram on startup and receives bot commands via `POST /telegram-webhook`. Webhook requests are verified using a secret derived from your bot token.

When switching from webhook to polling mode (or vice versa), the app automatically cleans up the previous transport on startup.

### Available Log Sources

- `edge_logs` — Edge Functions
- `auth_logs` — Authentication (GoTrue)
- `postgres_logs` — PostgreSQL
- `storage_logs` — Storage
- `realtime_logs` — Realtime
- `postgrest_logs` — PostgREST (API Gateway)
- `supavisor_logs` — Supavisor (connection pooler)

## Architecture

```
                    ┌─── SETUP MODE: serve setup page at /
                    │
main.ts → src/config → ─┤
                    │
                    └─── MONITORING MODE:
                         ├── Deno.cron() → pipeline.runPollCycle()
                         │     Source.poll() → Dedup (KV) → Process → Send → Log (KV)
                         ├── HTTP server: / (dashboard), /healthz, /telegram-webhook
                         └── Telegram bot (webhook or long-polling)
```

- **Sources** (`src/sources/`) — poll external APIs for errors. Currently: Supabase Management API.
- **Processors** (`src/processors/`) — transform/enrich error events. Currently: passthrough.
- **Channels** (`src/channels/`) — deliver alerts. Telegram (alerts + interactive bot commands).
- **State** (`src/state.ts`) — Deno KV persistence for poll history, dedup, health status, daily stats.

## Updating

### Deno Deploy (one-click deploy)

The deploy button clones the repo to your GitHub account. When a new version is released, pull the latest changes:

```bash
# First time: add the upstream remote
git clone https://github.com/<your-username>/supabase-watchdog
cd supabase-watchdog
git remote add upstream https://github.com/HumanMaschine/supabase-watchdog.git

# To update:
git fetch upstream
git merge upstream/main
git push origin main
```

Deno Deploy auto-redeploys when your repo's main branch updates. Your environment variables and KV data are preserved.

### Docker

Pull the latest code and rebuild:

```bash
git pull
docker build -t supabase-watchdog .
docker compose up -d
```

## Advanced Deployment

### Deno Deploy via CLI

If you prefer manual deploys over the one-click button:

```bash
deno install -gArf jsr:@deno/deployctl
deployctl deploy --prod main.ts
```

Set environment variables in the [Deno Deploy dashboard](https://dash.deno.com/) under your project settings.

### Docker

```bash
docker build -t supabase-watchdog .

docker run -d \
  --name watchdog \
  -e SUPABASE_ACCESS_TOKEN=sbp_... \
  -e TELEGRAM_BOT_TOKEN=123456:ABC... \
  -e TELEGRAM_CHAT_ID=-100... \
  -v ./watchdog.config.yaml:/app/watchdog.config.yaml:ro \
  -v watchdog-data:/app/.deno-kv \
  supabase-watchdog
```

### Docker Compose

```yaml
services:
  watchdog:
    build: .
    restart: unless-stopped
    environment:
      - SUPABASE_ACCESS_TOKEN=sbp_...
      - TELEGRAM_BOT_TOKEN=123456:ABC...
      - TELEGRAM_CHAT_ID=-100...
    volumes:
      - ./watchdog.config.yaml:/app/watchdog.config.yaml:ro
      - watchdog-data:/app/.deno-kv

volumes:
  watchdog-data:
```

> **Note:** The `watchdog-data` volume persists poll history, dedup state, and health status across container restarts. Without it, KV data resets on every restart.

### Development

```bash
deno task dev    # Watch mode — restarts on file changes
deno task test   # Run all tests
```

## Troubleshooting

**Bot not receiving messages / commands not working**
- Make sure you sent a message to the bot first (or added it to the group) before checking `getUpdates`
- Verify `TELEGRAM_CHAT_ID` matches the chat where you're sending commands
- If using a group, make sure the bot has permission to read messages (disable privacy mode via BotFather: `/setprivacy` → Disable)
- On Deno Deploy, ensure `WATCHDOG_TELEGRAM_MODE=webhook` and `WATCHDOG_BASE_URL` are set

**"environment variable is not set" error on startup**
- Ensure required env vars are exported: `SUPABASE_ACCESS_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and `WATCHDOG_PROJECTS` (if not using YAML config)
- If using Docker, pass them with `-e` flags or in your compose file

**No alerts received but no errors either**
- Run `/check` in Telegram to trigger an immediate poll
- Check that your `projects[].ref` matches your actual Supabase project ref (12+ alphanumeric chars from the dashboard URL)
- Lower `filters.min_status_code` temporarily (e.g., to `400`) to catch more events

**Rate limit errors from Supabase API**
- The Management API allows 120 requests per minute (org-wide). If you monitor many projects, increase `polling.interval`
- Each project queries multiple log sources per poll cycle

## Limitations

- **5-minute default polling delay** — not real-time monitoring. Adjust `polling.interval` as needed (minimum 1 minute).
- **24-hour max query window** — the Supabase Management API only returns logs from the last 24 hours.
- **120 req/min rate limit** — shared across all Management API consumers in your org.
- **Telegram only** — v0.2 supports Telegram as the sole notification channel. Discord, Slack, and webhooks are planned for v0.3.

## License

TBD
