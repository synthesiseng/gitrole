---
layout: layouts/base.njk
title: Enable shell tab completion
eyebrow: Guide
summary: Enable tab completion for gitrole subcommands and saved role names in zsh, bash, and fish.
order: 5
---

<h2 id="when-to-use-this">When to use this</h2>

Use this after <code>gitrole</code> is installed when you want Tab to fill subcommands and saved role names.

<code>npm install</code> does not edit your shell config. Add the snippet for your shell.

<h2 id="where-the-scripts-live">Where the scripts live</h2>

The repository and the published package both contain:

```text
completions/gitrole.bash
completions/_gitrole
completions/gitrole.fish
```

Global install (<code>npm install -g gitrole</code>). <code>npm root -g</code> prints the global <code>node_modules</code> directory:

```text
$(npm root -g)/gitrole/completions/gitrole.bash
$(npm root -g)/gitrole/completions/_gitrole
$(npm root -g)/gitrole/completions/gitrole.fish
```

Project install (<code>npm install gitrole</code>), from that project:

```text
node_modules/gitrole/completions/gitrole.bash
node_modules/gitrole/completions/_gitrole
node_modules/gitrole/completions/gitrole.fish
```

Repository checkout, from the repo root:

```text
completions/gitrole.bash
completions/_gitrole
completions/gitrole.fish
```

<h2 id="zsh">zsh</h2>

There is no oh-my-zsh plugin. Add the completions directory to <code>fpath</code> before <code>compinit</code>. If your startup file already runs <code>compinit</code>, put the <code>fpath</code> line above that call.

Global install:

```zsh
completions="$(npm root -g)/gitrole/completions"
fpath=("$completions" $fpath)
autoload -Uz compinit
compinit
```

Project install, from that project directory:

```zsh
completions="$(pwd)/node_modules/gitrole/completions"
fpath=("$completions" $fpath)
autoload -Uz compinit
compinit
```

Repository checkout, from the repo root:

```zsh
completions="$(pwd)/completions"
fpath=("$completions" $fpath)
autoload -Uz compinit
compinit
```

<code>compinit</code> loads <code>_gitrole</code> from <code>fpath</code>. Sourcing <code>_gitrole</code> does not register completion.

<h2 id="bash">bash</h2>

Source <code>gitrole.bash</code> from <code>~/.bashrc</code>.

Global install:

```bash
source "$(npm root -g)/gitrole/completions/gitrole.bash"
```

Project install, from that project directory:

```bash
source "$(pwd)/node_modules/gitrole/completions/gitrole.bash"
```

Repository checkout, from the repo root:

```bash
source "$(pwd)/completions/gitrole.bash"
```

<h2 id="fish">fish</h2>

Symlink <code>gitrole.fish</code> into <code>~/.config/fish/completions/</code>.

Global install:

```fish
mkdir -p ~/.config/fish/completions
ln -sf (npm root -g)/gitrole/completions/gitrole.fish ~/.config/fish/completions/gitrole.fish
```

Project install, from that project directory:

```fish
mkdir -p ~/.config/fish/completions
ln -sf (pwd)/node_modules/gitrole/completions/gitrole.fish ~/.config/fish/completions/gitrole.fish
```

Repository checkout, from the repo root:

```fish
mkdir -p ~/.config/fish/completions
ln -sf (pwd)/completions/gitrole.fish ~/.config/fish/completions/gitrole.fish
```

For every user on the machine, symlink <code>gitrole.fish</code> into a vendor directory from <code>fish_complete_path</code>. <code>echo $fish_complete_path</code> prints that list. One entry is <code>/usr/share/fish/vendor_completions.d</code>.

<h2 id="what-completes">What completes</h2>

Tab offers the subcommands, including <code>import current</code> and <code>remote set</code>, and the flags each completion script lists.

For <code>gitrole status</code>, Tab offers <code>--short</code>. Type <code>--offline</code> until the scripts include it.

Saved role names are offered for:

<ul>
  <li><code>gitrole use</code></li>
  <li><code>gitrole pin</code></li>
  <li><code>gitrole remove</code></li>
  <li><code>gitrole remote set</code></li>
  <li><code>gitrole add</code></li>
  <li><code>gitrole import current --name</code></li>
</ul>

Role names come from <code>gitrole list</code>. That command reads the saved roles file. If the list cannot be read, role completion is empty and no error is printed.

<h2 id="verify">Verify</h2>

Open a new shell after the snippet is in place. Press Tab at the end of this line:

```text
gitrole 
```

zsh lists subcommands such as <code>add</code>, <code>use</code>, and <code>status</code>.

bash lists the same subcommands.

fish lists the same subcommands.
