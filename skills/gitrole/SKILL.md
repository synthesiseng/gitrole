---
name: gitrole
description: Check Git identity before ordinary commits or pushes, and diagnose wrong author names, emails, GitHub accounts, environment overrides, or repository policy mismatches. Use for first commits and amend requests too, with separate author review for amend. Keep local commit gating separate from push diagnosis; stop on the relevant check's failure.
compatibility: Requires gitrole 0.12.0 or newer on PATH with check commit support.
---

# Check identity for the intended operation

Verify, diagnose, then apply only user-approved corrections and recheck. These instructions do not authorize a commit or push and are not an enforced Git permission boundary.

## Confirm command support

In the agent's actual execution environment, check `gitrole --version` and `gitrole check commit --help`. Confirm that help describes the local commit check, not generic help from an older CLI. If the CLI is missing, unsupported, or fails, stop and report the command and error. Do not install or upgrade it automatically. Do not fall back to online status as a commit gate. A copied skill may be newer than the installed CLI.

## Ordinary commits

Use `gitrole check commit` as the commit gate in the repository, including before its first commit:

```bash
gitrole check commit
```

| Result | Action |
| --- | --- |
| Exit `0`, no output | Local identity and policy pass. Continue only within existing user authorization and the checked configuration/environment. |
| Exit `2` | Stop. Do not commit. Report the mismatch from stderr. |
| Exit `1`, or any unexpected result | Stop. Do not commit. Report the required-data or operational failure from stderr. |

The check requires a complete effective author name/email matching a saved usable role, a matching committer, and compliance with `.gitrole` when present. Missing usable identity, mixed configured sources, mismatched identity/policy, and malformed required data block. A first commit requires a local or worktree identity override; a matching global identity alone does not pass in a fresh repository. A missing `.gitrole` file is allowed.

It needs no remote, GitHub username, SSH key, or successful authentication. It runs locally without SSH, network access, or Keychain access. Do not add `--offline` or `--json`: this command accepts neither. Missing remotes, HTTPS authentication warnings and unverified SSH do not become commit prerequisites. They remain meaningful push diagnostics; do not relabel a warning result as success.

## Diagnose a commit problem locally

```bash
gitrole doctor --offline --json
```

Read `overall`, `commitIdentity`, `committerIdentity`, and `checks[].status`/`checks[].label`. Do not parse `checks[].message` as a stable contract. `configuredIdentity` is raw config, not the effective identity. `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, and `GIT_COMMITTER_EMAIL` can override configuration. Effective identity sources include `local`, `global`, `system`, `worktree`, `command`, `git`, `env`, and `unset`.

Doctor is broader diagnosis, not a substitute for `check commit`. A `history` warning in a fresh repository, missing destination, or skipped/unverified authentication can coexist with a passing local commit check. Report those separately. Do not filter doctor checks or change its `overall`/exit to manufacture a pass. `info` is not a warning; exit `1` means diagnosis failed and prints no JSON. Investigate identity/policy warnings and errors, then rerun `check commit` for the commit decision. Do not make a commit merely to silence doctor.

## Amend and author overrides

`git commit --amend` normally retains the existing commit's author. A standalone `check commit` observes ordinary-commit identity in its current invocation; it does not validate that retained author. Inspect the existing author and intended committer, confirm the intended author with the user when unclear, and check that both match the approved saved role and policy before an authorized amend. Do not silently add `--reset-author` or rewrite authorship.

Likewise, a passing check does not cover a later explicit `--author`, reused author, or later environment/configuration changes (including command-scoped `git -c`). Re-evaluate the actual intended identity and rerun the check in that context; if it cannot be established, stop. An already installed local hook can check Git's prepared environment for that attempt, but do not assume a hook exists or install one to bypass this limitation.

## Pushes

Determine the intended push command and destination first. `check commit` does not check pushes. For the default push context, run:

```bash
gitrole status --short
```

The eight fields are `role scope override commit remote auth policy overall`. Read them by name; `overall` is the eighth field, after `policy`.

| Result | Action |
| --- | --- |
| Exit `0` and `overall=aligned` | Current default-destination identity checks align; this is not proof of refspec readiness, push permission or success. |
| Exit `2`, `overall=warning`, or `commit`, `remote`, `auth`, or `policy` is `warn` | Stop. Do not push. Report the command, exit and warning fields. |
| Exit `1`, missing/malformed fields, or any unexpected result | Stop. Do not push. Report the error; exit `1` leaves stdout empty. |

`na` means skipped or not applicable, not authenticated. `policy=na` can align without a policy file. HTTPS-only destinations warn unless an allowing pin and the active role's saved `githubUser` satisfy the local HTTPS expectation; even then `auth=na` does not inspect, select, or verify HTTPS credentials. Mixed SSH/HTTPS warns online. Custom SSH commands and incomplete or interactive authentication contexts remain unverified.

Status observes every Git-resolved default push URL, independently of fetch origin. It has no destination argument or target override option. Default status cannot approve an explicit remote, URL, refspec or other future push arguments. Inspect the actual destination configuration (including all push URLs and URL rewrites) and refspec intent separately; if the requested context is not covered, stop and explain the limitation rather than treating default alignment as verification. Never rewrite remotes merely to make the check pass.

Use `gitrole doctor --json` for structured push diagnosis where online inspection is appropriate. Online checks can invoke SSH and configured `Match exec`, proxies or DNS, with effects allowed by existing SSH settings. If online inspection is not appropriate, use `gitrole doctor --offline --json` and report authentication as unverified; offline diagnosis does not establish live push authentication. Neither mode guarantees a future push after arguments, configuration or environment change.

## Apply only approved corrections, then verify

The user must choose the intended role. Do not run `gitrole use`, `gitrole pin`, `gitrole remote set`, change hooks, or edit identity/configuration without user approval for that action. Never switch globally to silence a warning. Where policy is expected, `gitrole resolve --json` can explain `defaultRole` and `allowedRoles`; it does not select a role or grant permission to switch. Its missing/invalid-policy exit `1` is a failure, not an empty policy.

After an approved correction, repeat the check for the intended operation. A suggested repair command is not authorization to execute it.

The optional `hooks/pre-commit` uses the same local `gitrole check commit` guard. Leave it uninstalled unless the user asks. Existing copied hooks or skills retain their old instructions until deliberately reviewed and migrated; this skill does not bypass a failing hook. See the [local hook and manual migration guide](https://docs.gitrole.dev/guides/check-identity-before-a-local-commit/).

## Interactive account tests belong to the human

If an interactive account check is needed, ask the user to run `gitrole auth test` in a terminal. Never invoke it automatically from this skill, a hook, or a prompt. It can execute configured SSH commands, contact the network, prompt, save credentials or update known hosts under existing SSH settings.

It reports the observed account and mismatch with the effective role's `githubUser`; mismatch exits `2`. Even exit `0` does not prove a future push or override a status warning. No history is stored.
