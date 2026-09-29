---
layout: layouts/base.njk
title: Use repo-local identity policy with .gitrole
eyebrow: Guide
summary: Use .gitrole to declare the preferred Git identity role for a repository and the small set of roles that are allowed there.
order: 3
---

<p>A shared repository doesn't say which Git identity belongs there, so a personal role can look fine until the history is full of the wrong author. A <code>.gitrole</code> file in the repo root names the role you normally want and the short list of roles that are still allowed. It doesn't switch you, install a hook, or block a commit. If you haven't saved a role yet, start with <a href="{{ '/guides/use-the-right-git-identity-for-this-repo/' | url }}">Use the right Git identity for this repo</a>.</p>

<h2 id="pin-a-repo-to-one-role">Pin a repo to one role</h2>

<p>When one saved role is the one this repo should use, pin it:</p>

```bash
gitrole pin company-main
```

<p>That writes <code>.gitrole</code> and prints:</p>

```text
pinned role company-main
  file  .gitrole
  default company-main
  allowed company-main
```

<p>The file on disk is:</p>

```json
{
  "version": 1,
  "defaultRole": "company-main",
  "allowedRoles": [
    "company-main"
  ]
}
```

<p>Check it:</p>

```bash
gitrole resolve
```

```text
company-main
```

<p>If <code>resolve</code> prints that name, you can stop. <code>defaultRole</code> has to be in <code>allowedRoles</code>. Pin puts the same role in both, so you don't have a preferred role that the file then rejects.</p>

<p>If <code>.gitrole</code> already exists, pin exits <code>1</code> and leaves the file alone. A second run can't merge or widen the list by accident:</p>

```text
error: .gitrole already exists in this repo; gitrole pin will not overwrite or merge existing repo policy
```

<h2 id="how-to-read-status">How to read status</h2>

<p>When <code>.gitrole</code> exists, <code>gitrole status</code> and <code>gitrole doctor</code> add the policy on top of the commit, remote, and SSH checks. Allowed-but-not-default stays aligned. The role is on the list, so it isn't a warning, and the default is still visible so you can see it isn't the preferred one.</p>

<p>This is <code>gitrole status</code> when the file prefers <code>company-main</code>, also allows <code>maintainer-personal</code>, and the global identity matches <code>maintainer-personal</code>:</p>

```text
maintainer-personal  aligned
  commit Maintainer Name <maintainer@personal.example>
  push  maintainer via github.com-personal
  scope global
  policy allowed role maintainer-personal (default: company-main)
```

<p>The same repo on one line is <code>policy=ok</code> and <code>overall=aligned</code>. <code>policy=ok</code> on <code>gitrole status --short</code> means the effective role is <code>defaultRole</code> or is listed in <code>allowedRoles</code>. It does not mean the role is the default:</p>

```text
role=maintainer-personal scope=global override=false commit=ok remote=ok auth=ok policy=ok overall=aligned
```

<p><code>gitrole doctor</code> uses a different word for that case. The policy check is <code>info</code>, not <code>warn</code>, because <code>info</code> doesn't select <code>overall=warning</code>:</p>

```text
  info policy effective role maintainer-personal is allowed here, but repo defaultRole is company-main
```

<p>On <code>status --short</code>, <code>policy=warn</code> and exit <code>2</code> only when the effective role is outside <code>allowedRoles</code>. <code>policy=na</code> means there is no <code>.gitrole</code> file. A missing file doesn't make <code>status</code> or <code>doctor</code> fail. <code>resolve</code> does fail when the file is absent, because that command's only job is to read it.</p>

<h2 id="surprises">Surprises</h2>

<p><code>defaultRole</code> and every <code>allowedRoles</code> entry use the same role-name rules as a saved role: lowercase letters, numbers, <code>-</code>, and <code>_</code>. <code>company-main</code> and <code>agent_bot</code> are valid. <code>client acme</code>, <code>Work</code>, <code>Client</code>, and <code>no-role</code> are not. <code>no-role</code> is reserved because <code>status --short</code> writes it when no saved role matches.</p>

<p>An invalid name doesn't warn and continue. These commands exit <code>1</code>, write the error to stderr, and print nothing on stdout, including <code>gitrole status --short</code>. The line isn't written until the policy loads, so a bad name can't show up as a <code>role=</code> value:</p>

<ul>
  <li><code>gitrole resolve</code></li>
  <li><code>gitrole resolve --json</code></li>
  <li><code>gitrole status</code></li>
  <li><code>gitrole status --short</code></li>
  <li><code>gitrole doctor</code></li>
  <li><code>gitrole doctor --json</code></li>
</ul>

<h2 id="what-it-does-not-do">What it doesn't do</h2>

<p>The file doesn't switch roles, install a hook, or block <code>git commit</code>. It tells <code>status</code> and <code>doctor</code> whether the current role is the one this repo asked for. If an agent should read that before it commits, continue with <a href="{{ '/use-cases/use-gitrole-as-an-identity-preflight-for-agents-and-automation/' | url }}">Use gitrole as an identity preflight for agents and automation</a>.</p>

<h2 id="the-file-format">File format</h2>

<p>Edit the file when more than one role is valid. This one prefers <code>company-main</code> and also allows <code>maintainer-personal</code>. <code>gitrole resolve --json</code> prints the same object:</p>

```json
{
  "version": 1,
  "defaultRole": "company-main",
  "allowedRoles": [
    "company-main",
    "maintainer-personal"
  ]
}
```

<table>
  <thead>
    <tr><th>Field</th><th>Meaning</th></tr>
  </thead>
  <tbody>
    <tr><td><code>version</code></td><td>Schema version. Currently <code>1</code>.</td></tr>
    <tr><td><code>defaultRole</code></td><td>The role that normally belongs in this repo. It also has to appear in <code>allowedRoles</code>.</td></tr>
    <tr><td><code>allowedRoles</code></td><td>Roles that are still valid here.</td></tr>
  </tbody>
</table>

<p>On <code>gitrole doctor --json</code>, that evaluation is <code>repoPolicy.status</code>: <code>default</code>, <code>allowed</code>, or <code>notAllowed</code>. <code>default</code> and <code>allowed</code> are <code>policy=ok</code> on <code>status --short</code>. <code>notAllowed</code> is <code>policy=warn</code>. The exit codes and the exact failure text are in <a href="{{ '/machine-readable-contracts/' | url }}">Machine Readable Contracts</a>.</p>

<h2 id="invalid-role-names-fail-closed">Invalid names</h2>

<p>A <code>defaultRole</code> of <code>client acme</code> looks like this on stderr:</p>

```text
error: repo policy file .gitrole is invalid: defaultRole invalid role name "client acme"; use lowercase letters, numbers, "-" or "_"
```

<p>An invalid allowed role is named on that field. With <code>defaultRole</code> set to <code>work</code> and <code>Client</code> in <code>allowedRoles</code>:</p>

```text
error: repo policy file .gitrole is invalid: allowedRoles invalid role name "Client"; use lowercase letters, numbers, "-" or "_"
```

<p>A missing <code>.gitrole</code> file is not this failure. <code>resolve</code> still exits <code>1</code> when the file is absent. <code>status</code> and <code>doctor</code> keep working, with <code>policy=na</code> on <code>status --short</code>.</p>
