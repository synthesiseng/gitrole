---
layout: layouts/base.njk
title: Use gitrole as a Git identity preflight for agents and automation
eyebrow: Use case
summary: Check Git identity state before an agent commits or pushes with a local commit gate, separate push diagnosis, and machine-readable policy inspection.
order: 2
---

<h2 id="when-to-use-this">When to use this</h2>

Use this page when an agent or automation should work under an existing role instead of using its own dedicated Git identity.

If you need the baseline one-repo setup first, start with <a href="{{ '/guides/use-the-right-git-identity-for-this-repo/' | url }}">Use the right Git identity for this repo</a>.

Coding agents can load the skill shipped at <code>skills/gitrole/SKILL.md</code>. Install steps for Claude Code, Codex, and Cursor are in <a href="{{ '/guides/verify-git-identity-before-an-agent-commits/' | url }}">Verify Git identity before an agent commits</a>. The skill uses <code>gitrole check commit</code> as the commit gate and diagnoses pushes separately. It does not install hooks.

This is useful when:

- the repository already has a role like <code>work</code>, <code>personal</code>, or <code>client-acme</code>
- the agent should verify identity state before it commits or pushes
- you want a machine-readable preflight check in automation
- you want to catch the wrong role, host alias, or SSH account before a push happens

<h2 id="what-the-agent-should-check">Choose the check for the operation</h2>

Require gitrole 0.12.0 or newer with `check commit` support. Verify `gitrole --version` and `gitrole check commit --help` in the actual execution environment. Missing/unsupported CLI or unexpected results stop the workflow; do not upgrade automatically or substitute online status for the commit check.

<h2 id="run-a-fast-preflight-check">Ordinary commits</h2>

```bash
gitrole check commit
```

Exit `0` is quiet success. Exit `2` blocks on a mismatch; exit `1` blocks on required-data or operational failure. Failures explain the reason on stderr and leave stdout empty. A complete saved author identity, matching committer and compliance with any repository policy are required. Fresh repositories require local or worktree identity overrides. No remote, SSH, network or Keychain access is needed; no `--offline` or `--json` flag is accepted. Missing remotes, HTTPS warnings or unverified SSH are separate push concerns.

<h2 id="use-doctor-for-the-full-explanation">Diagnose commit problems offline</h2>

```bash
gitrole doctor --offline --json
```

Read `commitIdentity`, `committerIdentity`, `overall` and `checks[].status`/`checks[].label`, not message text. `configuredIdentity` is raw configuration. `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, and `GIT_COMMITTER_EMAIL` can override configuration; present config keys do not prove alignment.

Doctor is not a substitute for the commit gate. Missing history in a fresh repository or remote/auth warnings can coexist with a passing local check. Keep doctor's warnings and exit unchanged; do not filter them into a fabricated pass. Investigate identity/policy problems and errors, then rerun `check commit`. Do not create a commit just to silence a history warning.

A standalone check cannot validate the author normally retained by `git commit --amend`, a later explicit `--author`, reused author or later configuration/environment change. Inspect the actual intended author and committer against the approved role/policy, clarify intent where needed and recheck in the actual context. Stop if it cannot be established; do not silently reset authorship or install a hook.

<h2 id="push-checks">Push diagnosis</h2>

Determine the intended push command and destination first. For the default push context, use `gitrole status --short`, with `gitrole doctor --json` for structured diagnosis when online inspection is appropriate. Status exit `2` or any warning stops the push; exit `1`, malformed output or unexpected results also stop it. Only exit `0` with `overall=aligned` reports default-context alignment. `check commit` cannot approve pushes.

All eight fields and exits remain unchanged. Status observes every resolved default push URL, independently of fetch origin; it has no explicit-destination override option. Do not infer that it verifies a requested remote, URL, refspec or other explicit push arguments. Inspect actual push URLs, rewrites and intent separately; stop if the requested context is not covered. No result proves push permission or success.

HTTPS pin checks and unverified SSH warnings remain meaningful. `auth=na` does not verify credentials. Online checks may execute configured SSH commands, including `Match exec`, or contact the network. Offline doctor is available when that is inappropriate but cannot verify live authentication. Ask the human to run any needed `gitrole auth test` in a terminal; never run it automatically.

<h2 id="read-repo-policy-with-resolve-json">Read repo policy with resolve --json</h2>

When the repository declares a preferred role in <code>.gitrole</code>, read that policy before the agent chooses an identity:

```bash
gitrole resolve --json
```

A valid policy is JSON on stdout. <code>defaultRole</code> is the preferred role. <code>allowedRoles</code> lists every role that is valid in this repo, and it always includes <code>defaultRole</code>:

```json
{
  "version": 1,
  "defaultRole": "work",
  "allowedRoles": ["work"]
}
```

Success exits <code>0</code>. If <code>.gitrole</code> is missing, is not valid policy, or uses a <code>defaultRole</code> or <code>allowedRoles</code> name outside lowercase letters, numbers, <code>-</code>, and <code>_</code>, the command exits <code>1</code>, writes the error to stderr, and prints no JSON. Treat that as a failed preflight. Do not continue as if the repo has no policy.

The field contract and the exact failure cases are in <a href="{{ '/machine-readable-contracts/' | url }}">Machine Readable Contracts</a>.

<h2 id="a-practical-flow">A practical flow</h2>

For an already configured repository, run `gitrole check commit` and use offline doctor only if diagnosis is needed. Where policy is expected, inspect it with `gitrole resolve --json`; missing/invalid policy is not permission to choose one.

The user must choose the intended role and approve any `gitrole use`, `gitrole pin`, `gitrole remote set`, identity/configuration edits or hook changes. Never silently switch globally. Only after that approval, apply the specified correction and repeat the check for the intended operation. Do not run repair commands just because a diagnostic suggests them.

<h2 id="when-to-use-this-vs-a-dedicated-agent-role">When to use this vs a dedicated agent role</h2>

Use this page when the automation should safely act under an existing role.

Use the dedicated agent identity flow when the automation should have its own:

- commit name and email
- SSH key
- GitHub account
- host alias

That is a different setup, and it belongs in <a href="{{ '/use-cases/give-an-agent-its-own-git-identity/' | url }}">Give an agent its own Git identity</a>.

If the repository should also declare which roles are preferred or allowed, pair this flow with <a href="{{ '/guides/use-repo-local-identity-policy-with-gitrole/' | url }}">Use repo-local identity policy with .gitrole</a>.
