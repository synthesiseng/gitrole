---
layout: layouts/base.njk
title: Save and check your Git identity
eyebrow: Guide
summary: Install gitrole, apply a saved role, and understand the identity checks.
order: 0
---

Gitrole saves a Git name and email as a named **role**, applies that role to a repository or your global Git configuration, and checks the effective author and committer. It also observes the current default push destinations and supported SSH authentication.

<h2 id="quick-start">Start here</h2>

1. <a href="{{ '/guides/install-and-update-gitrole/' | url }}">Install and update gitrole</a>: choose npm or Homebrew and confirm the version.
2. <a href="{{ '/guides/use-the-right-git-identity-for-this-repo/' | url }}">Use the right Git identity for this repo</a>: save a role, apply it locally, and run the first check.
3. <a href="{{ '/guides/troubleshoot-identity-warnings/' | url }}">Troubleshoot identity warnings</a>: identify what a warning means and choose the next action.

The installation channels can publish different versions. The first-use guide includes the common HTTPS warning and the matching-pin exception; an applied role alone does not verify push credentials.

<h2 id="status-vs-doctor">Choose a check</h2>

| Command | Use it to |
| --- | --- |
| `gitrole current` | Find the saved role matching Git's effective author. |
| `gitrole status` | Read a concise identity and default push check. |
| `gitrole doctor` | Explain warnings and inspect each push destination. |
| `gitrole status --short --offline` | Read local checks without invoking SSH. HTTPS pin checks still apply. |

Exit `0` means aligned, `2` means warning, and `1` means the command failed. `auth=na` means authentication was skipped or does not apply; it does not prove credentials. No result guarantees a future commit's explicit author or a successful push.

<h2 id="keep-reading">Continue with a task</h2>

- <a href="{{ '/guides/import-the-current-git-identity/' | url }}">Import the current Git identity</a>: save the author Git already uses.
- <a href="{{ '/guides/use-repo-local-identity-policy-with-gitrole/' | url }}">Use repo-local identity policy</a>: declare a default and allowed roles.
- <a href="{{ '/guides/show-gitrole-in-your-shell-prompt/' | url }}">Show gitrole in your shell prompt</a>: use a local check and understand shell limitations.
- <a href="{{ '/guides/enable-shell-tab-completion/' | url }}">Enable shell tab completion</a>: load optional completion scripts.
- <a href="{{ '/guides/verify-git-identity-before-an-agent-commits/' | url }}">Verify identity before an agent commits</a>: add check instructions to an authorized agent workflow.
- <a href="{{ '/use-cases/give-an-agent-its-own-git-identity/' | url }}">Give an agent its own Git identity</a>: apply an identity whose account, key, and alias already exist.
- <a href="{{ '/use-cases/fix-pushes-using-the-wrong-github-account/' | url }}">Fix pushes using the wrong GitHub account</a>: inspect the selected push remote and SSH context.
- <a href="{{ '/use-cases/use-gitrole-as-an-identity-preflight-for-agents-and-automation/' | url }}">Use gitrole as an identity preflight</a>: check an existing role in automation.

<h2 id="reference">Reference</h2>

Use <a href="{{ '/commands/' | url }}">Commands</a> for flags and side effects, and <a href="{{ '/machine-readable-contracts/' | url }}">Machine-readable contracts</a> for field vocabulary, JSON shapes, provenance, and exit codes.
