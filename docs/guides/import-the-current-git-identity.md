---
layout: layouts/base.njk
title: Import the current Git identity
eyebrow: Guide
summary: Save the effective current commit identity as a named role with gitrole import current --name <role> when Git is already configured.
order: 2
---

<p>Git is already using the name and email you want, and typing them into <code>gitrole add</code> is how a typo creates a second role. Import saves that current commit identity under a name you choose. If you still need to type a new name, email, SSH key, or GitHub host, start with <a href="{{ '/guides/use-the-right-git-identity-for-this-repo/' | url }}">Use the right Git identity for this repo</a> and <code>gitrole add</code> instead.</p>

<h2 id="quick-start">Quick start</h2>

<p>In the repository whose identity you want to keep:</p>

```bash
gitrole import current --name work
```

<p><code>--name</code> is required. This run had a repo-local name and email, so the scope is <code>local</code>:</p>

```text
imported current identity as work
  commit Alex Developer <alex@work.example>
  scope local
```

<p>If that line shows the name and email you expected, you can stop. Saving the role doesn't switch Git config. Run <code>gitrole use work --local</code> when you want this repository to use the saved role.</p>

<h2 id="how-to-read-the-result">How to read the result</h2>

<p>The first line is the role name you passed. <code>commit</code> is the name and email that were saved. <code>scope</code> says where gitrole read them.</p>

<p><code>scope local</code> means at least one of <code>user.name</code> or <code>user.email</code> is set in this repository. Each field uses the repo-local value when it exists, and the global value otherwise. That's why a repo that only overrides the email still reports <code>local</code>: the commit would use that local email.</p>

<p>With no repo-local name or email, the same command reports <code>scope global</code> and saves the global identity:</p>

```text
imported current identity as maintainer-personal
  commit Maintainer Name <maintainer@personal.example>
  scope global
```

<p>Confirm with <code>gitrole current</code> or <code>gitrole list</code>. When the repository should prefer that role, continue with <a href="{{ '/guides/use-repo-local-identity-policy-with-gitrole/' | url }}">Use repo-local identity policy with .gitrole</a>.</p>

<h2 id="surprises">Surprises</h2>

<p>Import saves only the name and email. It doesn't infer an SSH key, a GitHub user, or a GitHub host, because those aren't part of the commit identity Git is about to use. Add them later with <code>gitrole add</code> if pushes need them.</p>

<p>If the role name already exists, import replaces that saved role with the current name and email only. SSH and GitHub fields that were stored on the old role are not kept. The command writes the role it read, rather than merging with the previous profile, so a stale host alias can't linger next to a new email.</p>

<p><code>no-role</code> matches the shape of a role name, and it is still reserved. <code>gitrole status --short</code> writes <code>role=no-role</code> when nothing saved matches, so a real role with that name would look like "no role." The command exits <code>1</code>, writes this to stderr, and prints nothing on stdout:</p>

```text
error: role name "no-role" is reserved for the status and prompt sentinel when no saved role matches; choose a different name
```

<h2 id="what-it-does-not-do">What it doesn't do</h2>

<p>Import doesn't change Git config, switch you to the new role, rewrite <code>origin</code>, or install a hook. It only writes the saved role.</p>

<h2 id="when-it-fails">When it fails</h2>

<p>The role name uses the same rules as <code>gitrole add</code>: lowercase letters, numbers, <code>-</code>, and <code>_</code>. An invalid name fails before anything is saved. The command exits <code>1</code>, writes the error to stderr, and prints nothing on stdout:</p>

```text
error: invalid role name "client acme"; use lowercase letters, numbers, "-" or "_"
```

<p>Both <code>user.name</code> and <code>user.email</code> have to be configured on the identity gitrole reads. If either is missing, import exits <code>1</code> and prints nothing on stdout:</p>

```text
error: current commit identity is incomplete; user.name and user.email must both be configured
```
