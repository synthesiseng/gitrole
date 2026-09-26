---
layout: layouts/base.njk
title: Use gitrole as a Git identity preflight for agents and automation
eyebrow: Use case
summary: Check Git identity state before an agent commits or pushes by using status --short, doctor --json, and resolve --json in automation.
order: 2
---

<h2 id="when-to-use-this">When to use this</h2>

Use this page when an agent or automation should work under an existing role instead of using its own dedicated Git identity.

If you need the baseline one-repo setup first, start with <a href="{{ '/guides/use-the-right-git-identity-for-this-repo/' | url }}">Use the right Git identity for this repo</a>.

This is useful when:

- the repository already has a role like <code>work</code>, <code>personal</code>, or <code>client-acme</code>
- the agent should verify identity state before it commits or pushes
- you want a machine-readable preflight check in automation
- you want to catch the wrong role, host alias, or SSH account before a push happens

<h2 id="what-the-agent-should-check">What the agent should check</h2>

For automation, the goal is not to explain every detail. The goal is to answer one question before a write:

Is this repository about to use the identity I expect?

In practice, that means checking:

- the effective commit identity
- whether the role is applied locally or globally
- the repo's preferred role, when <code>.gitrole</code> exists
- whether the remote host matches the expected GitHub host alias
- whether SSH auth resolves to the expected GitHub user

<h2 id="run-a-fast-preflight-check">Run a fast preflight check</h2>

Use the one-line status view when you want a compact automation-friendly signal:

```bash
gitrole status --short
```

This is the right default when the agent only needs to know whether the repository looks aligned before it continues.

<h2 id="use-doctor-for-the-full-explanation">Use doctor for the full explanation</h2>

When the quick check is not clean, ask for the full diagnosis:

```bash
gitrole doctor --json
```

This is the better choice when an agent needs structured detail about:

- the active role
- local versus global config
- remote configuration
- SSH auth results
- the checks that actually triggered a warning

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

A practical automation flow looks like this:

```bash
gitrole resolve --json
gitrole use work --local
gitrole status --short
gitrole doctor --json
```

Use <code>resolve --json</code> when the repo should already say which role is preferred. Use <code>use</code> only if the automation is responsible for selecting the role. If the repository should already be configured, <code>status --short</code> is still the fast preflight, and <code>doctor --json</code> is the full explanation when that check is not clean.

<h2 id="when-to-use-this-vs-a-dedicated-agent-role">When to use this vs a dedicated agent role</h2>

Use this page when the automation should safely act under an existing role.

Use the dedicated agent identity flow when the automation should have its own:

- commit name and email
- SSH key
- GitHub account
- host alias

That is a different setup, and it belongs in <a href="{{ '/use-cases/give-an-agent-its-own-git-identity/' | url }}">Give an agent its own Git identity</a>.

If the repository should also declare which roles are preferred or allowed, pair this flow with <a href="{{ '/guides/use-repo-local-identity-policy-with-gitrole/' | url }}">Use repo-local identity policy with .gitrole</a>.
