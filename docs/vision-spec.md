---
type: spec
domain: vision
status: design
version: 0.1.0
parent: null
tags:
  - watchdog/vision
  - watchdog/spec
---

> [!nav] Navigation
> **Domain Specs:** (none yet)

# Supabase Watchdog — Vision Specification

**Version:** 0.1.0
**Last Updated:** 2026-02-23
**Status:** Design

---

## 1. Problem

Supabase collects comprehensive error logs across all services — Edge Functions, Auth, Postgres, Storage, Realtime, and the API Gateway. These logs are visible in the Supabase Dashboard, but there's no way to receive alerts when errors occur without keeping the dashboard open.

Supabase's built-in solution, **Log Drains**, is only available on Team and Enterprise plans (starting at $599/month). For developers and startups on the Pro plan ($25/month), there is no native way to get notified about production errors.

This is a widely requested feature with no existing open-source solution.

## 2. Vision

**Supabase Watchdog** is a lightweight, open-source error monitoring and alerting tool for Supabase projects. It gives developers the same visibility as the Supabase Dashboard error console — delivered to their phone via Telegram, Discord, or Slack.

It is designed to be:

- **Zero-touch per project** — add a project ref to the config, done
- **Self-hostable** — runs on Deno Deploy (free), Cloudflare Workers, or Docker
- **Extensible** — plugin architecture that supports future AI-powered error analysis

### Core Principle

One deployment monitors all your Supabase projects. No SDK integration, no per-project code changes, no infrastructure to maintain.

---

## 3. How It Works

Supabase exposes a **Management API** that provides programmatic access to the same logs visible in the Dashboard. The endpoint `GET /v1/projects/{ref}/analytics/endpoints/logs.all` accepts SQL queries and supports all log sources.

Watchdog polls this endpoint at a configurable interval (default: 5 minutes), filters for error-level events, and forwards them to the configured notification channels.

```
┌──────────────┐     poll      ┌──────────────────┐    filter     ┌─────────────┐
│   Supabase   │ ◄──────────── │    Watchdog       │ ────────────► │  Processor  │
│ Management   │   every 5m    │   (Deno Deploy)   │               │ (passthrough│
│    API       │ ──────────── ►│                    │               │  or AI)     │
└──────────────┘   log data    └──────────────────┘               └──────┬──────┘
                                        ▲                                │
                                        │ /check                         │ alert
                                        │ /errors 30m                    ▼
                                ┌───────┴──────┐               ┌──────────────┐
                                │   Telegram   │ ◄──────────── │   Channel    │
                                │   Bot (cmd)  │               │  (Telegram)  │
                                └──────────────┘               └──────────────┘
```

### Management API Details

- **Authentication:** Personal Access Token (generated at supabase.com/dashboard/account/tokens)
- **Rate limit:** 120 requests/minute (shared across all Management API calls)
- **Query window:** Max 24 hours per request; defaults to last 1 minute if no timestamps provided
- **Log sources available:** `edge_logs`, `auth_logs`, `postgres_logs`, `storage_logs`, `realtime_logs`, `postgrest_logs`, `supavisor_logs`
- **Cost:** Free — the Management API is not metered or billed

---

## 4. MVP Scope (v0.1)

### Features

1. **Scheduled polling**
   - Configurable interval (default: 5 minutes)
   - Queries all configured log sources for errors (status >= 500, exception keywords, Postgres errors)
   - Deduplicates within a polling window to avoid spam

2. **Multi-project support**
   - Single config file lists all project refs
   - One Supabase access token monitors all projects in the same org

3. **Telegram notifications**
   - Formatted error alerts with: project name, service/source, error message, timestamp
   - Rate limiting to prevent message floods (configurable max messages per interval)

4. **On-demand queries via Telegram bot commands**
   - `/check` — immediately poll all projects and report errors
   - `/check <project>` — poll a specific project
   - `/errors <timeframe>` — retrieve errors from the last N minutes/hours (e.g., `/errors 30m`, `/errors 2h`)
   - `/status` — show monitoring status (last poll time, projects monitored, errors found)

5. **Simple configuration**

```yaml
# watchdog.config.yaml

supabase:
  access_token: "${SUPABASE_ACCESS_TOKEN}"

projects:
  - ref: "abcdefghijkl"
    name: "creoby-prod"
  - ref: "mnopqrstuvwx"
    name: "creoby-staging"
    severity: "critical"  # optional: only alert on critical errors

polling:
  interval: "5m"
  sources:
    - edge_logs
    - auth_logs
    - postgres_logs
    - storage_logs
    - realtime_logs
    - postgrest_logs

filters:
  min_status_code: 500
  ignore_patterns:
    - "healthcheck"
    - "favicon.ico"
  max_alerts_per_interval: 20  # prevent message floods

channels:
  telegram:
    bot_token: "${TELEGRAM_BOT_TOKEN}"
    chat_id: "${TELEGRAM_CHAT_ID}"
```

### Out of Scope for MVP

- Additional notification channels (Discord, Slack, WhatsApp, Email)
- AI-powered error analysis
- Web dashboard / UI
- Error aggregation and history storage
- Webhook / API for external integrations

---

## 5. Architecture

### Plugin-Based Design

The codebase is structured around three pluggable layers, each defined by a simple interface. Adding capabilities means adding a file, not restructuring the project.

```
supabase-watchdog/
├── main.ts                  # Entry point: cron setup, bot init, orchestration
├── config.ts                # Config loading and validation
├── types.ts                 # Shared types (ErrorEvent, Source, Processor, Channel)
│
├── sources/                 # WHERE errors come from
│   ├── mod.ts               # Source interface
│   └── supabase.ts          # Supabase Management API poller
│
├── processors/              # WHAT happens before notification
│   ├── mod.ts               # Processor interface
│   └── passthrough.ts       # MVP: forward as-is
│
├── channels/                # WHERE alerts go
│   ├── mod.ts               # Channel interface
│   └── telegram.ts          # Telegram bot (alerts + commands)
│
├── watchdog.config.yaml     # User configuration
├── deno.json                # Deno configuration
├── Dockerfile               # Docker deployment option
└── README.md
```

### Core Interfaces

```typescript
// types.ts

interface ErrorEvent {
  project: string;
  projectRef: string;
  source: string;           // e.g., "edge_logs", "auth_logs"
  timestamp: string;
  statusCode?: number;
  message: string;
  metadata?: Record<string, unknown>;
}

interface Source {
  name: string;
  poll(since: Date): Promise<ErrorEvent[]>;
}

interface Processor {
  name: string;
  process(events: ErrorEvent[]): Promise<ProcessedEvent[]>;
}

interface ProcessedEvent extends ErrorEvent {
  analysis?: string;        // Future: AI-generated analysis
  severity?: "info" | "warning" | "error" | "critical";
  suggestedAction?: string; // Future: AI-suggested fix
}

interface Channel {
  name: string;
  send(events: ProcessedEvent[]): Promise<void>;
  registerCommands?(): void; // Optional: for interactive channels like Telegram
}
```

### Data Flow

```
1. Cron triggers (every 5m)
     │
2. For each project:
     │── Source.poll(lastPollTime)
     │     └── Queries Management API for errors since last poll
     │
3. Deduplicate & filter
     │
4. Processor.process(events)
     │     └── MVP: passthrough
     │     └── Future: AI analysis, severity classification
     │
5. Channel.send(processedEvents)
           └── Format & send to Telegram
```

---

## 6. Deployment

### Option A: Deno Deploy (Recommended)

Zero-infrastructure deployment. Deno Deploy natively supports `Deno.cron()` for scheduled execution and handles HTTPS, scaling, and uptime automatically.

```bash
# Install Deno
curl -fsSL https://deno.land/install.sh | sh

# Clone and configure
git clone https://github.com/<org>/supabase-watchdog
cd supabase-watchdog
cp watchdog.config.example.yaml watchdog.config.yaml
# Edit config with your project refs and tokens

# Deploy
deployctl deploy --project=my-watchdog main.ts
```

**Free tier:** 1M requests/month, 100K KV operations — more than sufficient for monitoring dozens of projects.

### Option B: Docker (Self-hosted)

For developers who prefer full control or need to run in a private network.

```bash
docker run -d \
  -e SUPABASE_ACCESS_TOKEN=your_token \
  -e TELEGRAM_BOT_TOKEN=your_bot_token \
  -e TELEGRAM_CHAT_ID=your_chat_id \
  -v ./watchdog.config.yaml:/app/watchdog.config.yaml \
  ghcr.io/<org>/supabase-watchdog:latest
```

### Option C: Any Deno Runtime

The project is a standard Deno application with no platform-specific dependencies. It can run anywhere Deno runs — a VPS, a Raspberry Pi, or a CI/CD scheduled job.

---

## 7. Roadmap

### v0.2 — Additional Channels

- Discord webhook notifications
- Slack webhook notifications
- Generic webhook (for custom integrations)

### v0.3 — Smarts

- Error deduplication across polling intervals (don't alert on the same recurring error every 5 minutes)
- Error grouping (batch similar errors into a single alert)
- Configurable severity levels per source/project
- Simple error history via Deno KV or SQLite (for `/errors` lookups beyond last poll)

### v0.4 — AI-Powered Error Analysis

- **Processor plugin: AI analysis** — pass error context to an LLM (Claude API) for:
  - Root cause hypothesis
  - Severity classification
  - Suggested next steps
- Enriched Telegram messages with AI analysis summary
- Configurable: opt-in per project, choose model, set token budget

### v0.5 — Conversational Analytics

Transform the Telegram bot from a passive alerter into a **natural language analytics interface** for Supabase projects. Users ask questions in plain language; the AI layer translates them into SQL queries against the Management API logs, executes them, and returns human-readable answers.

**How it works:**

```
User message (natural language)
  │
  ▼
AI Layer: translates to SQL query against the appropriate log source
  │
  ▼
Source: executes query via Management API
  │
  ▼
AI Layer: summarizes results into a human-readable response
  │
  ▼
Telegram: sends formatted answer
```

**Example interactions:**

| User asks | Log source | What happens |
|---|---|---|
| "How many people used their account today?" | `auth_logs` | Counts unique auth events, breaks down logins vs. signups |
| "Which edge functions errored the most this week?" | `edge_logs` | Groups errors by function name, ranks by frequency |
| "Show me all failed login attempts in the last hour" | `auth_logs` | Filters for failed auth events, lists with timestamps |
| "What's the busiest time of day for creoby-prod?" | `edge_logs` | Aggregates request volume by hour, identifies peak |
| "How many storage uploads happened yesterday?" | `storage_logs` | Counts upload events within the time range |
| "Any slow queries in the last 24h?" | `postgres_logs` | Filters for long-running queries, shows duration and statement |

**Implementation notes:**

- The AI layer needs a schema reference for each log source (column names, event types) to generate accurate SQL
- Responses should include the raw numbers plus a brief contextual summary
- The 24-hour query window limit on the Management API applies — questions spanning longer periods require multiple queries or a cached history layer
- This reuses the same Source, Processor, and Channel plugin architecture; no new abstractions needed

### v0.6 — AI Agent Integration

- **Codebase-aware analysis** — connect to source repositories (via MCP or GitHub API) to correlate errors with actual code
- **Automated triage** — agent determines if an error is new, recurring, or a known issue
- **PR suggestions** — for well-understood errors, generate a fix and open a draft PR
- Integration with Claude Code and custom agent orchestrators

### Future Considerations

- Web dashboard for error history and analytics
- WhatsApp Business API channel
- Email digest (daily/weekly error summary)
- Uptime monitoring (synthetic health checks)
- Supabase Marketplace listing
- Support for self-hosted Supabase instances

---

## 8. Technical Constraints & Considerations

### Management API Limitations

- **Rate limit:** 120 req/min global. With 5-minute polling, even 20 projects only use 20 req/5min = 4 req/min — well within limits.
- **Query window:** Max 24h range per request. For the `/errors` command, requests beyond 24h would need to be split into multiple queries.
- **Experimental endpoint:** The logs endpoint is marked as experimental by Supabase and may change. The source plugin should abstract this to make adaptation easy.

### Telegram Bot Limits

- **Messages:** Max 30 messages/second to different chats, 20 messages/minute to the same group.
- **Message length:** Max 4096 characters per message. Long error details need to be truncated or split.
- **Mitigation:** Rate limiting and message batching in the Telegram channel plugin.

### Security

- The Supabase Access Token has full management access to all projects in the org. It should be stored as an environment variable / secret, never in the config file directly.
- The Telegram Bot Token should also be stored securely.
- The tool only reads logs — it never writes to or modifies any Supabase project.

---

## 9. Competitive Landscape

| Solution | Works on Pro? | Catches all Supabase logs? | Real-time alerts? | Cost |
|---|---|---|---|---|
| **Supabase Log Drains** | No (Team+ only) | Yes | Yes | $599+/mo for Team plan |
| **Sentry** | Yes | No (app-layer only, no DB/Auth/Storage) | Yes | Free tier available |
| **Grafana + Prometheus** | Yes | Metrics only, not log content | Yes | Self-hosted: free |
| **Supabase Watchdog** | **Yes** | **Yes** | **5-min delay** | **Free** |

The trade-off is clear: Watchdog doesn't provide sub-second alerting, but it's the only free solution that gives Pro-plan users full visibility into all Supabase service logs without per-project SDK integration.

---

## 10. Success Criteria

### MVP Launch

- Single-command deployment (Deno Deploy or Docker)
- < 5 minutes from clone to receiving first Telegram alert
- Monitors all Supabase log sources
- Telegram bot responds to `/check` within 10 seconds
- Clean, well-documented README with setup guide

### Traction (3 months post-launch)

- 100+ GitHub stars
- Active community contributions (additional channels, processors)
- Featured in Supabase community resources or "Made with Supabase"

---

## 11. Open Questions

| # | Question | Status | Resolution |
|---|----------|--------|------------|
| 1 | **Naming:** "Supabase Watchdog" is a working title. Alternatives: `supa-alert`, `supawatch`, `supamon`. Should the name reference Supabase directly, or be more generic to allow future expansion to other platforms? | Open | |
| 2 | **Monorepo vs. separate packages:** Should channel plugins eventually be separate npm/deno packages, or keep everything in one repo for simplicity? | Open | |
| 3 | **State persistence:** For deduplication and error history, should we use Deno KV (free on Deno Deploy), SQLite (for Docker), or keep it fully stateless in v0.1? | Open | |
| 4 | **License:** MIT for maximum adoption? Or something more opinionated? | Open | |
