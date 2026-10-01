---
layout: layouts/base.njk
title: gitrole Commands Reference
eyebrow: Reference
summary: Reference for gitrole CLI commands for saved roles, Git identity switching, SSH push alignment, diagnosis, and repo-local policy.
---

<p>You usually need one command: save an identity, switch this repo to it, or check it before you commit. This page is that lookup. The walkthrough is <a href="{{ '/guides/use-the-right-git-identity-for-this-repo/' | url }}">Use the right Git identity for this repo</a>.</p>

<p>For installation and a first run, use <a href="{{ '/guides/install-and-update-gitrole/' | url }}">Install and update</a> and <a href="{{ '/guides/use-the-right-git-identity-for-this-repo/' | url }}">the first-use guide</a>. For output fields, provenance and exit codes, use <a href="{{ '/machine-readable-contracts/' | url }}">Machine-readable contracts</a>.</p>

<h2 id="command-list">Command list</h2>

<dl class="command-list">
  <dt><code>gitrole add &lt;name&gt; --name "..." --email "..." [--ssh ...] [--github-user ...] [--github-host ...]</code></dt>
  <dd>Create or replace a saved role profile; include all optional fields you intend to keep. Empty or whitespace-only full names and emails are rejected before changing saved roles.</dd>

  <dt><code>gitrole import current --name &lt;role&gt;</code></dt>
  <dd>Save Git’s effective current author name and email as a named role. <code>--name &lt;role&gt;</code> is required. See <a href="{{ '/guides/import-the-current-git-identity/' | url }}">Import the current Git identity</a>.</dd>

  <dt><code>gitrole use &lt;name&gt; [--global | --local]</code></dt>
  <dd>Apply a saved role globally (the default) or only in the current repository with <code>--local</code>. A saved role with an empty or whitespace-only full name or email is rejected before changing Git config or loading an SSH key. A saved SSH key may be loaded with <code>ssh-add</code>.</dd>

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
  <dd>Check current author/committer identity, policy, and every resolved default push destination. Alignment does not prove push success.</dd>

  <dt><code>gitrole status --short</code></dt>
  <dd>Show the one-line machine-friendly alignment check. Add <code>--offline</code> to <code>status</code> to invoke no SSH commands, including configuration inspection. <code>doctor</code> does not accept that flag. Local HTTPS pin checks still apply.</dd>

  <dt><code>gitrole doctor</code></dt>
  <dd>Explain commit identity, remote configuration, and SSH auth alignment in more detail. Also warn about every saved role with a blank full name or email, including inactive roles. Replace such a role with <code>gitrole add</code> using a valid identity, or remove it with <code>gitrole remove</code>; diagnosis does not rewrite saved roles or Git config.</dd>

  <dt><code>gitrole doctor --json</code></dt>
  <dd>Return the full diagnosis as structured JSON.</dd>

  <dt><code>gitrole remote set &lt;name&gt;</code></dt>
  <dd>Rewrite origin’s fetch URL to the saved GitHub SSH host alias, preserving its owner/repository. It does not change a separate push URL or another selected push remote.</dd>

  <dt><code>gitrole remove &lt;name&gt;</code></dt>
  <dd>Remove a saved role profile.</dd>
</dl>

<h2 id="what-it-does-not-do">What these commands don't do</h2>

<p>None of them switch your GitHub browser session, store an HTTPS token, or install a hook for you. The optional check-only hook is a file you copy yourself. It runs <code>gitrole status --short</code>.</p>

<p>Optional <a href="{{ '/guides/enable-shell-tab-completion/' | url }}">shell tab completion</a> completes commands and saved role names; installation does not enable it automatically.</p>
