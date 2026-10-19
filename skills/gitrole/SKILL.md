---
name: gitrole
description: Use Gitrole to save or select Git identities, inspect repository identity policy, check authorship before commits, and diagnose pushes using the wrong account. Applies to first commits and amend requests; keeps local commit checks separate from network authentication.
compatibility: Requires gitrole 0.12.0 or newer on PATH with check commit support.
---

# Gitrole workflows

Preserve the user’s intended identity, repository, and action. This skill supplies guidance, not authorization to commit, push, change configuration, or rewrite history.

## Check availability

In the agent’s actual execution environment, check `gitrole --version` and `gitrole check commit --help`. Help must describe the local commit check, not generic help from an older CLI. If missing, unsupported, or failing, stop and report the command and error. Do not install or upgrade the CLI automatically or change PATH. Do not fall back to online status as a commit gate. Skill and CLI versions can differ.

## Read only the workflow needed

- Save/import an identity, switch this repository’s role, or inspect/repair `.gitrole`: read [identity and policy](references/identity-and-policy.md). Saving, switching, and pinning are separate actions.
- Make an ordinary or first commit, diagnose its identity failure, or amend/reuse an author: read [commit preflight](references/commit-preflight.md). Use `gitrole check commit` as the local commit gate and `gitrole doctor --offline --json` for diagnosis. Amend authors need separate verification.
- Diagnose the wrong push account or prepare an authorized push: read [push diagnosis](references/push-diagnosis.md). `gitrole status --short` checks default push context; it does not authorize arbitrary push arguments.

Do not load all references for every task. Local identity work does not require network authentication. If the task crosses workflows, load the next reference when needed.

## Keep changes deliberate

The user must choose the intended role and approve corrections. A diagnostic suggestion is not permission to run `gitrole use`, `gitrole pin`, `gitrole remote set`, or change credentials, settings, hooks, or history. Never switch globally to silence a warning. Apply only approved repairs, then repeat the relevant check in the environment used for the intended action. Stop on a failed or unverified required check; report the blocker rather than bypassing it.
