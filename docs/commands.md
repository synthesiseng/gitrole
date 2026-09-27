---
layout: layouts/base.njk
title: gitrole Commands Reference
eyebrow: Reference
summary: Reference for gitrole CLI commands for saved roles, Git identity switching, SSH push alignment, diagnosis, and repo-local policy.
---

<h2 id="command-list">Command list</h2>

<p>For the public machine-readable output contracts, see <a href="{{ '/machine-readable-contracts/' | url }}">Machine Readable Contracts</a>.</p>

<p>Optional shell tab completion for these commands and for saved role names is documented in <a href="{{ '/guides/enable-shell-tab-completion/' | url }}">Enable shell tab completion</a>. Completion is not installed automatically.</p>

<dl class="command-list">
  <dt><code>gitrole add &lt;name&gt; --name "..." --email "..." [--ssh ...] [--github-user ...] [--github-host ...]</code></dt>
  <dd>Create or update a saved role profile.</dd>

  <dt><code>gitrole import current --name &lt;role&gt;</code></dt>
  <dd>Save the effective current commit identity as a named role. <code>--name &lt;role&gt;</code> is required. See <a href="{{ '/guides/import-the-current-git-identity/' | url }}">Import the current Git identity</a>.</dd>

  <dt><code>gitrole use &lt;name&gt; [--global | --local]</code></dt>
  <dd>Apply a saved role globally or only in the current repository.</dd>

  <dt><code>gitrole pin &lt;role&gt;</code></dt>
  <dd>Create a strict repo-local <code>.gitrole</code> policy for one role.</dd>

  <dt><code>gitrole resolve</code></dt>
  <dd>Print the repo-local default role from <code>.gitrole</code>.</dd>

  <dt><code>gitrole resolve --json</code></dt>
  <dd>Write the repo policy as JSON.</dd>

  <dt><code>gitrole current</code></dt>
  <dd>Show which saved role matches the active commit identity.</dd>

  <dt><code>gitrole list</code></dt>
  <dd>List all saved roles and mark the active one when there is a match.</dd>

  <dt><code>gitrole status</code></dt>
  <dd>Check whether the current repository is aligned for commit and push.</dd>

  <dt><code>gitrole status --short</code></dt>
  <dd>Show the one-line machine-friendly alignment check. Add <code>--offline</code> to skip the live SSH probe. <a href="{{ '/guides/show-gitrole-in-your-shell-prompt/' | url }}"><code>gitrole-prompt</code></a> turns <code>gitrole status --short --offline</code> into a shell prompt segment.</dd>

  <dt><code>gitrole doctor</code></dt>
  <dd>Explain commit identity, remote configuration, and SSH auth alignment in more detail.</dd>

  <dt><code>gitrole doctor --json</code></dt>
  <dd>Return the full diagnosis as structured JSON.</dd>

  <dt><code>gitrole remote set &lt;name&gt;</code></dt>
  <dd>Rewrite <code>origin</code> to the GitHub SSH host alias configured for the saved role.</dd>

  <dt><code>gitrole remove &lt;name&gt;</code></dt>
  <dd>Remove a saved role profile.</dd>
</dl>
