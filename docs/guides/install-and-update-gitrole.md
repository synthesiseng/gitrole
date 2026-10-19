---
layout: layouts/base.njk
title: Install and update gitrole
eyebrow: Guide
summary: Choose an installation channel, check its version, and find optional package assets.
order: 0
---

Gitrole needs Node.js 20 or newer. Choose Homebrew or npm, then check which executable your shell uses.

<h2 id="install">Install</h2>

With Homebrew:

```bash
brew install synthesiseng/tap/gitrole
```

Homebrew declares a Node dependency. With npm and an existing Node.js 20+ installation:

```bash
npm install -g gitrole
```

Both channels expose `gitrole` and `gitrole-prompt`. Installation does not configure identities, enable completion, or install hooks.

```bash
gitrole --version
command -v gitrole
command -v gitrole-prompt
```

Continue with <a href="{{ '/guides/use-the-right-git-identity-for-this-repo/' | url }}">Use the right Git identity for this repo</a>.

<h2 id="update">Update the channel you installed</h2>

For Homebrew:

```bash
brew update
brew upgrade synthesiseng/tap/gitrole
```

For npm:

```bash
npm install -g gitrole@latest
```

Then rerun `gitrole --version` and `command -v gitrole`. If you have both installations, the first executable on `PATH` wins. Updating one does not update the other.

<h2 id="versions">Source and published versions</h2>

A merge to the source repository does not establish that either channel has published that change. [npm's `latest`](https://www.npmjs.com/package/gitrole) and the [Homebrew formula](https://github.com/synthesiseng/homebrew-tap/blob/main/Formula/gitrole.rb) may update at different times. Check current channel metadata when choosing a version:

```bash
npm view gitrole@latest version
brew update
brew info synthesiseng/tap/gitrole
```

These commands report channel metadata, not the version your shell runs or proof that an installation works. Compare their results with `gitrole --version` and `command -v gitrole` after installing or updating.

The offline status flag and prompt helper require 0.9.0 or newer; `gitrole check commit` requires 0.12.0 or newer. Source documentation may describe changes that are not yet published to your channel. Confirm your installed version before comparing output.

<h2 id="optional-assets">Find optional assets</h2>

The npm package includes `skills/gitrole/SKILL.md`, `hooks/pre-commit`, and `completions/`, as well as the CLI and prompt helper. For a global npm installation, its package root is:

```bash
npm root -g
```

Append `/gitrole` to that directory. A project dependency uses `node_modules/gitrole`; a source checkout has the same asset directories at its root.

The Homebrew formula exposes the two commands. No supported Homebrew path for skills, hooks, or completion scripts is documented here. Homebrew users can use those assets from a checkout of <a href="https://github.com/synthesiseng/gitrole">the source repository</a>; use an absolute checkout path in shell or agent configuration. You do not need a second CLI installation to use checkout assets.

For optional setup, read <a href="{{ '/guides/show-gitrole-in-your-shell-prompt/' | url }}">Show gitrole in your shell prompt</a>, <a href="{{ '/guides/enable-shell-tab-completion/' | url }}">Enable shell tab completion</a>, or <a href="{{ '/guides/verify-git-identity-before-an-agent-commits/' | url }}">Verify Git identity before an agent commits</a>.

Copied hook files do not update with the CLI. The packaged hook requires gitrole 0.12.0 or newer with `gitrole check commit`; verify that capability in the hook's environment before adopting it. Keep a reviewed backup when migrating an older hook. See <a href="{{ '/guides/check-identity-before-a-local-commit/' | url }}#migration">manual hook migration and rollback</a>.
