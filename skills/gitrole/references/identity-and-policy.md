# Saved identities and repository policy

## Inspect before choosing

Use `gitrole list` to inspect saved roles and `gitrole current` to find the role matching the effective author. Neither chooses a role. Raw `user.name` and `user.email` alone do not establish effective authorship: Git includes, command configuration, `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, and `GIT_COMMITTER_EMAIL` can override it. `current` does not verify the committer.

For local diagnosis, use `gitrole doctor --offline --json`: inspect `commitIdentity`, `committerIdentity`, `configuredIdentity`, and field provenance. `configuredIdentity` is raw configuration, not the effective author/committer. Read `checks[].status` and `checks[].label`; messages are not a stable parsing contract. Doctor’s broader warnings are not themselves the local commit gate. Do not filter its checks or relabel its verdict.

Ask when the intended role or scope is unclear; never infer permission to switch from a diagnostic or policy default.

## Save, switch, and pin are distinct

Run a mutation only when the user approved that action and identity:

- `gitrole add <role> --name "Full Name" --email "address"` saves a profile without applying it. It replaces an existing profile of the same name, including omitted optional fields; inspect and retain intended fields before an approved update.
- `gitrole import current --name <role>` saves the effective author only, including author environment overrides. It does not import the committer, SSH configuration, GitHub username, or host alias; it also replaces an existing named profile.
- `gitrole use <role> --local` applies the saved name/email in this repository. Use explicit `--local` for an approved repository-local switch. Bare `gitrole use <role>` and `--global` change global Git configuration. Local use does not remove higher-priority author/committer overrides.
- `gitrole pin <role>` creates a strict `.gitrole` policy with that role as default and sole allowed role. It requires the saved role and refuses to overwrite an existing policy. It does not apply the role. Review the file before staging or sharing it.

`use` may run `ssh-add` for the role’s saved key, even with `--local`. Its existing alignment checks can invoke SSH and the network even when no key is saved. Explain these effects before seeking approval when relevant. A failed key load is best-effort and does not mean Git configuration was rolled back. Do not invent an offline flag for `use` or silently retry switches. Saving an SSH path or GitHub field does not configure an alias, credentials, or a browser session.

## Read policy without applying it

`gitrole resolve --json` reports `version`, `defaultRole`, and `allowedRoles`. It neither selects a role nor grants permission to switch. Missing or invalid policy exits `1`, with no policy JSON; distinguish absence from malformed or unreadable data rather than treating any failure as an empty policy. A confirmed missing `.gitrole` is allowed by `check commit`; do not create one merely to silence `resolve`.

For the commit gate, all allowed roles pass equally, including a non-default role when the default profile is not saved. The full effective author and committer must still match the same saved usable identity. Duplicate saved identities resolve to the first matching profile in store order; review duplicates if that match is disallowed. The reserved legacy name `no-role` is unusable for the gate.

For an existing policy, propose the minimal intended edit only when asked or approved. Do not broaden `allowedRoles`, change its default, save an unknown identity, or switch globally just to get a passing check.

After an approved change, inspect the resulting identity/policy. For an intended commit, continue with [commit preflight](commit-preflight.md); for push/account work, use [push diagnosis](push-diagnosis.md). No network check is required just to inspect or save local identity data.
