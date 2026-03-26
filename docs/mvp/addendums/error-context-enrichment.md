---
type: addendum
domain: mvp
status: done
parent: "[[mvp/plan]]"
tags:
  - watchdog/mvp
  - watchdog/addendum
---

> [!nav] Navigation
> **Parent:** [[mvp/plan|MVP Plan]]
> **Spec:** [[mvp/spec|MVP Spec]]
> **Extends:** [[mvp/phases/phase-2-supabase-source|Phase 2: Supabase Source]], [[mvp/phases/phase-3-telegram-channel|Phase 3: Telegram Channel]]

# Watchdog — Error Context Enrichment

Alert messages currently show only a raw error string, the log source name (e.g. `postgres_logs`), and a timestamp. For many errors — especially from Postgres — this is not enough to understand **where** the error originated or **what** triggered it. This addendum proposes enriching both the data we fetch and the way we render it so that every alert carries actionable context.

Identified after running the MVP against a live project (`member_management_development`), where Postgres errors like `invalid input syntax for type uuid: "..."` appeared repeatedly with no indication of which function, trigger, or query caused them.

---

## 1. Source-Specific Metadata Is Fetched but Discarded

**Identified during:** Live testing of MVP (Phase 2 + Phase 3)
**Affects:** [[mvp/phases/phase-2-supabase-source|Phase 2]], [[mvp/phases/phase-3-telegram-channel|Phase 3]]

### Problem

The `postgres_logs` SQL query already fetches useful fields:

| Field | What it tells you | Currently shown? |
|-------|-------------------|------------------|
| `error_severity` | ERROR / FATAL / PANIC | No (buried in `metadata`) |
| `sql_state_code` | Postgres error code, e.g. `22P02` | No |
| `query` | The SQL statement that failed | No (used only as message fallback) |
| `user_name` | DB role, e.g. `authenticator`, `supabase_admin` | No |

These fields land in `event.metadata` via the `...rest` spread in `rowToEvent()` (`sources/supabase.ts:242-247`), but `formatEvent()` in `channels/telegram.ts:385-421` **never reads `metadata`** — it only renders `project`, `source`, `statusCode`, `timestamp`, and `message`.

The result is alerts like this:

```
Error in member_management_development

Source: postgres_logs
Time: 2026-03-18T15:37:03.448Z

invalid input syntax for type uuid: "f11ccb87-..."
```

The user cannot tell:
- Whether the error came from a trigger, a database function, a PostgREST call, or a migration.
- Which SQL statement caused it.
- What Postgres role was running it (which hints at the calling service).
- How severe it is (ERROR vs FATAL vs PANIC).

The same problem applies to other log sources. Edge function errors don't show the HTTP method or path. Auth errors don't show the auth endpoint path.

### Proposed Solution

Two changes, both scoped narrowly:

#### A. Enrich SQL queries with additional context fields

Add fields that identify the **origin** of an error. These are available in the Supabase log metadata but not currently queried:

**`postgres_logs`** — add `application_name`, `hint`, `detail`:

```sql
select
  t.timestamp,
  t.event_message,
  p.error_severity as error_severity,
  p.sql_state_code as sql_state_code,
  p.query as query,
  p.detail as detail,
  p.hint as hint,
  p.user_name as user_name,
  p.application_name as application_name
from postgres_logs t
  cross join unnest(t.metadata) as m
  cross join unnest(m.parsed) as p
where regexp_contains(p.error_severity, 'ERROR|FATAL|PANIC')
order by t.timestamp desc
limit 200
```

`application_name` is particularly valuable — it reveals the calling service:
- `PostgREST` = API/client call via PostgREST
- `realtime` = Realtime subscription trigger
- `supabase_admin` = Dashboard or migration
- `pgsql-http` / custom names = Edge Functions or triggers

`detail` and `hint` often contain Postgres's own suggestions for fixing the error.

**No changes needed for other sources** — they already fetch the useful fields (`method`/`path` for edge, `path`/`msg` for auth). Those fields just need to be rendered (part B).

#### B. Make `formatEvent()` source-aware

Replace the one-size-fits-all formatter with source-specific rendering that surfaces the most relevant metadata fields per log type:

**`postgres_logs` alert:**
```
Error in member_management_development

Source: postgres_logs
Severity: ERROR (22P02)
Origin: PostgREST (authenticator)
Time: 2026-03-18T15:37:03.448Z

invalid input syntax for type uuid: "f11ccb87-..."

Query: select * from members where id = $1
Hint: ...
```

**`edge_logs` alert:**
```
Error in member_management_development

Source: edge_logs
Status: 500
Endpoint: POST /api/members
Time: 2026-03-18T15:37:03.448Z

Internal Server Error
```

**`auth_logs` alert:**
```
Error in member_management_development

Source: auth_logs
Level: error
Path: /token
Time: 2026-03-18T15:37:03.448Z

invalid grant: user not found
```

The implementation approach:
1. Define a `MetadataRenderers` map in `channels/telegram.ts` keyed by log source name.
2. Each renderer receives `event.metadata` and returns an array of formatted lines to insert between the header and the error message.
3. The existing `formatEvent()` calls the renderer for the event's source. If no renderer exists (unknown source), fall back to the current behavior.

This keeps changes contained to two files (`sources/supabase.ts` for the query, `channels/telegram.ts` for rendering) and doesn't touch the `ErrorEvent` interface, config, or any other module.

### Scope

**Changes:**
- `sources/supabase.ts` — Add `application_name`, `detail`, `hint` to the `postgres_logs` SQL query
- `channels/telegram.ts` — Rewrite `formatEvent()` to render source-specific metadata context lines
- No interface changes — `metadata: Record<string, unknown>` already carries everything

**Does NOT change:**
- `ErrorEvent` / `ProcessedEvent` interfaces
- Config schema or `watchdog.config.yaml`
- Deduplication logic
- Bot commands
- Other log source SQL queries (they already fetch the needed fields)
- Processor pipeline (this is purely source + channel)
