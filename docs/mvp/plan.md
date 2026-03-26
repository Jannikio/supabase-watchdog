---
type: plan
domain: mvp
status: done
parent: "[[mvp/spec]]"
tags:
  - watchdog/mvp
  - watchdog/plan
---

> [!nav] Navigation
> **Parent:** [[mvp/spec|MVP Spec]]
> **Phases:**
> 1. [[mvp/phases/phase-1-foundation|Phase 1: Foundation & Config]]
> 2. [[mvp/phases/phase-2-supabase-source|Phase 2: Supabase Source]]
> 3. [[mvp/phases/phase-3-telegram-channel|Phase 3: Telegram Channel]]
> 4. [[mvp/phases/phase-4-orchestration|Phase 4: Orchestration]]
> 5. [[mvp/phases/phase-5-bot-commands|Phase 5: Bot Commands]]
> 6. [[mvp/phases/phase-6-deployment|Phase 6: Deployment & Docs]]
> **Dependency graph:** 1 → 2 → 4, 1 → 3 → 4 → 5, 4 → 6
> **Addendums:**
> - [[mvp/addendums/error-context-enrichment|Error Context Enrichment]]

# Watchdog — MVP: Implementation Plan

**Version:** 0.1.0
**Last Updated:** 2026-02-23
**Status:** Planning
**Parent:** [[mvp/spec|MVP Spec]]

---

## Context

```
vision-spec (root)
  └── mvp/spec (this plan's parent)
        └── mvp/plan (this document)
              ├── Phase 1: Foundation & Config
              ├── Phase 2: Supabase Source
              ├── Phase 3: Telegram Channel
              ├── Phase 4: Orchestration
              ├── Phase 5: Bot Commands
              └── Phase 6: Deployment & Docs
```

This plan breaks the [[mvp/spec|MVP Spec]] into six sequential phases that build the first working version of Supabase Watchdog. Each phase produces a testable deliverable. The plan follows the spec's three-layer plugin architecture (Sources → Processors → Channels) and establishes the codebase patterns that all future domains will inherit.

Phases 2 and 3 can be built in parallel since both depend only on Phase 1. Phase 4 wires them together into the running pipeline. Phase 5 adds interactive Telegram commands on top. Phase 6 wraps up with deployment artifacts and documentation.

### What This Plan Does NOT Cover

- Additional notification channels (Discord, Slack, webhooks) — **channels** domain
- Error grouping, severity classification, cross-window deduplication, history storage — **smarts** domain
- AI-powered error analysis — **ai-analysis** domain
- Natural language log queries — **conversational** domain
- Codebase-aware triage and auto-fix PRs — **agent-integration** domain
- Web dashboard or UI of any kind

---

## Phase Overview

```
Phase 1: Foundation & Config
  │       deno.json, types.ts, config.ts — project skeleton, interfaces, YAML config loading
  │
  ├───────────────────┐
  │                   │
  ▼                   ▼
Phase 2:            Phase 3:
Supabase Source     Telegram Channel
  │  sources/         │  channels/, processors/
  │  Management API   │  Alert formatting, passthrough processor
  │                   │
  ├───────────────────┘
  │
  ▼
Phase 4: Orchestration
  │       main.ts — cron scheduling, pipeline wiring, deduplication
  │
  ▼
Phase 5: Bot Commands
  │       /check, /errors, /status — interactive Telegram commands
  │
  ▼
Phase 6: Deployment & Docs
          Dockerfile, deno.json tasks, example config, README
```

---

## Phase 1: Foundation & Config

**Deliverables:**

- `deno.json` — Deno configuration with imports map (YAML parser, Telegram library)
- `types.ts` — All core interfaces: `ErrorEvent`, `Source`, `Processor`, `ProcessedEvent`, `Channel`, config types
- `config.ts` — YAML config loading from `watchdog.config.yaml`, `${ENV_VAR}` interpolation, validation (required fields, ref format, interval parsing)
- `watchdog.config.example.yaml` — Example configuration file with comments

**Depends on:** None (foundation phase).

---

## Phase 2: Supabase Source

**Deliverables:**

- `sources/mod.ts` — `Source` interface export and source registry
- `sources/supabase.ts` — Management API poller:
  - Queries `GET /v1/projects/{ref}/analytics/endpoints/logs.all` for each project × log source
  - Filters results by error detection rules (status >= 500, exception keywords, Postgres severity)
  - Maps API responses to `ErrorEvent[]`
  - Respects 120 req/min rate limit (awareness, not active throttling in MVP)

**Depends on:** Phase 1 (types and config).

---

## Phase 3: Telegram Channel

**Deliverables:**

- `channels/mod.ts` — `Channel` interface export and channel registry
- `channels/telegram.ts` — Telegram alert sender:
  - Formats `ProcessedEvent[]` into readable Telegram messages (project, source, message, timestamp, status code)
  - Respects 4096-char message limit (truncation)
  - Respects `max_alerts_per_interval` cap
  - Rate-aware sending (20 msg/min to same group)
- `processors/mod.ts` — `Processor` interface export and processor registry
- `processors/passthrough.ts` — Passthrough processor (returns events as-is with `ProcessedEvent` type)

**Depends on:** Phase 1 (types and config).

---

## Phase 4: Orchestration

**Deliverables:**

- `main.ts` — Entry point that wires everything together:
  - Loads config via `config.ts`
  - Initializes source, processor, and channel instances
  - Sets up `Deno.cron()` at the configured polling interval
  - Implements the core pipeline: `Source.poll()` → deduplicate → `Processor.process()` → `Channel.send()`
  - Tracks `lastPollTime` per project for polling windows
  - Deduplicates within a polling window by hashing `(projectRef, source, message)`
  - Logs pipeline activity to console

**Depends on:** Phase 2 (source) and Phase 3 (channel + processor).

---

## Phase 5: Bot Commands

**Deliverables:**

- Extend `channels/telegram.ts` with Telegram bot command handling:
  - `/check` — immediately trigger a full poll cycle, report results
  - `/check <project>` — poll a specific project by name or ref
  - `/errors <timeframe>` — query Management API for errors in the last N minutes/hours (e.g., `30m`, `2h`)
  - `/status` — report monitoring status: last poll time, projects count, errors in last poll
- Bot initialization in `main.ts` (register commands on startup)

**Depends on:** Phase 4 (working pipeline to trigger on-demand).

---

## Phase 6: Deployment & Docs

**Deliverables:**

- `Dockerfile` — Multi-stage build for self-hosted Docker deployment
- `deno.json` tasks — `dev` (local run), `start` (production), `deploy` (Deno Deploy)
- `watchdog.config.example.yaml` — Finalized with all options documented in comments
- `README.md` — Setup guide: prerequisites, configuration, deployment (Deno Deploy + Docker), bot commands, FAQ
- `.env.example` — Template for required environment variables

**Depends on:** Phase 4 (complete working system to document).

---

## Dependency Graph

`1 → 2 → 4 → 5 → 6` (critical path)
`1 → 3 → 4` (parallel with Phase 2)

Phases 2 and 3 are independent and can be built in parallel after Phase 1. Phase 4 is the integration point requiring both. Phase 5 extends Phase 4. Phase 6 wraps everything up.
