# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Supabase Watchdog is a free, open-source error monitoring tool for Supabase projects. It polls the Supabase Management API for error logs across all services (Edge Functions, Auth, Postgres, Storage, Realtime, API Gateway, Supavisor) and sends alerts directly to Telegram (with Discord/Slack planned). Gives Supabase developers instant error notifications on their phone.

**Status:** v0.2 — control plane with dashboard, Deno KV persistence, webhook support, and one-click Deno Deploy.

## Tech Stack

- **Runtime:** Deno (uses `Deno.cron()` for scheduling, `Deno.openKv()` for persistence)
- **Language:** TypeScript
- **Deployment:** Deno Deploy (primary, one-click), Docker, or any Deno runtime
- **Configuration:** YAML (`watchdog.config.yaml`) for Docker/self-hosted, environment variables for Deno Deploy
- **State:** Deno KV (poll history, dedup, health status, daily stats)

## Architecture

Three-layer plugin pipeline: **Sources → Processors → Channels**

- **Sources** (`sources/`) — poll external APIs for errors. Supabase Management API.
- **Processors** (`processors/`) — transform/enrich error events before delivery. Currently passthrough.
- **Channels** (`channels/`) — deliver alerts to users. Telegram bot (alerts + interactive commands via polling or webhooks).

Core data flow: `Deno.cron() → pipeline.runPollCycle() → Source.poll() → Deduplicate (KV-backed) → Processor.process() → Channel.send() → State.log(KV)`

Two startup modes:
- **Setup mode** — no config found, serves setup page at `/` with env var checklist
- **Monitoring mode** — config valid, runs full pipeline + dashboard + Telegram bot

## Project Structure

```
main.ts                          # Thin entry point: config → mode detection → start services
src/
  config.ts                      # Config loading (YAML + env-var fallback) and validation
  types.ts                       # Shared interfaces and types
  logger.ts                      # Structured JSON logger
  state.ts                       # Deno KV state manager (polls, health, dedup, stats)
  pipeline.ts                    # Poll cycle orchestration, dedup, cron helpers
  server.ts                      # HTTP server (dashboard, /healthz, webhook route, auth)
  dashboard.html                 # Dashboard template (server-side rendered)
  sources/supabase.ts            # Management API poller (7 log sources)
  processors/passthrough.ts      # No-op processor
  channels/telegram.ts           # Telegram bot (alerts + commands, webhook + polling modes)
tests/                           # All test files (*_test.ts)
```

## Commands

```bash
deno task dev        # Run with watch mode
deno task start      # Run in production
deno task test       # Run tests
deno task deploy     # Deploy to Deno Deploy
```

## Documentation System

Documentation lives in `docs/` as an Obsidian vault with wikilink navigation. Use the `/doc` skill to create and manage documents.

## Technical Constraints

- **Supabase Management API:** 120 req/min rate limit (org-wide), max 24h query window, endpoint is experimental
- **Telegram:** 30 msg/sec to different chats, 20 msg/min to same group, 4096 char message limit
- **Deno Deploy:** Free tier 1M req/mo, 100K KV ops/mo. Deno.cron() is stable. Long-polling does NOT work (use webhooks).
- **Security:** Supabase access token has full org management access — must be env var, never in config. Tool is read-only.

## Environment Variables

### Required (for env-var config path)
```
SUPABASE_ACCESS_TOKEN   # From supabase.com/dashboard/account/tokens
TELEGRAM_BOT_TOKEN      # Telegram bot token
TELEGRAM_CHAT_ID        # Target chat/group ID
WATCHDOG_PROJECTS       # Comma-separated ref:name pairs, e.g. "abc123:my-app,def456:staging"
```

### Optional
```
WATCHDOG_TELEGRAM_MODE  # "webhook" or "polling" (default: polling)
WATCHDOG_BASE_URL       # Public URL for webhook mode (e.g. https://your-app.deno.dev)
WATCHDOG_DASHBOARD_TOKEN # Optional token to protect the dashboard
WATCHDOG_INTERVAL       # Polling interval (default: 5m)
WATCHDOG_SOURCES        # Comma-separated log sources (default: all 7)
WATCHDOG_MIN_STATUS     # Minimum HTTP status code (default: 500)
WATCHDOG_IGNORE_PATTERNS # Comma-separated ignore patterns
WATCHDOG_MAX_ALERTS     # Max alerts per interval (default: 20)
```

## Design System

See `DESIGN.md` for the full design system (colors, typography, spacing, responsive breakpoints, a11y specs).
