---
type: moc
tags:
  - watchdog/moc
---

# Supabase Watchdog Documentation

## Vision

[[vision-spec|Watchdog Vision Spec]] — Lightweight error monitoring & alerting for Supabase projects via Management API polling. Telegram, Discord, Slack notifications. (v0.1.0)

---

## Domains

### MVP (v0.1)

[[mvp/spec|MVP Spec]] — Scheduled polling, multi-project support, Telegram notifications and bot commands, YAML configuration. (v0.1.0, Design)
[[mvp/plan|MVP Plan]] — 6 phases: Foundation → Supabase Source / Telegram Channel → Orchestration → Bot Commands → Deployment
- [[mvp/phases/phase-1-foundation|Phase 1: Foundation & Config]] — deno.json, types.ts, config.ts, example config
- [[mvp/phases/phase-2-supabase-source|Phase 2: Supabase Source]] — Management API poller, error SQL queries, response parsing
- [[mvp/phases/phase-3-telegram-channel|Phase 3: Telegram Channel]] — Telegram alert sender, passthrough processor, HTML formatting
- [[mvp/phases/phase-4-orchestration|Phase 4: Orchestration]] — main.ts entry point, cron scheduling, deduplication, pipeline wiring
- [[mvp/phases/phase-5-bot-commands|Phase 5: Bot Commands]] — /check, /errors, /status, Telegram getUpdates polling
- [[mvp/phases/phase-6-deployment|Phase 6: Deployment & Docs]] — Dockerfile, README, .env.example, deploy task
- [[mvp/addendums/error-context-enrichment|Addendum: Error Context Enrichment]] — Surface source-specific metadata (query, origin, severity) in alert messages

---

## Data Flow

```
Supabase Management API (polling, configurable interval)
  → Watchdog Core:
      Source.poll() → Deduplicate & filter → Processor.process() → Channel.send()
  → Channels: Telegram bot (alerts + commands), Discord, Slack (future)
  → Processors: Passthrough (MVP), AI analysis (future)
```
