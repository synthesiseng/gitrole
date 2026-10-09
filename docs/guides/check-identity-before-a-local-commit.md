---
layout: layouts/base.njk
title: Check identity before a local commit
eyebrow: Guide
summary: Check the effective author, committer, and repository policy locally, and review migration from the older combined-status hook.
order: 5
---

Use `gitrole check commit` when a commit should require a saved identity and the repository's local policy. It reads local Git and role data, without resolving push destinations, invoking SSH, or checking authentication. A repository needs no remote, GitHub username, SSH alias, or SSH key for this check.

```bash
gitrole check commit
```

Success exits `0` with no output. A mismatch exits `2`; an operational or required-data failure exits `1`. Both failures explain the reason on stderr and leave stdout empty. No role, policy, or Git configuration is created or changed. The command accepts no operands, `--offline`, or JSON mode: it is always local.

<h2 id="saved-role">Choose the intended saved identity</h2>

The opt-in guard requires the **full effective author name and email to match a saved role**, even without a `.gitrole` pin. The committer must match that same complete identity. Save the intended identity as a role, or do not install the hook there. The check never imports an unknown identity automatically.

For example, after deciding that this is the intended identity:

```bash
gitrole add work --name "Alex Developer" --email "alex@work.example"
gitrole use work --local
gitrole check commit
```

Replace the example values with yours. `add` replaces an existing profile with that name, so include any optional fields you intend to retain. `use` changes Git configuration and may load a saved SSH key or run its existing alignment checks; it is a separate action from the read-only commit check.

A missing `.gitrole` file is allowed. When one exists, its `defaultRole` and other `allowedRoles` pass equally. An allowed non-default role can pass even if the default profile is not saved. Duplicate saved identities use the first matching profile in store order; review duplicates if the first match is disallowed. A matching legacy profile named `no-role` must be recreated under a usable name. Unrelated legacy blank identities do not veto a valid match.

The check retains conservative identity rules: mixed configured sources refuse the commit, and a first commit requires a local or worktree identity override even when the global identity matches a saved role. An established repository can use a matching global identity. A legitimate unborn branch is supported; broken HEAD, Git config, index, or required files are failures, not evidence of a new repository. Outside a worktree, including a bare repository, the command exits `2`.

<h2 id="overrides">Read the reason before changing config</h2>

Git's author and committer settings, included configuration, command configuration, and environment overrides participate in the effective identity. Inside a hook, Git can prepare `GIT_AUTHOR_*` values from `--author`, amend, or reused authors; an environment source does not prove that you exported it yourself. Correct the source identified by the diagnostic and start a new commit attempt. `gitrole use work --local` alone cannot override every author or committer setting.

A standalone check observes its current invocation. It cannot predict a later explicit author argument or configuration change. The pre-commit hook checks the environment Git supplies for that attempt.

<h2 id="install">Review and install the optional hook</h2>

The source `hooks/pre-commit` runs `gitrole check commit` through the hook's `PATH`. Installation and CLI upgrades do not copy this hook into repositories. Confirm that the executable available in the hook's environment supports `gitrole check commit --help`; your interactive shell may find a different installation. Source documentation does not establish that a compatible version has been published.

Find the proposed asset and Git's effective destination before deciding to install:

```bash
# For a global npm installation; alternatively use an absolute checkout path.
GITROLE_HOOK="$(npm root -g)/gitrole/hooks/pre-commit"
HOOK_PATH="$(git rev-parse --git-path hooks/pre-commit)"
printf 'Review source: %s\nReview destination: %s\n' "$GITROLE_HOOK" "$HOOK_PATH"
```

Keep the current directory when interpreting a relative destination. This lookup preserves the nominated path: inspect it and every parent component for symlinks before resolving any target. Absolute path formatting can dereference symlinks, including dangling links, and hide their ownership. Review the source bytes, destination, permissions, and affected repositories. `core.hooksPath` can redirect the destination; linked worktrees can share it. If the destination is absent and you choose this guard, copy the reviewed hook there and make it executable. Stop if the destination appears or changes before copying. Existing files, directories, symlinks, and managed hook chains need owner review, not an overwrite. No general-purpose installer or race-free replacement is provided.

The wrapper refuses the commit if the CLI is missing, too old, cannot launch Node, or returns an unexpected failure. It preserves command exits `1` and `2` and normalizes other failures to `1`. It never switches roles, retries a commit, or bypasses a failed check.

`git commit --no-verify` bypasses this pre-commit hook and all other pre-commit checks (and commit-msg). It does not correct identity. Use it only if you deliberately accept that bypass. The hook is optional local assistance, not an unbypassable permission boundary.

<h2 id="migration">Migrate a copied legacy hook manually</h2>

Older packaged hooks, including npm 0.10.11, run `gitrole status --short`. They check combined commit, remote, authentication, and policy alignment. Such a copied hook keeps its strict behavior after a CLI upgrade. The new local hook permits an otherwise valid commit without a remote or successful SSH probe; `status`, prompts, and the packaged agent skill retain their existing contracts.

| Hook and CLI | Behavior |
| --- | --- |
| Legacy hook, compatible new CLI | Still uses strict combined status |
| New local hook, compatible new CLI | Uses the local commit check |
| New local hook, old or unavailable CLI | Refuses the commit |
| Custom or composed hook | Requires manual review of the whole chain |

Upgrade the CLI first and verify command support in the hook's environment. For an exact, standalone legacy regular file that you own, retain a private, no-overwrite backup outside the repository: exact bytes, permissions, original path, and a digest. Verify that the backup matches before replacing anything. Review the new asset and recheck the original file's type, digest, permissions, and ownership immediately before replacement. Any change or uncertainty stops the migration. Preserve the backup after migration.

For shared paths, inventory the other repositories and worktrees affected first. For symlinks, custom scripts, or manager-generated chains, use the owner's integration process and preserve other checks, ordering, stdin, exits, and permissions. A text match is not permission to replace a script. Enabling a previously nonexecutable hook is a separate decision.

To roll back before downgrading the CLI, restore the verified legacy backup only while the replacement still matches the reviewed new bytes, mode, and ownership. Reconcile intervening edits manually. Restoration brings back remote/authentication blocking. A partial or interrupted copy needs inspection and recovery from the retained backup; do not assume installation succeeded. Leaving the new hook with an incompatible old CLI deliberately blocks commits.

<h2 id="doctor-hint">Use doctor's migration hint</h2>

`gitrole doctor` and `gitrole doctor --json` can report a legacy-hook migration hint. Doctor asks Git for the effective pre-commit path, then inspects that file without executing it or its sourced scripts. It does not search other repositories or replace anything. The hint is also available with `doctor --offline`, including `--json`. Default doctor diagnosis may invoke SSH; `doctor --offline` invokes no SSH commands, including configuration inspection. The hook inspection itself is local in both modes.

An exact known legacy file is identified by its bytes. A nonexecutable file is reported as inactive, and a matching symlink target carries a shared-target caution. A custom or edited script containing the old invocation gets only a qualified text observation: a match inside a comment, function, or conditional does not prove that it runs. Review the whole script and its owner before changing it.

Inspection follows at most eight symlinks, reads at most 64 KiB plus one byte to detect oversize content, and refuses special files such as FIFOs, devices, and directories. Unreadable, broken, oversized, changing, or otherwise unverifiable files yield an unknown migration state. Byte and link limits do not provide a hard time limit for a stalled filesystem mount.

A finding adds at most one `info` check labeled `hook`; it does not change doctor's overall verdict or exit code. A missing or unrelated hook may produce no finding. Silence does not prove that a repository has a working guard, that a custom chain is safe, or that migration is complete. The commit guard does not depend on this optional observation.

<h2 id="other-checks">Keep broader checks deliberate</h2>

The packaged agent skill still runs `gitrole status --short` and stops on its warnings. Installing the local hook does not change that instruction or authorize an agent to ignore it. See <a href="{{ '/guides/verify-git-identity-before-an-agent-commits/' | url }}">Verify identity before an agent commits</a>.

Use `status` or `doctor` deliberately for broader push diagnosis; their online modes may invoke SSH. No pre-push hook is installed or supplied by this change. A future push guard would need to check the actual push target and preserve any existing hook chain; moving the old status call to pre-push would not establish that contract.
