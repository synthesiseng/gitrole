---
layout: layouts/base.njk
title: Use repo-local identity policy with .gitrole
eyebrow: Guide
summary: Use .gitrole to declare the preferred Git identity role for a repository and the small set of roles that are allowed there.
order: 3
---

<h2 id="what-this-is">What this is</h2>

Use a root-level <code>.gitrole</code> file when a repository should say:

- "this role is the normal one here"
- "these roles are still okay here"

This is repo-local identity policy, not workflow automation.

If you have not done the normal role setup yet, start with <a href="{{ '/guides/use-the-right-git-identity-for-this-repo/' | url }}">Use the right Git identity for this repo</a> first. This guide is the next step when a repository should say which roles belong there.

It does not:

- switch roles for you
- install hooks
- block commits

It just gives the repo a small, clear identity rule.

<h2 id="pin-a-repo-to-one-role">Pin a repo to one role</h2>

If a repo should use exactly one saved role most of the time, this is the easiest path:

```bash
gitrole pin company-main
```

That creates a <code>.gitrole</code> file like this:

```json
{
  "version": 1,
  "defaultRole": "company-main",
  "allowedRoles": ["company-main"]
}
```

Think of <code>pin</code> as saying:

- this repo belongs to <code>company-main</code>
- do not guess
- do not allow extra roles unless someone edits the policy on purpose

If <code>.gitrole</code> already exists, <code>gitrole pin</code> fails on purpose. It will not merge, overwrite, or silently expand the policy.

<h2 id="the-file-format">The file format</h2>

The first version is intentionally small:

```json
{
  "version": 1,
  "defaultRole": "company-main",
  "allowedRoles": ["company-main", "maintainer-personal"]
}
```

What each field means:

- <code>defaultRole</code> is the role that normally belongs in this repo
- <code>allowedRoles</code> is the short list of roles that are still valid here

The default role must also appear in <code>allowedRoles</code>.

<code>defaultRole</code> and every <code>allowedRoles</code> entry must also be a valid role name: lowercase letters, numbers, <code>-</code>, and <code>_</code>. <code>company-main</code> and <code>agent_bot</code> are valid. <code>client acme</code>, <code>Work</code>, and <code>Client</code> are not.

<h2 id="resolve-the-default-role">Resolve the default role</h2>

Run this inside the repository:

```bash
gitrole resolve
```

If the repo has a valid <code>.gitrole</code> file, <code>resolve</code> prints the <code>defaultRole</code>.

Example:

```text
company-main
```

If you want the whole policy as JSON for scripts, prompts, or agents, use:

```bash
gitrole resolve --json
```

Example:

```json
{
  "version": 1,
  "defaultRole": "company-main",
  "allowedRoles": ["company-main", "maintainer-personal"]
}
```

If no <code>.gitrole</code> file exists, <code>resolve</code> fails clearly. <code>status</code> and <code>doctor</code> still work normally without repo policy.

An invalid role name is a different failure. See <a href="#invalid-role-names-fail-closed">Invalid role names fail closed</a>.

<h2 id="invalid-role-names-fail-closed">Invalid role names fail closed</h2>

If <code>defaultRole</code> or any <code>allowedRoles</code> entry is outside that name format, gitrole does not warn and continue. These commands exit <code>1</code>, write the error to stderr, and print nothing on stdout:

<ul>
  <li><code>gitrole resolve</code></li>
  <li><code>gitrole resolve --json</code></li>
  <li><code>gitrole status</code></li>
  <li><code>gitrole doctor</code></li>
  <li><code>gitrole doctor --json</code></li>
</ul>

A <code>defaultRole</code> of <code>client acme</code> looks like this on stderr:

```text
error: repo policy file .gitrole is invalid: defaultRole invalid role name "client acme"; use lowercase letters, numbers, "-" or "_"
```

An invalid allowed role is named the same way. With <code>defaultRole</code> set to <code>work</code> and <code>Client</code> in <code>allowedRoles</code>, stderr includes:

```text
error: repo policy file .gitrole is invalid: allowedRoles invalid role name "Client"; use lowercase letters, numbers, "-" or "_"
```

A missing <code>.gitrole</code> file does not do this. <code>resolve</code> still fails when the file is absent, but <code>status</code> and <code>doctor</code> keep working without repo policy. Valid names such as <code>client-acme</code> and <code>agent_bot</code> still succeed.

The machine-readable exit contract is in <a href="{{ '/machine-readable-contracts/' | url }}">Machine Readable Contracts</a>.

<h2 id="how-status-and-doctor-use-policy">How status and doctor use policy</h2>

When <code>.gitrole</code> exists, <code>gitrole status</code> and <code>gitrole doctor</code> add repo policy on top of the normal identity, remote, and SSH checks.

The policy states are simple:

- <code>ok</code>: the effective role matches <code>defaultRole</code>
- <code>info</code>: the effective role is allowed here, but it is not the default
- <code>warn</code>: the effective role is not in <code>allowedRoles</code>

Allowed-but-not-default does not degrade the repo to warning by itself.

<h2 id="shared-repo-example">Shared repo example</h2>

This is useful for a shared org repo where both the org identity and a maintainer's personal identity are valid:

```json
{
  "version": 1,
  "defaultRole": "company-main",
  "allowedRoles": ["company-main", "maintainer-personal"]
}
```

If you are currently using <code>maintainer-personal</code>, the repo can still be aligned.

Example status output:

```text
maintainer-personal  Maintainer Name <maintainer@personal.example>  global  aligned
repo policy  allowed role maintainer-personal (default: company-main)
```

Example doctor interpretation:

- remote and SSH auth can still be correct
- policy is surfaced as <code>info</code>, not <code>warn</code>, because the current role is allowed even though it is not the default

<h2 id="when-to-use-it">When to use it</h2>

Add <code>.gitrole</code> when a repository has an identity policy you want to make explicit, such as:

- a company repo that should normally use a work role
- a shared repo where more than one role is valid
- an open-source repo where a maintainer identity is allowed but not always the default

Keep it small.

Use <code>.gitrole</code> when you want the repo to answer two simple questions:

- what role is preferred here?
- is the current role allowed here?

If automation should read that policy before it commits or pushes, continue with <a href="{{ '/use-cases/use-gitrole-as-an-identity-preflight-for-agents-and-automation/' | url }}">Use gitrole as an identity preflight for agents and automation</a>.
