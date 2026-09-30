---
name: gitrole
description: Verify Git commit and push identity with gitrole before you commit or push. Use when creating a commit, amending a commit, or pushing, when GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL, GIT_COMMITTER_NAME, or GIT_COMMITTER_EMAIL may override Git config, and when asked if this repo's Git identity is aligned. Stop on warning and do not commit when misaligned.
compatibility: Requires the gitrole CLI on PATH.
---

# Verify identity before you commit

Coding agents commit as whoever the environment names, and that person is often wrong for the repository. Before `git commit`, `git commit --amend`, or `git push`, check the identity gitrole reports and stop when it is a warning.

Run this in the repository. Prefer the first command. Use the second when you need the reason, not only the line.

```bash
gitrole status --short
```

```bash
gitrole doctor --json
```

If `gitrole` is not on `PATH`, stop and tell the user. Do not commit.

This skill verifies. It doesn't install hooks, switch roles, or rewrite remotes. Do those only when the user asks. Run the two commands as written. Don't add `--offline` before a commit or push, because that flag skips the SSH probe this check is here to run.

## `gitrole status --short`

One line on stdout. Eight `key=value` fields, separated by single spaces, in this order:

```text
role scope override commit remote auth policy overall
```

Read the fields by name. `overall` is the eighth field. `policy` is the seventh. A parser that still treats the seventh field as the summary is reading `policy`.

| Result | Action |
| --- | --- |
| Exit `0` and `overall=aligned` | Aligned. You may commit or push. |
| Exit `2` or `overall=warning` | Stop. Do not commit or push. |
| `commit`, `remote`, `auth`, or `policy` is `warn` | Stop. Do not commit or push. |
| Exit `1` | Stop. Stdout is empty. The error is on stderr. |

`na` means that check doesn't apply. It doesn't by itself mean stop. `policy=na` with `overall=aligned` is aligned, because no `.gitrole` file is present.

Aligned local role, no `.gitrole` file:

```text
role=work scope=local override=true commit=ok remote=ok auth=ok policy=na overall=aligned
```

## Trust the effective identity

`GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, and `GIT_COMMITTER_EMAIL` override Git config. A set `user.name` or `user.email` is not the commit identity. Trust the gitrole result. Don't read Git config and decide the repo is aligned.

On `gitrole doctor --json`, `commitIdentity` is who the commit will use. `commitIdentity.fullName.source` and `commitIdentity.email.source` are `local`, `global`, `system`, `worktree`, `command`, `git`, `env`, or `unset`. `configuredIdentity` is only the raw config, so it can look fine while the commit uses an env override. `committerIdentity` reports the effective committer; divergence from the author warns. Gitrole reads Git’s ordinary-commit identity, including config includes and author/committer-specific settings. Current/import use the effective author. Strict consumers must accept the expanded provenance vocabulary; eight short fields and exits are unchanged. Later `git commit --author` or config/environment changes require a new check.

An env value that changes the effective author away from the saved role is `commit=warn` and `overall=warning`. Stop. This line is `GIT_AUTHOR_EMAIL` set to an address that matches no saved role:

```text
role=no-role scope=global override=false commit=warn remote=ok auth=ok policy=na overall=warning
```

`GIT_COMMITTER_EMAIL` or `GIT_COMMITTER_NAME` that disagrees with the effective author is also `commit=warn`. Stop. The saved role can still match, because the author didn't change:

```text
role=work scope=global override=false commit=warn remote=ok auth=ok policy=na overall=warning
```

An env value that matches the saved role can be `info` with `overall=aligned`. That `info` is not a warning. Still use the gitrole result, not the config keys.

## Warnings that still stop

HTTPS origin with no `.gitrole` pin. `auth=warn` and `overall=warning`. Exit `2`. Stop. `auth=na` on HTTPS is only when a pin allows the active role and that role has a `githubUser`. Without that pin, gitrole can't tell which GitHub user the HTTPS push will use:

```text
role=work scope=local override=true commit=ok remote=ok auth=warn policy=na overall=warning
```

A repository with no commits yet is `overall=warning`. `remote=warn` because `HEAD` doesn't exist. Stop even when `commit=ok`. The first commit is the one that is hardest to fix later.

No local role:

```text
role=work scope=global override=false commit=warn remote=warn auth=ok policy=na overall=warning
```

Local role, still no commits:

```text
role=work scope=local override=true commit=ok remote=warn auth=ok policy=na overall=warning
```

## `gitrole doctor --json`

JSON on stdout. Read `overall`, `commitIdentity`, and `checks[].status`. Don't parse `checks[].message`. Don't treat `configuredIdentity` as the commit identity.

| Result | Action |
| --- | --- |
| Exit `0`, `overall` is `aligned`, and no `checks[].status` is `warn` | Aligned. You may commit or push. |
| Exit `2`, `overall` is `warning`, or any `checks[].status` is `warn` | Stop. Do not commit or push. |
| Exit `1` | Stop. There is no JSON. The error is on stderr. |

`checks[].status` of `info` is not a warning. It doesn't select exit `2`.

## After a warning

Report the command, the exit code, and `overall`. Quote any `warn` field from `status --short`, or any `warn` check `label` from `doctor --json`. Then stop.

Don't run `gitrole use`, `gitrole pin`, or `gitrole remote set` to clear the warning unless the user asks. Fixing the identity is a separate action, and the user has to choose the role.

The package also ships `hooks/pre-commit`, which only runs `gitrole status --short`. Leave it uninstalled unless the user asks for that optional hook.
