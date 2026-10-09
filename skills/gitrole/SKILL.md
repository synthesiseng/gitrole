---
name: gitrole
description: Verify Git commit and push identity with gitrole before you commit or push. Use when creating a commit, amending a commit, or pushing, when GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL, GIT_COMMITTER_NAME, or GIT_COMMITTER_EMAIL may override Git config, and when asked if this repo's Git identity is aligned. Stop on warning and do not commit when misaligned.
compatibility: Requires the gitrole CLI on PATH.
---

# Verify identity before you commit

Git can resolve identity from configuration and environment overrides. Before `git commit`, `git commit --amend`, or `git push`, check the identity gitrole reports and stop when it is a warning.

Use `gitrole status --short` as the precommit gate in the repository, including before its first commit.

```bash
gitrole status --short
```

Use `gitrole doctor --json` for broader diagnosis when a check needs explanation. Doctor is not a substitute for the precommit gate.

If `gitrole` is not on `PATH`, stop and tell the user. Do not commit.

This skill verifies. It doesn't install hooks, switch roles, or rewrite remotes. Do those only when the user asks. Run the status command as written. Online SSH inspection may execute configured `Match exec` commands or DNS lookups. Don't add `--offline` before a commit or push, because that flag skips the SSH probe this check is here to run.

## `gitrole status --short`

One line on stdout. Eight `key=value` fields, separated by single spaces, in this order:

```text
role scope override commit remote auth policy overall
```

Read the fields by name. `overall` is the eighth field. `policy` is the seventh. A parser that still treats the seventh field as the summary is reading `policy`.

| Result | Action |
| --- | --- |
| Exit `0` and `overall=aligned` | Identity checks aligned. Proceed only within the user’s existing authorization; this is not proof of push permission or success. |
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

On `gitrole doctor --json`, `commitIdentity` reports Git’s effective author for an ordinary commit in the current environment. `commitIdentity.fullName.source` and `commitIdentity.email.source` are `local`, `global`, `system`, `worktree`, `command`, `git`, `env`, or `unset`. `configuredIdentity` is only the raw config, so it can look fine while the commit uses an env override. `committerIdentity` reports the effective committer; divergence from the author warns. Gitrole reads Git’s ordinary-commit identity, including config includes and author/committer-specific settings. Current/import use the effective author. Strict consumers must accept the expanded provenance vocabulary; eight short fields and exits are unchanged. Later `git commit --author` or config/environment changes require a new check.

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

HTTPS-only push destination with no `.gitrole` pin. `auth=warn` and `overall=warning`. Exit `2`. Stop. `auth=na` on HTTPS is only when a pin allows the active role and that role has a `githubUser`. The pin expresses an expected role and account; it does not inspect, select, or verify HTTPS credentials. Without an allowing pin, this check warns, including offline:

```text
role=work scope=local override=true commit=ok remote=ok auth=warn policy=na overall=warning
```

A repository with no commits and no local role warns on commit identity. A destination can still be resolved without HEAD; `remote=ok` does not prove refspec readiness. Stop on the warning:

```text
role=work scope=global override=false commit=warn remote=ok auth=ok policy=na overall=warning
```

An explicit local role can keep `commit=ok` and the result can be aligned when all remaining checks pass. This observes identity, not branch readiness, push permission or successful push. With a local role and an allowing HTTPS pin, status can exit `0` before the first commit even though doctor exits `2` because there are no commits to inspect. Use the status gate before the separately authorized first commit; do not create a commit merely to silence doctor.

## `gitrole doctor --json`

JSON on stdout. Read `overall`, `commitIdentity`, and `checks[].status`. Don't parse `checks[].message`. Don't treat `configuredIdentity` as the commit identity.

Doctor includes checks beyond current identity, such as missing history. In a fresh repository, a `history` warning and exit `2` can coexist with aligned status. Doctor's result remains a warning; do not relabel it as success or filter its checks to manufacture a passing diagnosis.

If doctor was run first, run `gitrole status --short` for the precommit decision. A history-only warning about an unborn repository is explained by the absence of commits. Other diagnostic warnings or errors require investigation; do not use a clean status to dismiss them. Do not bypass any status warning. Any status exit `1` or `2` still stops the commit or push.

`checks[].status` of `info` is not a warning. It doesn't select exit `2`. Exit `1` means diagnosis failed, with the error on stderr; stop and investigate.

## After a warning

Report the command, the exit code, and `overall`. Quote any `warn` field from `status --short` and stop. For additional diagnosis, report doctor warning labels separately, including missing history; apply the diagnostic distinction above without changing the status stop rules.

Don't run `gitrole use`, `gitrole pin`, or `gitrole remote set` to clear the warning unless the user asks. Fixing the identity is a separate action, and the user has to choose the role.

The package also ships `hooks/pre-commit`, which runs the local `gitrole check commit` guard. It does not replace this skill's strict `gitrole status --short` precommit gate. Leave it uninstalled unless the user asks for that optional hook. Review the [local hook and manual migration guide](https://docs.gitrole.dev/guides/check-identity-before-a-local-commit/) first.

## Push observation limits

Default push observation checks every Git-resolved push URL, independently of fetch origin. Mixed SSH/HTTPS warns online. Custom commands, alternate diagnostic SSH binaries and interactive or incomplete SSH contexts remain unverified. Online inspection may execute configured Match commands or DNS; offline invokes no SSH. Alignment does not prove refspec readiness, push authorization or success and does not predict future explicit push arguments.

## Explicit account test belongs to the human

If the user wants an interactive account check, ask them to run `gitrole auth test` in a terminal. Never invoke it automatically from this skill, a hook or a prompt. It can execute configured SSH commands, contact the network and prompt through SSH. Existing SSH settings may save credentials or update known hosts.

The command reports the observed account and any mismatch with the effective role's `githubUser`. A mismatch exits 2. Even exit 0 is not proof of a future push and does not override a status warning. No history is stored.
