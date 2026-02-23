---
type: moc
tags:
  - watchdog/moc
---

# Supabase Watchdog Documentation

## Vision

[[vision-spec|Watchdog Vision Spec]] — Lightweight error monitoring & alerting for Supabase projects via Management API polling. Telegram, Discord, Slack notifications. (v0.1.0)

---

## Data Flow

```
Supabase Management API (polling, configurable interval)
  → Watchdog Core:
      Source.poll() → Deduplicate & filter → Processor.process() → Channel.send()
  → Channels: Telegram bot (alerts + commands), Discord, Slack (future)
  → Processors: Passthrough (MVP), AI analysis (future)
```
