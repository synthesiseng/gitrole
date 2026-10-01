---
layout: layouts/base.njk
title: Enable shell tab completion
eyebrow: Guide
summary: Enable tab completion for gitrole subcommands and saved role names in zsh, bash, and fish.
order: 5
---

<p>Tab on <code>gitrole</code> does nothing useful until your shell loads a completion script. Installing gitrole doesn't edit your shell config, so the command is on <code>PATH</code> and the completions are not. This page turns Tab on for subcommands, flags, and saved role names.</p>

<h2 id="when-to-use-this">Quick start</h2>

<p>The path below is a global npm install on zsh. bash and fish are further down. <code>brew install synthesiseng/tap/gitrole</code> puts <code>gitrole</code> and <code>gitrole-prompt</code> on <code>PATH</code>. The Homebrew formula doesn't install the completion scripts into your shell, and this page doesn't document a Homebrew prefix path for them. If you installed with Homebrew, use the checkout instructions below with an absolute path to <a href="https://github.com/synthesiseng/gitrole">this source repository</a>. The npm paths apply only when the npm package is actually installed. You do not need a second CLI installation.</p>

<p>Add the completions directory to <code>fpath</code> before <code>compinit</code>. zsh only loads <code>_gitrole</code> from <code>fpath</code> during <code>compinit</code>, so sourcing the file doesn't register completion. If your startup file already runs <code>compinit</code>, put the <code>fpath</code> line above that call.</p>

```zsh
completions="$(npm root -g)/gitrole/completions"
fpath=("$completions" $fpath)
autoload -Uz compinit
compinit
```

<p>The zsh interactive capture was intermittent during verification, so this setup is provided without a completed interactive qualification. Open a new shell. Press Tab at the end of <code>gitrole </code> (with the trailing space). zsh should list subcommands such as <code>add</code>, <code>use</code>, and <code>status</code>. You can stop there. bash, fish, and the other install locations are below.</p>

<h2 id="zsh">zsh</h2>

<p>There is no oh-my-zsh plugin. Use the same <code>fpath</code> lines as the quick start, with a different directory.</p>

<p>Project install, from that project directory:</p>

```zsh
completions="$(pwd)/node_modules/gitrole/completions"
fpath=("$completions" $fpath)
autoload -Uz compinit
compinit
```

<p>Repository checkout, from the repo root:</p>

```zsh
completions="/absolute/path/to/gitrole/completions"
fpath=("$completions" $fpath)
autoload -Uz compinit
compinit
```

<h2 id="bash">bash</h2>

<p>Source <code>gitrole.bash</code> from <code>~/.bashrc</code>. bash completion registers when the file is sourced, which is why this isn't the zsh <code>fpath</code> setup.</p>

<p>Global npm install:</p>

```bash
source "$(npm root -g)/gitrole/completions/gitrole.bash"
```

<p>Project install, from that project directory:</p>

```bash
source "$(pwd)/node_modules/gitrole/completions/gitrole.bash"
```

<p>Repository checkout, from the repo root:</p>

```bash
source "/absolute/path/to/gitrole/completions/gitrole.bash"
```

<p>Open a new shell and press Tab after <code>gitrole </code>. bash lists the same subcommands.</p>

<h2 id="fish">fish</h2>

<p>Fish was unavailable during verification. These instructions describe the supplied script; interactive behavior remains unverified.</p>

<p>fish loads completions from files in <code>~/.config/fish/completions/</code>. A symlink keeps the script on the installed package when the package updates.</p>

<p>Global npm install:</p>

```fish
mkdir -p ~/.config/fish/completions
ln -sf (npm root -g)/gitrole/completions/gitrole.fish ~/.config/fish/completions/gitrole.fish
```

<p>Project install, from that project directory:</p>

```fish
mkdir -p ~/.config/fish/completions
ln -sf (pwd)/node_modules/gitrole/completions/gitrole.fish ~/.config/fish/completions/gitrole.fish
```

<p>Repository checkout, from the repo root:</p>

```fish
mkdir -p ~/.config/fish/completions
ln -sf /absolute/path/to/gitrole/completions/gitrole.fish ~/.config/fish/completions/gitrole.fish
```

<p>Open a new fish shell and press Tab after <code>gitrole </code>. fish lists the same subcommands. For a machine-wide install, symlink <code>gitrole.fish</code> into a directory on <code>$fish_complete_path</code>. <code>echo $fish_complete_path</code> prints that list on your machine.</p>

<h2 id="what-completes">What completes</h2>

<p>Tab offers the subcommands, including <code>import current</code> and <code>remote set</code>, and the flags each script lists. For <code>gitrole status</code>, Tab offers <code>--short</code>, <code>--offline</code>, and <code>--help</code>. <code>--offline</code> is in the bash, zsh, and fish scripts so a prompt setup doesn't have to be typed by hand.</p>

<p>Saved role names are offered for:</p>

<ul>
  <li><code>gitrole use</code></li>
  <li><code>gitrole pin</code></li>
  <li><code>gitrole remove</code></li>
  <li><code>gitrole remote set</code></li>
  <li><code>gitrole add</code></li>
  <li><code>gitrole import current --name</code></li>
</ul>

<p>Role names come from <code>gitrole list</code>, which reads the saved roles file. If that file can't be read, role completion is empty and no error is printed, so a broken roles file looks like "you have no roles" rather than a shell error.</p>

<h2 id="verify">Verify</h2>

<p>Open a new shell after the snippet is in place. Press Tab at the end of this line:</p>

```text
gitrole 
```

<p>zsh, bash, and fish list subcommands such as <code>add</code>, <code>use</code>, and <code>status</code>. Then try <code>gitrole use </code> and confirm your saved role names appear.</p>

<h2 id="where-the-scripts-live">Where the scripts live</h2>

<p>The repository and the published npm package both contain:</p>

```text
completions/gitrole.bash
completions/_gitrole
completions/gitrole.fish
```

<table>
  <thead>
    <tr><th>Install</th><th>Path</th></tr>
  </thead>
  <tbody>
    <tr><td>Global npm install</td><td><code>$(npm root -g)/gitrole/completions/</code></td></tr>
    <tr><td>Project npm install</td><td><code>node_modules/gitrole/completions/</code></td></tr>
    <tr><td>Repository checkout</td><td><code>completions/</code> at the repo root</td></tr>
  </tbody>
</table>

<p><code>npm root -g</code> prints the global <code>node_modules</code> directory. That path is the npm install, not a Homebrew prefix.</p>

<h2 id="what-it-does-not-do">What it doesn't do</h2>

<p>Completion doesn't install gitrole, switch roles, or run <code>gitrole status</code>. It also doesn't enable itself when you install the package. The Homebrew formula isn't covered by a prefix path on this page.</p>
