<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/gitrole-white.png">
    <img src="docs/assets/gitrole-black.png" alt="gitrole" width="60">
  </picture>
  <h1>gitrole</h1>
</div>

<p align="center">
    Switch your git identity in one command.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/gitrole"><img alt="npm version" src="https://img.shields.io/npm/v/gitrole?style=flat-square"></a>
  <a href="https://www.npmjs.com/package/gitrole"><img alt="npm downloads" src="https://img.shields.io/npm/dm/gitrole?style=flat-square"></a>
  <a href="https://nodejs.org/"><img alt="node version" src="https://img.shields.io/node/v/gitrole?style=flat-square"></a>
  <a href="https://github.com/synthesiseng/gitrole/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/synthesiseng/gitrole?style=flat-square"></a>
</p>

One machine often has a work identity and a personal one, and Git will commit or push as the wrong person without saying so. gitrole saves those identities as named roles, switches a repository to the right one, and checks who the next commit will be and who GitHub will see on an SSH push.

It answers two questions: who will this commit say it is from, and who will GitHub think you are when you push?

## Quick start

```bash
brew install synthesiseng/tap/gitrole
```

or with npm:

```bash
npm install -g gitrole
```

Both installs put `gitrole` and `gitrole-prompt` on `PATH`. Then, in a repository:

```bash
gitrole add work \
  --name "Alex Developer" \
  --email "alex@work.example"

gitrole use work --local
gitrole status
```

`add` saves the role, `use --local` applies it only in this repository, and `status` checks whether the repo looks ready to commit or push. If that looks right, you can stop. Run `gitrole doctor` when a check looks wrong and you need the reason.

## How to read a check

`gitrole current` tells you which saved role matches Git’s effective author identity. `gitrole status` is the check you run before a commit or a push. `gitrole doctor` explains a result that isn't clean.

`gitrole status --short` is the same check on one line for scripts. The fields, in order, are `role scope override commit remote auth policy overall`. Read `overall` by name. It is the eighth field, because `policy` sits in front of it. `overall=aligned` exits `0`. `overall=warning` exits `2` and still prints the line. Exit `1` is a failure: the error is on stderr and stdout is empty.

For ordinary commits in the current environment, gitrole reads Git’s effective author and committer with `git var GIT_AUTHOR_IDENT` and `git var GIT_COMMITTER_IDENT`, including Git configuration includes and environment overrides. `doctor --json` reports the author as `commitIdentity` and the committer as `committerIdentity`; a missing or different committer produces a commit warning. An earlier check cannot predict flags on a future command, such as `git commit --author`, or later configuration/environment changes.

The eight short fields, their order, and exit codes stay the same. Identity provenance now supports `system`, `worktree`, `command`, and `git` alongside the existing source values. `git` identifies a Git-derived value without a configured field. `scope` reports the underlying configured author scope, including `mixed` or `unset`, even when an identity field has source `env`. Strict consumers must accept the expanded source/scope vocabulary and the additional `committerIdentity` JSON field.

gitrole warns on violated expectations, not assumptions. `overall=warning` happens when at least one actionable check is `warn`. `na` means that check doesn't apply, and it doesn't by itself make the result a warning.

## Shell prompt

You can print the active role in the shell prompt. The snippets need gitrole 0.9.0 or newer. They run `gitrole status --short --offline` on every prompt and format that line with `gitrole-prompt --format`. There is no auth cache. `--offline` skips the live SSH probe, so a prompt doesn't open a connection every time the line redraws.

`gitrole:work ✓` means commit and policy are ok and auth was not checked. It does not mean network auth was verified. Live auth is `gitrole doctor` and the optional check-only hook, not the prompt. `auth=na` is a skipped SSH probe, not a green auth check. `gitrole status --short --offline` doesn't emit `auth=ok`. If a line still says `auth=ok`, the segment shows ⚠, because ✓ only covers the offline contract. A local warn shows `gitrole:work ⚠`. A failed or unreadable status shows `gitrole:? ⚠`.

The segment is opt-in and check-only. It doesn't switch roles or install hooks. Snippets for Starship, oh-my-zsh, zsh, bash, and fish are in [`examples/prompt/`](examples/prompt/README.md). The same setup is written up in [Show gitrole in your shell prompt](https://docs.gitrole.dev/guides/show-gitrole-in-your-shell-prompt/).

## Agents

Coding agents commit quickly, and they often commit as whoever the environment variables name. The published package includes an agent skill at `skills/gitrole/SKILL.md`. Point Claude Code, Codex, or Cursor at that directory. The skill tells the agent to run `gitrole status --short` before a commit, or `gitrole doctor --json` for the full diagnosis, and to stop when `overall=warning` (exit `2`) or any check is `warn`. Exit `0` is aligned. Exit `1` is a failure.

The agent uses the effective author and committer those commands report. `GIT_AUTHOR_*` and `GIT_COMMITTER_*`, author/committer-specific config, and included config can change the identity, so a set `user.name` or `user.email` is not enough. An author that matches no saved role or a committer that differs from the author produces a commit warning. HTTPS with no pin and a repository with no commits yet also produce warnings. Stop on a warning.

The skill verifies. It doesn't install hooks or block git. The optional check-only hook still runs `gitrole status --short` only when you install it yourself. Install steps are in [Verify Git identity before an agent commits](https://docs.gitrole.dev/guides/verify-git-identity-before-an-agent-commits/).

## Common next steps

To save Git’s effective author name and email in the current environment, including author environment overrides:

```bash
gitrole import current --name work
```

If a repository should prefer one saved role, pin a strict repo-local policy:

```bash
gitrole pin work
gitrole resolve
```

Shell completion for bash, zsh, and fish is in the npm package and is not turned on by install. The package paths are `completions/gitrole.bash`, `completions/_gitrole`, and `completions/gitrole.fish`. See [Enable shell tab completion](https://docs.gitrole.dev/guides/enable-shell-tab-completion/). The Homebrew formula installs the two binaries. This page doesn't document a Homebrew prefix path for the completion scripts.

## What it doesn't do

gitrole checks and switches the identity you name. It doesn't take over the rest of your GitHub accounts.

- It doesn't switch GitHub in the browser or manage sessions.
- It doesn't run `gh auth`, store HTTPS credentials, or manage tokens.
- It doesn't auto-install hooks, auto-switch roles, or enforce a workflow. The optional check-only hook runs `gitrole status --short` only after you install it.
- It doesn't enable shell completion for you.
- It doesn't prompt interactively.

## Commands

| Command                                                                                             | Purpose                                                                             |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `gitrole add <name> --name "..." --email "..." [--ssh ...] [--github-user ...] [--github-host ...]` | Create or update a saved role profile                                               |
| `gitrole import current --name <role>`                                                               | Save the effective current author identity as a named role                          |
| `gitrole use <name> [--global \| --local]`                                                          | Switch git identity at global or repository-local scope and optionally load SSH key |
| `gitrole pin <role>`                                                                                 | Create a strict repo-local `.gitrole` policy for a single saved role                |
| `gitrole resolve`                                                                                   | Print the repo-local default role from `.gitrole`                                   |
| `gitrole resolve --json`                                                                            | Emit the repo-local policy as structured JSON                                       |
| `gitrole current`                                                                                   | Show which saved role matches the effective author identity                            |
| `gitrole list`                                                                                      | List all saved roles and mark the active one                                        |
| `gitrole status`                                                                                    | Check whether the current repo is aligned for commit and push                       |
| `gitrole status --short`                                                                            | Machine-friendly alignment fields for scripts and prompts                           |
| `gitrole doctor`                                                                                    | Diagnose commit identity, remote config, and SSH push identity                      |
| `gitrole doctor --json`                                                                             | Emit the full diagnosis as structured JSON                                          |
| `gitrole remote set <name>`                                                                         | Rewrite origin to the role's GitHub SSH host alias                                  |
| `gitrole remove <name>`                                                                             | Remove a saved role profile                                                         |

## Diagnosis policy

`githubUser` checks the resolved SSH auth user on SSH remotes. HTTPS origins report `auth=na` only when a repo pin allows the active role and that role has a `githubUser`. No pin, or a GitHub user that doesn't match the pin, is `auth=warn`. `githubHost` checks the remote host alias. Remote owner and repository are context by default, so a different owner alone doesn't warn. `policy` is `ok`, `warn`, or `na`.

The field names, values, and exit codes are specified in [Machine Readable Contracts](https://docs.gitrole.dev/machine-readable-contracts/).

## Learn more

- [Docs homepage](https://docs.gitrole.dev)
- [Guide: Use the right Git identity for this repo](https://docs.gitrole.dev/guides/use-the-right-git-identity-for-this-repo/)
- [Guide: Use repo-local identity policy with .gitrole](https://docs.gitrole.dev/guides/use-repo-local-identity-policy-with-gitrole/)
- [Guide: Show gitrole in your shell prompt](https://docs.gitrole.dev/guides/show-gitrole-in-your-shell-prompt/)
- [Guide: Enable shell tab completion](https://docs.gitrole.dev/guides/enable-shell-tab-completion/)
- [Guide: Verify Git identity before an agent commits](https://docs.gitrole.dev/guides/verify-git-identity-before-an-agent-commits/)
- [Use case: Fix pushes using the wrong GitHub account](https://docs.gitrole.dev/use-cases/fix-pushes-using-the-wrong-github-account/)

## License

MIT
