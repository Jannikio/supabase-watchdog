# TODOS

## P3 — Dynamic README health badge
**What:** `/badge` endpoint returning SVG showing watchdog status (healthy/late/down/setup_required).
**Why:** Cool show-off factor for open-source projects. Users embed in their project READMEs.
**Context:** Dashboard already shows status. Badge is a vanity feature — fun but not essential. Deferred from v0.2 cherry-pick ceremony.
**Effort:** S (human: ~2 hours / CC: ~5 min)
**Depends on:** v0.2 (HTTP server + health state machine)
