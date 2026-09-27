---
name: gitrole
description: Verify Git commit and push identity with gitrole before you commit or push. Use when creating a commit, amending a commit, or pushing, and when asked if this repo's Git identity is aligned. Stop on warning and do not commit when misaligned.
compatibility: Requires the gitrole CLI on PATH.
---

# Verify identity before you commit

Run one command in the repository before `git commit`, `git commit --amend`, or `git push`. Prefer the first:

```bash
gitrole status --short
```

```bash
gitrole doctor --json
```

If `gitrole` is not on `PATH`, stop and tell the user. Do not commit.

This skill verifies. It does not install hooks, switch roles, or rewrite remotes. Do those only when the user asks.

## `gitrole status --short`

One line on stdout. Eight `key=value` fields, separated by single spaces, in this order:

```text
role scope override commit remote auth policy overall
```

Read `overall` by name. It is the eighth field. `policy` is the seventh.

| Result | Action |
| --- | --- |
| Exit `0` and `overall=aligned` | Aligned. You may commit or push. |
| Exit `2` or `overall=warning` | Stop. Do not commit or push. |
| `commit`, `remote`, `auth`, or `policy` is `warn` | Stop. Do not commit or push. |
| Exit `1` | Stop. Stdout is empty. The error is on stderr. |

`na` means that check does not apply. It does not by itself mean stop. `policy=na` with `overall=aligned` is aligned.

Aligned:

```text
role=work scope=local override=true commit=ok remote=ok auth=ok policy=na overall=aligned
```

Stop:

```text
role=work scope=local override=true commit=ok remote=ok auth=warn policy=na overall=warning
```

## `gitrole doctor --json`

JSON on stdout. Read `overall` and `checks[].status`. Do not parse `checks[].message`.

| Result | Action |
| --- | --- |
| Exit `0`, `overall` is `aligned`, and no `checks[].status` is `warn` | Aligned. You may commit or push. |
| Exit `2`, `overall` is `warning`, or any `checks[].status` is `warn` | Stop. Do not commit or push. |
| Exit `1` | Stop. There is no JSON. The error is on stderr. |

`checks[].status` of `info` is not a warning.

## After a warning

Report the command, the exit code, and `overall`. Quote any `warn` field from `status --short`, or any `warn` check `label` from `doctor --json`. Then stop.

Do not run `gitrole use`, `gitrole pin`, or `gitrole remote set` to clear the warning unless the user asks.

The package also ships `hooks/pre-commit`, which only runs `gitrole status --short`. Leave it uninstalled unless the user asks for that optional hook.

These commands take no input. Do not add flags.
