---
name: gitrole
description: Verify Git commit and push identity with gitrole before you commit or push. Use when creating a commit, amending a commit, or pushing, when GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL, GIT_COMMITTER_NAME, or GIT_COMMITTER_EMAIL may override Git config, and when asked if this repo's Git identity is aligned. Stop on warning and do not commit when misaligned.
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

## Trust the effective identity

`GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, and `GIT_COMMITTER_EMAIL` override Git config. A set `user.name` or `user.email` is not the commit identity.

Trust the `gitrole` result. Do not read Git config and decide the repo is aligned.

On `gitrole doctor --json`, `commitIdentity` is who the commit will use. `commitIdentity.fullName.source` and `commitIdentity.email.source` are `local`, `global`, `env`, or `unset`. `configuredIdentity` is only the raw config.

An env value that changes the effective author away from the saved role is `commit=warn` and `overall=warning`. Stop.

```text
role=no-role scope=global override=false commit=warn remote=ok auth=ok policy=na overall=warning
```

`GIT_COMMITTER_EMAIL` or `GIT_COMMITTER_NAME` that disagrees with the effective author is also `commit=warn`. Stop.

```text
role=work scope=global override=false commit=warn remote=ok auth=ok policy=na overall=warning
```

An env value that matches the saved role can be `info` with `overall=aligned`. That `info` is not a warning. Still use the `gitrole` result, not the config keys.

## Warnings that still stop

HTTPS origin with no `.gitrole` pin. `auth=warn` and `overall=warning`. Exit `2`. Stop. `auth=na` on HTTPS is only when a pin allows the active role and that role has a `githubUser`.

```text
role=work scope=local override=true commit=ok remote=ok auth=warn policy=na overall=warning
```

A repository with no commits yet is `overall=warning`. `remote=warn` because `HEAD` does not exist. Stop even when `commit=ok`.

No local role:

```text
role=work scope=global override=false commit=warn remote=warn auth=ok policy=na overall=warning
```

Local role, still no commits:

```text
role=work scope=local override=true commit=ok remote=warn auth=ok policy=na overall=warning
```

## `gitrole doctor --json`

JSON on stdout. Read `overall`, `commitIdentity`, and `checks[].status`. Do not parse `checks[].message`. Do not treat `configuredIdentity` as the commit identity.

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
