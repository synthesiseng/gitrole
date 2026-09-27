---
layout: layouts/base.njk
title: Switch your git identity in one command.
eyebrow: Overview
summary: Save named roles, switch per repo, and check that commit identity and push identity are actually aligned.
---

<div class="button-row">
  <a class="button button-primary" href="#workflow">See the workflow</a>
  <a class="button button-secondary" href="#install">Install after you understand it</a>
</div>

<h2 id="problem">What problem it solves</h2>

If you move between work, personal, freelance, or client repositories, it is easy to use the wrong Git identity without noticing.

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

<h2 id="workflow">How it works</h2>

Do not think of `gitrole` as a system first. Think of it as a simple workflow:

<div class="step-grid">
  <div class="surface">
    <span class="eyebrow-inline">Step 1</span>
    <h3>Save a role</h3>
    <p>Create one saved role per identity, such as <code>work</code>, <code>personal</code>, or <code>client-acme</code>.</p>
  </div>
  <div class="surface">
    <span class="eyebrow-inline">Step 2</span>
    <h3>Switch to it</h3>
    <p>Apply that role globally or only in the repository you are working in.</p>
  </div>
  <div class="surface">
    <span class="eyebrow-inline">Step 3</span>
    <h3>Check before you push</h3>
    <p>Run <code>gitrole status</code> for the fast daily check. Run <code>gitrole doctor</code> when something looks wrong.</p>
  </div>
</div>

<h2 id="example">Tiny real example</h2>

This is the smallest useful flow for a repo that should use a local override:

```bash
gitrole add work --name "Alex Developer" --email "alex@work.example"
gitrole use work --local
gitrole status
```

What that does:

1. Saves a role named `work`
2. Applies it only to the current repository
3. Shows what this repo will actually use before the next commit

If `status` looks clean, you have the basic setup working.

If you want the full first-time setup, go straight to <a href="{{ '/guides/use-the-right-git-identity-for-this-repo/' | url }}">Use the right Git identity for this repo</a>.
If pushes still go through the wrong GitHub account, jump to <a href="{{ '/use-cases/fix-pushes-using-the-wrong-github-account/' | url }}">Fix pushes using the wrong GitHub account</a>.

<h2 id="status-vs-doctor">Status vs doctor</h2>

Make this distinction early:

<div class="comparison-grid">
  <div class="surface">
    <span class="eyebrow-inline">Active role</span>
    <h3><code>gitrole current</code></h3>
    <p>Use this when you want to know which saved role matches the active commit identity in this repo.</p>
  </div>
  <div class="surface">
    <span class="eyebrow-inline">Fast daily check</span>
    <h3><code>gitrole status</code></h3>
    <p>Use this before you commit or push. It answers "does this repo look right?" and checks the broader repo alignment.</p>
  </div>
  <div class="surface">
    <span class="eyebrow-inline">Full explanation</span>
    <h3><code>gitrole doctor</code></h3>
    <p>Use this when the repo looks wrong, pushes use the wrong account, or you need to understand what is out of sync.</p>
  </div>
</div>

<h2 id="install">Install</h2>

Install comes after understanding, not before:

```bash
npm install -g gitrole
```

Then create your first role and run the three-command example above.

<h2 id="keep-reading">Keep reading</h2>

Use the main guide when you want the normal setup. Use a focused page when you need help with one specific problem.

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
  <a class="reference-card" href="{{ '/use-cases/fix-pushes-using-the-wrong-github-account/' | url }}">
    <div>
      <strong>Use case: Fix pushes using the wrong GitHub account</strong>
      <span>Work through the repo, remote, and SSH checks when pushes go to the wrong account.</span>
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
</div>
