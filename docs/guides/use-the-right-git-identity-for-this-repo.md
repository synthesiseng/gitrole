---
layout: layouts/base.njk
title: Use the right Git identity for this repo
eyebrow: Guide
summary: Save a Git identity role, switch a repository to it, and verify that commits and SSH pushes use the expected account.
order: 1
---

<h2 id="what-this-guide-does">What this guide does</h2>

Use this guide if you are new to <code>gitrole</code> and want one clear setup flow for a repository.

If the repository also needs an explicit policy for which roles are preferred or allowed, continue with <a href="{{ '/guides/use-repo-local-identity-policy-with-gitrole/' | url }}">Use repo-local identity policy with .gitrole</a> after this setup works.

By the end, you will know how to:

- save a role
- switch this repository to that role
- check whether the repo is aligned
- fix the remote if pushes still use the wrong GitHub account

<h2 id="current-vs-status">Current vs status</h2>

These two commands answer different questions:

- <code>gitrole current</code> = "which saved role am I here?"
- <code>gitrole status</code> = "does this repo look right for commit and push?"

Use <code>current</code> when you want to know which role matches the active commit identity.
Use <code>status</code> when you want the broader repo-alignment check.

<h2 id="step-1-save-a-role">Step 1: Save a role</h2>

Start by saving the identity you want to use in this repository.

Minimum version:

```bash
gitrole add work \
  --name "Work Name" \
  --email "you@work.example"
```

If this identity also has its own SSH key and GitHub account, use the fuller version instead:

```bash
gitrole add work \
  --name "Work Name" \
  --email "you@work.example" \
  --ssh ~/.ssh/id_work \
  --github-user your-work-user \
  --github-host github.com-work
```

What those extra flags mean:

- <code>--ssh</code> points to the SSH key for that identity
- <code>--github-user</code> is the GitHub user you expect SSH auth to resolve to
- <code>--github-host</code> is the SSH host alias you expect the repo remote to use

If Git is already using the identity you want, you can save it without retyping the name and email. See <a href="{{ '/guides/import-the-current-git-identity/' | url }}">Import the current Git identity</a>.

<h2 id="step-2-switch-this-repo">Step 2: Switch this repo to that role</h2>

Use <code>--local</code> when you want this repository to use that role without changing the rest of your machine:

```bash
gitrole use work --local
```

Example output:

```text
switched to work
  scope local
  name  Work Name
  email you@work.example
```

That means the repository now uses the selected role for its local Git identity.

<h2 id="step-3-check-the-repo">Step 3: Check the repo</h2>

Run:

```bash
gitrole status
```

This is the fast daily check.

Clean example:

```text
work  Work Name <you@work.example>  local override  aligned
last non-merge commit  Work Name <you@work.example> - fix login form
```

That tells you:

- this repository is using the <code>work</code> role
- the role is applied locally in this repo
- the repo currently looks aligned
- the most recent non-merge commit was also authored with that identity

<h2 id="if-status-shows-warning">If status shows warning</h2>

Run:

```bash
gitrole doctor
```

Use <code>doctor</code> when you want the full explanation for the repo, remote, and SSH auth state.

A common first-time case looks like this:

- the commit identity was switched correctly
- the remote still points at the old SSH host alias
- SSH auth still resolves to the old GitHub account

In that case, update the remote:

```bash
gitrole remote set work
```

That rewrites <code>origin</code> to the GitHub host alias configured for the role.

Then run the checks again:

```bash
gitrole status
gitrole doctor
```

If you want the full wrong-account walkthrough, use <a href="{{ '/use-cases/fix-pushes-using-the-wrong-github-account/' | url }}">Fix pushes using the wrong GitHub account</a>.

<h2 id="why-status-can-still-mention-the-old-identity">Why status can still mention the old identity</h2>

Sometimes the repository is configured correctly now, but <code>status</code> still mentions the previous identity in the last commit line.

That usually means:

- the repo is using the new role now
- the most recent non-merge commit in history was created before you switched

That is normal. Make your next commit with the new identity, then run <code>gitrole status</code> again.

<h2 id="when-to-use-local-vs-global">When to use local vs global</h2>

Use local scope for repositories that should stay isolated:

```bash
gitrole use work --local
```

Use global scope only when you want to change your machine-wide default identity:

```bash
gitrole use work
```

If you work across personal, work, client, or open-source repositories, <code>--local</code> is usually the safer default.

<h2 id="simple-mental-model">Simple mental model</h2>

Think of <code>gitrole</code> as four small checks in order:

1. save a role
2. switch this repo to it
3. run <code>gitrole status</code>
4. if something looks wrong, run <code>gitrole doctor</code> and possibly <code>gitrole remote set &lt;role&gt;</code>

That is the basic workflow for a new user.

If the repository also needs an explicit policy for which roles are preferred or allowed, continue with <a href="{{ '/guides/use-repo-local-identity-policy-with-gitrole/' | url }}">Use repo-local identity policy with .gitrole</a> after this setup works.
