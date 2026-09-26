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

`gitrole` is a focused CLI for developers who move between multiple Git identities on one machine. Save named roles like `work`, `personal`, or `client-acme`, switch to the right one, and check the repo before you commit or push.

`gitrole` is strongest when it answers:

- who will this commit say it is from?
- who will GitHub think I am when I push?

New features should reinforce that boundary rather than expanding into general account management.

## Install

```bash
npm install -g gitrole
```

## Quickstart

```bash
gitrole add work \
  --name "Alex Developer" \
  --email "alex@work.example"

gitrole use work --local
gitrole status
```

That is the fastest path to first success:

- `add` saves a role
- `use --local` applies it only to this repository
- `status` checks whether the repo looks ready to commit or push

Run `gitrole doctor` when something looks wrong.

## Common next steps

If Git is already configured correctly and you just want to save that identity as a role:

```bash
gitrole import current --name work
```

If a repository should prefer exactly one saved role, pin a strict repo-local policy:

```bash
gitrole pin work
gitrole resolve
```

## Learn more

Start with the docs if you want the full workflow, setup guides, and use cases:

- [Docs homepage](https://docs.gitrole.dev)
- [Guide: Use the right Git identity for this repo](https://docs.gitrole.dev/guides/use-the-right-git-identity-for-this-repo/)
- [Guide: Use repo-local identity policy with .gitrole](https://docs.gitrole.dev/guides/use-repo-local-identity-policy-with-gitrole/)
- [Use case: Fix pushes using the wrong GitHub account](https://docs.gitrole.dev/use-cases/fix-pushes-using-the-wrong-github-account/)

## Commands

| Command                                                                                             | Purpose                                                                             |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `gitrole add <name> --name "..." --email "..." [--ssh ...] [--github-user ...] [--github-host ...]` | Create or update a saved role profile                                               |
| `gitrole import current --name <role>`                                                               | Save the effective current commit identity as a named role                          |
| `gitrole use <name> [--global \| --local]`                                                          | Switch git identity at global or repository-local scope and optionally load SSH key |
| `gitrole pin <role>`                                                                                 | Create a strict repo-local `.gitrole` policy for a single saved role                |
| `gitrole resolve`                                                                                   | Print the repo-local default role from `.gitrole`                                   |
| `gitrole resolve --json`                                                                            | Emit the repo-local policy as structured JSON                                       |
| `gitrole current`                                                                                   | Show which saved role matches the active commit identity                            |
| `gitrole list`                                                                                      | List all saved roles and mark the active one                                        |
| `gitrole status`                                                                                    | Check whether the current repo is aligned for commit and push                       |
| `gitrole status --short`                                                                            | Machine-friendly alignment fields for scripts and prompts                           |
| `gitrole doctor`                                                                                    | Diagnose commit identity, remote config, and SSH push identity                      |
| `gitrole doctor --json`                                                                             | Emit the full diagnosis as structured JSON                                          |
| `gitrole remote set <name>`                                                                         | Rewrite origin to the role's GitHub SSH host alias                                  |
| `gitrole remove <name>`                                                                             | Remove a saved role profile                                                         |

## Diagnosis policy

`gitrole` warns on violated expectations, not assumptions.

- `githubUser` checks the resolved SSH auth user
- `githubHost` checks the remote host alias
- remote owner and repository are context by default
- `overall=warning` only happens when at least one actionable check is `warn`

## What it does not do

- No GitHub browser or session switching
- No `gh auth`, HTTPS credentials, or token management
- No hooks, auto-switching, or workflow enforcement
- No interactive prompts

## License

MIT
