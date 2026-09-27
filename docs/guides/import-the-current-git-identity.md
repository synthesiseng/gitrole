---
layout: layouts/base.njk
title: Import the current Git identity
eyebrow: Guide
summary: Save the effective current commit identity as a named role with gitrole import current --name <role> when Git is already configured.
order: 2
---

<h2 id="when-to-use-this">When to use this</h2>

Use this when Git is already configured correctly and you only want to save that identity as a role:

```bash
gitrole import current --name work
```

If you still need to type a new name, email, SSH key, or GitHub host, start with <a href="{{ '/guides/use-the-right-git-identity-for-this-repo/' | url }}">Use the right Git identity for this repo</a> and <code>gitrole add</code> instead.

<h2 id="command">Command</h2>

The signature is exactly:

```bash
gitrole import current --name <role>
```

<code>--name &lt;role&gt;</code> is required. <code>&lt;role&gt;</code> is the saved role name, such as <code>work</code>.

<h2 id="what-it-saves">What it saves</h2>

<code>gitrole import current</code> does four things:

<ul>
  <li>reads the effective current commit identity</li>
  <li>uses the repo-local identity when a local override is active</li>
  <li>otherwise uses the global identity</li>
  <li>saves only name and email</li>
</ul>

It does not infer SSH keys, GitHub users, or GitHub host aliases. It also does not change Git config. Saving the role and switching to a role are separate steps. Use <code>gitrole use</code> when you want to apply a saved role.

When a local <code>user.name</code> or <code>user.email</code> override is active, the reported scope is <code>local</code>:

```text
imported current identity as work
  commit Alex Developer <alex@work.example>
  scope local
```

When no local override is active, the same command reports <code>scope global</code> and saves the global name and email.

If the role name already exists, import replaces that saved role with the current name and email only. Previously stored SSH and GitHub fields on that role are not kept.

<h2 id="role-names">Role names</h2>

<code>&lt;role&gt;</code> uses the same rules as <code>gitrole add</code>: lowercase letters, numbers, <code>-</code>, and <code>_</code>. <code>no-role</code> is reserved for the status and prompt sentinel, so it cannot be saved.

An invalid name fails before anything is saved. The command exits <code>1</code>, writes the error to stderr, and prints nothing on stdout:

```text
error: invalid role name "client acme"; use lowercase letters, numbers, "-" or "_"
```

The reserved name fails the same way, with its own message:

```text
error: role name "no-role" is reserved for the status and prompt sentinel when no saved role matches; choose a different name
```

<h2 id="when-it-fails">When the current identity is incomplete</h2>

Both <code>user.name</code> and <code>user.email</code> must already be configured on the identity gitrole reads. If either is missing, import exits <code>1</code>, writes this to stderr, and prints nothing on stdout:

```text
error: current commit identity is incomplete; user.name and user.email must both be configured
```

<h2 id="after-import">After import</h2>

Run <code>gitrole current</code> or <code>gitrole list</code> to confirm the saved role. When a repository should prefer that role, continue with <a href="{{ '/guides/use-repo-local-identity-policy-with-gitrole/' | url }}">Use repo-local identity policy with .gitrole</a>.
