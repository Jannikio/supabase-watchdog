---
name: doc
description: Manage the Watchdog documentation vault (docs/). Create new specs, plans, phase briefs, or addendums. Also covers when to update existing docs vs. create new ones, and how to import externally created files.
argument-hint: <type> <domain> [phase-number] [short-name]
allowed-tools: Write, Edit, Read, Glob
---

# Watchdog Documentation Vault

Manage documents in the `docs/` Obsidian vault. Use this skill to create new files, integrate externally created files, or determine how to handle changes to existing documentation.

## Parse Arguments

`$ARGUMENTS` should be in the form: `<type> <domain> [phase-number] [short-name]`

- **type**: `spec`, `plan`, `phase`, or `addendum`
- **domain**: a domain name (e.g., `mvp`, `channels`, `smarts`, `ai-analysis`)
- **phase-number**: required for `phase` type (e.g., `3`)
- **short-name**: a kebab-case slug (e.g., `telegram-channel`). Required for `phase` and `addendum`. For `spec` and `plan`, the filename is fixed.

Examples:
- `/doc spec mvp` — creates `docs/mvp/spec.md`
- `/doc plan mvp` — creates `docs/mvp/plan.md`
- `/doc phase mvp 3 config-validation` — creates `docs/mvp/phases/phase-3-config-validation.md`
- `/doc addendum mvp rate-limiting` — creates `docs/mvp/addendums/rate-limiting.md`

## Vault Structure

```
docs/
├── _index.md                        (Map of Content)
├── vision-spec.md                   (Root vision document)
├── <domain>/
│   ├── spec.md                      (Domain specification)
│   ├── plan.md                      (Implementation plan)
│   ├── phases/
│   │   └── phase-N-short-name.md    (Phase implementation briefs)
│   └── addendums/
│       └── descriptive-name.md      (Addendum documents)
```

## File Placement

| Type | Path |
|------|------|
| `spec` | `docs/<domain>/spec.md` |
| `plan` | `docs/<domain>/plan.md` |
| `phase` | `docs/<domain>/phases/phase-<N>-<short-name>.md` |
| `addendum` | `docs/<domain>/addendums/<short-name>.md` |

## Frontmatter Schema

Every file gets YAML frontmatter at the top:

### Spec
```yaml
---
type: spec
domain: <domain>
status: design
parent: "[[vision-spec]]"
tags:
  - watchdog/<domain>
  - watchdog/spec
---
```

### Plan
```yaml
---
type: plan
domain: <domain>
status: planning
parent: "[[<domain>/spec]]"
tags:
  - watchdog/<domain>
  - watchdog/plan
---
```

### Phase
```yaml
---
type: phase
domain: <domain>
phase: <N>
status: planning
parent: "[[<domain>/plan]]"
depends_on:                          # include if this phase has prerequisites
  - "[[<domain>/phases/phase-X-...]]"
tags:
  - watchdog/<domain>
  - watchdog/phase
---
```

### Addendum
```yaml
---
type: addendum
domain: <domain>
status: planning
parent: "[[<domain>/plan]]"
tags:
  - watchdog/<domain>
  - watchdog/addendum
---
```

If the addendum is an implementation brief of another addendum, set `type: phase` and `parent` to the parent addendum's wikilink.

## Navigation Callout Block

Insert a `> [!nav] Navigation` callout between the frontmatter and the `# Title`:

### Spec nav
```markdown
> [!nav] Navigation
> **Parent:** [[vision-spec|Vision Spec]]
> **Siblings:** [[other-domain/spec|Other Spec]], ...
> **Implementation Plan:** [[<domain>/plan|Plan Name]]
```

### Plan nav
```markdown
> [!nav] Navigation
> **Parent:** [[<domain>/spec|Spec Name]]
> **Phases:**
> 1. [[<domain>/phases/phase-1-...|Phase 1 Title]]
> ...
> **Dependency graph:** 1 → 2 → 3
```

### Phase nav
```markdown
> [!nav] Navigation
> **Parent:** [[<domain>/plan|Plan Name]]
> **Spec:** [[<domain>/spec|Spec Name]]
> **Depends on:** [[<domain>/phases/phase-X-...|Phase X]]
> **Prev:** [[<domain>/phases/phase-X-...|Prev Phase]]
> **Next:** [[<domain>/phases/phase-Y-...|Next Phase]]
```

### Addendum nav
```markdown
> [!nav] Navigation
> **Parent:** [[<domain>/plan|Plan Name]]
> **Spec:** [[<domain>/spec|Spec Name]]
> **Extends:** [[<domain>/phases/phase-X-...|Phase X]], ...
> **Related:** [[<domain>/addendums/other|Other Addendum]]
```

## After Creating the File

Update these existing files to maintain bidirectional links:

1. **Parent document** — Add a link to the new file in its nav block
   - New spec → update `vision-spec.md` nav block
   - New plan → update `<domain>/spec.md` nav block
   - New phase → update `<domain>/plan.md` nav block (add to phases list)
   - New addendum → update `<domain>/plan.md` nav block (add to addendums list)

2. **Sibling documents** — Update prev/next links on adjacent phases
   - If adding phase 4, update phase 3's `**Next:**` link and phase 5's `**Prev:**` link (if they exist)

3. **`docs/_index.md`** — Add an entry to the appropriate domain section / table

4. **Create directories** if they don't exist (e.g., `docs/<new-domain>/phases/`)

## Content Templates

After writing the frontmatter and nav block, read the appropriate body template from the `templates/` subdirectory of this skill:

| Type | Template file |
|------|---------------|
| `phase` | `.claude/skills/doc/templates/phase.md` |
| `plan` | `.claude/skills/doc/templates/plan.md` |
| `addendum` | `.claude/skills/doc/templates/addendum.md` |
| `spec` | `.claude/skills/doc/templates/spec.md` |

Use the template as the structural skeleton. Fill in all `{{PLACEHOLDER}}` markers with actual content. Remove any optional sections that don't apply. Add additional numbered sections as needed for the specific document.

Do NOT read existing documents to discover the format — the templates ARE the format.

## When to Update vs. Create New

When enhancing or fixing something that already has documentation, choose based on scope:

| Scope | Action | Example |
|-------|--------|---------|
| **Small fix / tweak** | Edit the existing phase brief inline. Add a `## Revision` section at the bottom describing what changed and why. | Fix a wrong interface definition in Phase 2 |
| **Enhancement that adds behavior** | Create an **addendum**. The original docs stay as historical record; the addendum describes the delta. If the enhancement needs build instructions, create a child implementation brief under the addendum. | Add Discord channel support |
| **Significant rework of a phase** | Create a new **phase brief** with a suffix like `3b` (e.g., `phase-3b-config-rework`). Reference the original brief as context ("what was built"), describe what's wrong, specify the changes. The original remains as history. | Config loading approach needs redesign |
| **Fundamental rearchitecture** | Bump the **spec version**. Update the spec itself, then create new plan/briefs as needed for affected phases. | Switch from polling to WebSocket-based log streaming |

**Key question to determine scope:** Is the *spec* wrong (design was flawed) or did the *implementation* diverge from the spec?
- **Spec is wrong** → update the spec, then create a rework brief for affected phases
- **Implementation diverged** → create a rework brief that brings implementation back in line, referencing the original spec as the target

## Key Rules

1. **Every link must be bidirectional.** If doc A links to doc B, doc B must link back to doc A. Always check both directions when creating or updating links.
2. **Original docs are history.** Don't delete or overwrite completed phase briefs. They document what was planned and built. Reworks and enhancements are additive documents that reference the originals.
