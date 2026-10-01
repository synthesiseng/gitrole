---
layout: layouts/base.njk
title: Use the right Git identity for this repo
eyebrow: Guide
summary: Save a role, apply it locally, and understand the first identity check.
order: 1
---

Start with <a href="{{ '/guides/install-and-update-gitrole/' | url }}">Install and update gitrole</a> if `gitrole` is not installed. Run the following commands inside the repository you want to configure. Replace the example name and email with yours.

<h2 id="step-1-save-a-role">1. Save a role</h2>

```bash
gitrole add work --name "Alex Developer" --email "alex@work.example"
```

`add` saves a named profile. It does not change this repository's Git configuration. If Git already uses the author you want, you can <a href="{{ '/guides/import-the-current-git-identity/' | url }}">import the current Git identity</a> instead.

<h2 id="step-2-switch-this-repo">2. Apply the role to this repository</h2>

```bash
gitrole use work --local
```

The success output is:

```text
switched to work
  scope local
  commit Alex Developer <alex@work.example>
```

An additional repo note may ask you to run `gitrole status`. Local scope writes this repository's `user.name` and `user.email`. Environment overrides or higher-precedence Git settings can still change the effective author or committer; the next check reads what Git actually resolves.

<h2 id="step-3-check-the-repo">3. Check the result</h2>

```bash
gitrole current
gitrole status --short --offline
```

`current` shows the saved role matching Git's effective author. The status line checks the author and committer, default push destinations, and repo policy. `--offline` runs no SSH commands, including configuration inspection.

A common first-use result in an HTTPS repository with no `.gitrole` policy is:

```text
role=work scope=local override=true commit=ok remote=ok auth=warn policy=na overall=warning
```

This exits `2`. The role was applied successfully; `auth=warn` means the HTTPS identity expectation still needs attention. Offline mode retains that local HTTPS check.

<h2 id="https">4. Decide the HTTPS identity policy</h2>

Gitrole does not inspect or manage HTTPS credentials. If this repository should use `work`, save the expected GitHub username and pin the role:

```bash
gitrole add work --name "Alex Developer" --email "alex@work.example" --github-user alex-work
gitrole pin work
gitrole status --short --offline
```

Use your actual username. `add` replaces the saved profile, so include any SSH or host fields you intend to keep. `pin` creates a strict `.gitrole` policy and refuses to overwrite an existing one. Review an existing policy instead of rerunning `pin`.

For the HTTPS destination above, with a matching role and no other warning, the result becomes:

```text
role=work scope=local override=true commit=ok remote=ok auth=na policy=ok overall=aligned
```

This exits `0`. Here `auth=na` means the matching pin allows the role and its saved GitHub username is present. It **does not verify your HTTPS account, credentials, repository access, or push success**. Decide whether to share `.gitrole` with your team before committing it.

<h2 id="ssh">If you use SSH</h2>

An SSH key, GitHub account, and host alias must already be configured outside gitrole. To save those expectations, include `--ssh`, `--github-user`, and `--github-host` in `gitrole add`; see <a href="{{ '/use-cases/fix-pushes-using-the-wrong-github-account/' | url }}">Fix pushes using the wrong GitHub account</a>.

Run `gitrole status` or `gitrole doctor` for an online check of supported SSH authentication. Online configuration inspection may execute configured `Match exec` commands or DNS lookups. Custom wrappers, interactive authentication, and incomplete SSH contexts remain unverified and warn.

<h2 id="if-status-shows-warning">If a warning remains</h2>

```bash
gitrole doctor
```

Read the warning labels, then use <a href="{{ '/guides/troubleshoot-identity-warnings/' | url }}">Troubleshoot identity warnings</a>. Inspect `repository.push.remoteName` and every `repository.push.targets` entry in `gitrole doctor --json` before changing remotes. The selected push remote or an explicit push URL can differ from origin's fetch URL. `gitrole remote set work` changes origin's fetch URL only; use it only when that URL supplies the effective push destination you intend to change.

<h2 id="why-status-can-still-mention-the-old-identity">An older author in the history line</h2>

The last non-merge commit describes existing history. Applying a role does not rewrite it. Check the current `commit` identity separately.

<h2 id="when-to-use-local-vs-global">Local and global scope</h2>

Use `gitrole use work --local` for this repository. `gitrole use work --global` changes your global Git identity; `use work` defaults to global scope. Local/worktree settings and environment overrides may still take precedence.

<h2 id="next">Daily use and reference</h2>

Run `gitrole status` before work that needs an identity check and `gitrole doctor` to explain warnings. An aligned result is a snapshot; future `--author`, explicit push arguments, or changed configuration/environment require reconsidering the check. It does not prove refspec readiness or authorize a commit or push.

Continue with <a href="{{ '/guides/use-repo-local-identity-policy-with-gitrole/' | url }}">repo-local identity policy</a>, <a href="{{ '/commands/' | url }}">Commands</a>, or <a href="{{ '/machine-readable-contracts/' | url }}">Machine-readable contracts</a>.
