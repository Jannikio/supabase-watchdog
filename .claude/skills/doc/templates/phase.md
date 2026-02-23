# Watchdog — {{TITLE}}

## Context

```
{{CONTEXT_TREE}}
```

{{CONTEXT_NARRATIVE}}

Describe in 2-4 paragraphs:
1. What Watchdog is (one sentence) and what this domain/pipeline does
2. What was built in prior phases — summarize concretely (what exists, what works)
3. What THIS phase builds — the core problem it solves and what changes after it's done
4. What follows after this phase (list upcoming phases with "do not build" note)

---

## Scope Boundaries

### This phase DOES:
{{SCOPE_DOES}}

5-8 bullet points. Each starts with a verb. Be concrete — name functions, files, types.

### This phase does NOT:
{{SCOPE_DOES_NOT}}

5-8 bullet points. Reference which phase handles each excluded item.

### Boundary details:
{{BOUNDARY_DETAILS}}

2-4 bullet points clarifying edge cases or common misunderstandings about the scope.

---

## Project Integration

{{INTEGRATION_NARRATIVE}}

How this phase fits with existing code. Reference the project structure, error handling patterns, config conventions.

### Files modified

```
{{FILES_LIST}}
```

List every file that will be created or modified, with a short annotation (← purpose).

### New files

```
{{NEW_FILES_LIST}}
```

Or "No new files" / "All changes are within existing files."

### Dependencies to add

{{DEPENDENCIES}}

`deno.json` additions with version. Or "No new dependencies."

---

## {{N}}. {{SECTION_TITLE}}

{{TECHNICAL_CONTENT}}

Repeat numbered sections (## 1., ## 2., etc.) as needed for the implementation details. Each section covers one logical unit of work. Include:
- Code examples (TypeScript, etc.)
- Data structures / schema definitions
- Algorithm descriptions
- API signatures

---

## Open Questions

| # | Question | Status | Leaning |
|---|----------|--------|---------|
| {{N}} | {{QUESTION}} | {{STATUS: Open / Resolved / Deferred}} | {{LEANING}} |
