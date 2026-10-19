# Local commit preflight

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


After an approved identity or policy correction, rerun `gitrole check commit` in the actual commit environment. Read [identity and policy](identity-and-policy.md) only if saving, switching, or policy repair is needed. A diagnostic suggestion is not authorization to repair or commit.

The optional `hooks/pre-commit` uses the same local guard. Leave it uninstalled unless the user asks. Existing hooks can still block a commit; do not bypass or overwrite them. Review [hook compatibility and migration](https://docs.gitrole.dev/guides/check-identity-before-a-local-commit/) when hook work is requested.
