---
layout: layouts/base.njk
title: Switch your git identity in one command.
eyebrow: Overview
summary: Save named roles, switch per repo, and check that commit identity and push identity are actually aligned.
---

<div class="button-row">
  <a class="button button-primary" href="#quick-start">Try the quick start</a>
  <a class="button button-secondary" href="#keep-reading">Read the guides</a>
</div>

<h2 id="problem">What goes wrong</h2>

<p>If you move between work, personal, and client repositories, Git will commit or push as the wrong person and the history is annoying to fix later. gitrole saves each identity as a named role, switches this repository to one of them, and checks the commit identity and the push identity before you continue.</p>

<div class="card-grid">
  <div class="surface">
    <span class="eyebrow-inline">Wrong commits</span>
    <h3>Wrong-author commits</h3>
    <p>You meant to commit as your work identity, but Git used your personal name and email.</p>
  </div>
  <div class="surface">
    <span class="eyebrow-inline">Wrong pushes</span>
    <h3>Wrong-account pushes</h3>
    <p>The repo looks right locally, but your SSH setup pushes through the wrong GitHub account.</p>
  </div>
  <div class="surface">
    <span class="eyebrow-inline">Too much manual setup</span>
    <h3>Too much Git config switching</h3>
    <p>You keep editing <code>user.name</code>, <code>user.email</code>, or remotes by hand every time you change codebases.</p>
  </div>
</div>

<h2 id="quick-start">Quick start</h2>

<p>Install, save one role, apply it to this repository, and check. If <code>gitrole status</code> looks aligned, you can stop.</p>

```bash
brew install synthesiseng/tap/gitrole
```

<p>or with npm:</p>

```bash
npm install -g gitrole
```

<p>Then, in the repository:</p>

```bash
gitrole add work --name "Alex Developer" --email "alex@work.example"
gitrole use work --local
gitrole status
```

<p><code>add</code> saves a role named <code>work</code>. <code>use --local</code> writes that name and email only in this repository, so your other repos stay on the global identity. <code>status</code> tells you what the next commit will use.</p>

<p>The full first-time setup, including SSH, is in <a href="{{ '/guides/use-the-right-git-identity-for-this-repo/' | url }}">Use the right Git identity for this repo</a>. If pushes still go through the wrong GitHub account, use <a href="{{ '/use-cases/fix-pushes-using-the-wrong-github-account/' | url }}">Fix pushes using the wrong GitHub account</a>.</p>

<h2 id="status-vs-doctor">How to read a check</h2>

<p>These three commands answer different questions. Use <code>current</code> when you want the role name, <code>status</code> before you commit or push, and <code>doctor</code> when something is wrong and you need the reason.</p>

<div class="comparison-grid">
  <div class="surface">
    <span class="eyebrow-inline">Active role</span>
    <h3><code>gitrole current</code></h3>
    <p>Which saved role matches the active commit identity in this repo.</p>
  </div>
  <div class="surface">
    <span class="eyebrow-inline">Fast daily check</span>
    <h3><code>gitrole status</code></h3>
    <p>Does this repo look right for the next commit and the next push.</p>
  </div>
  <div class="surface">
    <span class="eyebrow-inline">Full explanation</span>
    <h3><code>gitrole doctor</code></h3>
    <p>Why a check warned, including commit identity, remote, and SSH auth.</p>
  </div>
</div>

<h2 id="surprises">Surprises</h2>

<p>A shell prompt can show <code>gitrole:work ✓</code>. That means commit and policy are ok and auth was not checked. The prompt runs <code>gitrole status --short --offline</code> so it doesn't open SSH on every redraw. Live auth is <code>gitrole doctor</code> or the optional check-only hook. Setup is in <a href="{{ '/guides/show-gitrole-in-your-shell-prompt/' | url }}">Show gitrole in your shell prompt</a>.</p>

<p>A coding agent will commit as whatever <code>GIT_AUTHOR_EMAIL</code> says, even when <code>user.email</code> looks right. The packaged skill tells Claude Code, Codex, or Cursor to run <code>gitrole status --short</code> and stop on a warning. It doesn't install a hook. See <a href="{{ '/guides/verify-git-identity-before-an-agent-commits/' | url }}">Verify Git identity before an agent commits</a>.</p>

<p>Installing gitrole doesn't turn on shell completion. You add the script yourself. See <a href="{{ '/guides/enable-shell-tab-completion/' | url }}">Enable shell tab completion</a>.</p>

<h2 id="keep-reading">Keep reading</h2>

<p>Use the main guide for the normal setup. Use a focused page when you have one problem.</p>

<div class="link-grid">
  <a class="reference-card" href="{{ '/guides/use-the-right-git-identity-for-this-repo/' | url }}">
    <div>
      <strong>Guide: Use the right Git identity for this repo</strong>
      <span>Start here if you want the normal setup for one repository.</span>
    </div>
    <span aria-hidden="true">&rarr;</span>
  </a>
  <a class="reference-card" href="{{ '/guides/import-the-current-git-identity/' | url }}">
    <div>
      <strong>Guide: Import the current Git identity</strong>
      <span>Save the identity Git is already using with <code>gitrole import current --name &lt;role&gt;</code>.</span>
    </div>
    <span aria-hidden="true">&rarr;</span>
  </a>
  <a class="reference-card" href="{{ '/guides/use-repo-local-identity-policy-with-gitrole/' | url }}">
    <div>
      <strong>Guide: Use repo-local identity policy with .gitrole</strong>
      <span>Declare the preferred role for a repo and the short list of roles that are still valid there.</span>
    </div>
    <span aria-hidden="true">&rarr;</span>
  </a>
  <a class="reference-card" href="{{ '/guides/show-gitrole-in-your-shell-prompt/' | url }}">
    <div>
      <strong>Guide: Show gitrole in your shell prompt</strong>
      <span>Print <code>gitrole:work ✓</code> or <code>gitrole:work ⚠</code> from <code>gitrole status --short --offline</code>.</span>
    </div>
    <span aria-hidden="true">&rarr;</span>
  </a>
  <a class="reference-card" href="{{ '/guides/enable-shell-tab-completion/' | url }}">
    <div>
      <strong>Guide: Enable shell tab completion</strong>
      <span>Complete commands and saved role names in zsh, bash, and fish.</span>
    </div>
    <span aria-hidden="true">&rarr;</span>
  </a>
  <a class="reference-card" href="{{ '/use-cases/fix-pushes-using-the-wrong-github-account/' | url }}">
    <div>
      <strong>Use case: Fix pushes using the wrong GitHub account</strong>
      <span>Work through the repo, remote, and SSH checks when pushes go to the wrong account.</span>
    </div>
    <span aria-hidden="true">&rarr;</span>
  </a>
  <a class="reference-card" href="{{ '/guides/verify-git-identity-before-an-agent-commits/' | url }}">
    <div>
      <strong>Guide: Verify Git identity before an agent commits</strong>
      <span>Point Claude Code, Codex, or Cursor at the packaged skill so the agent runs <code>gitrole status --short</code> and stops on a warning.</span>
    </div>
    <span aria-hidden="true">&rarr;</span>
  </a>
  <a class="reference-card" href="{{ '/use-cases/use-gitrole-as-an-identity-preflight-for-agents-and-automation/' | url }}">
    <div>
      <strong>Use case: Use gitrole as an identity preflight for agents and automation</strong>
      <span>Check repo identity state before an agent commits or pushes under an existing role.</span>
    </div>
    <span aria-hidden="true">&rarr;</span>
  </a>
  <a class="reference-card" href="{{ '/machine-readable-contracts/' | url }}">
    <div>
      <strong>Machine Readable Contracts</strong>
      <span>Field names, values, and exit codes for <code>status --short</code>, <code>doctor --json</code>, and <code>resolve --json</code>.</span>
    </div>
    <span aria-hidden="true">&rarr;</span>
  </a>
</div>
