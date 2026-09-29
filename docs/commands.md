---
layout: layouts/base.njk
title: gitrole Commands Reference
eyebrow: Reference
summary: Reference for gitrole CLI commands for saved roles, Git identity switching, SSH push alignment, diagnosis, and repo-local policy.
---

<p>You usually need one command: save an identity, switch this repo to it, or check it before you commit. This page is that lookup. The walkthrough is <a href="{{ '/guides/use-the-right-git-identity-for-this-repo/' | url }}">Use the right Git identity for this repo</a>.</p>

<h2 id="quick-start">Quick start</h2>

<p>Save a role, apply it only in this repository, and check. If <code>gitrole status</code> looks aligned, you can stop.</p>

```bash
gitrole add work --name "Alex Developer" --email "alex@work.example"
gitrole use work --local
gitrole status
```

<p><code>use --local</code> writes the name and email in this repo, so your other repositories stay on the global identity. <code>gitrole doctor</code> is the longer explanation when a check is wrong.</p>

<h2 id="how-to-read-a-check">How to read a check</h2>

<p><code>gitrole current</code> answers which saved role matches the commit identity. <code>gitrole status</code> answers whether the repo looks ready to commit and push. <code>gitrole status --short</code> is that same check on one line. Read <code>overall</code> by name. It is the eighth field. <code>overall=aligned</code> exits <code>0</code>. <code>overall=warning</code> exits <code>2</code> and still prints the line. Exit <code>1</code> is a failure, with the error on stderr and nothing on stdout.</p>

<p>Add <code>--offline</code> when you don't want the live SSH probe, which is what a shell prompt needs. <a href="{{ '/guides/show-gitrole-in-your-shell-prompt/' | url }}"><code>gitrole-prompt</code></a> turns <code>gitrole status --short --offline</code> into a prompt segment. <code>gitrole:work ✓</code> means commit and policy are ok and auth was not checked. Field names and exit codes are in <a href="{{ '/machine-readable-contracts/' | url }}">Machine Readable Contracts</a>.</p>

<h2 id="surprises">Surprises</h2>

<p>Installing gitrole doesn't turn on shell completion. You add the script yourself. Optional shell tab completion for these commands and for saved role names is documented in <a href="{{ '/guides/enable-shell-tab-completion/' | url }}">Enable shell tab completion</a>.</p>

<p><code>gitrole import current</code> saves the name and email Git is already using. It doesn't switch the repo, and it doesn't copy an SSH key. <code>gitrole pin</code> writes a new <code>.gitrole</code> file and refuses to overwrite one that already exists, so a second pin can't silently widen the allowed roles.</p>

<h2 id="command-list">Command list</h2>

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
  <dd>Show the one-line machine-friendly alignment check. Add <code>--offline</code> to skip the live SSH probe.</dd>

  <dt><code>gitrole doctor</code></dt>
  <dd>Explain commit identity, remote configuration, and SSH auth alignment in more detail.</dd>

  <dt><code>gitrole doctor --json</code></dt>
  <dd>Return the full diagnosis as structured JSON.</dd>

  <dt><code>gitrole remote set &lt;name&gt;</code></dt>
  <dd>Rewrite <code>origin</code> to the GitHub SSH host alias configured for the saved role.</dd>

  <dt><code>gitrole remove &lt;name&gt;</code></dt>
  <dd>Remove a saved role profile.</dd>
</dl>

<h2 id="what-it-does-not-do">What these commands don't do</h2>

<p>None of them switch your GitHub browser session, store an HTTPS token, or install a hook for you. The optional check-only hook is a file you copy yourself. It runs <code>gitrole status --short</code>.</p>
