---
layout: layouts/base.njk
title: Enable shell tab completion
eyebrow: Guide
summary: Enable tab completion for gitrole commands, flags, and saved role names in zsh, bash, and fish.
order: 4
---

<h2 id="what-completes">What completes</h2>

Tab completion offers the commands in the <a href="{{ '/commands/' | url }}">command reference</a>, the subcommands <code>import current</code> and <code>remote set</code>, and the flags documented for each command. It also offers <code>--help</code> and <code>--version</code>.

Saved role names are offered where a command expects a role:

<ul>
  <li><code>gitrole use</code></li>
  <li><code>gitrole pin</code></li>
  <li><code>gitrole remove</code></li>
  <li><code>gitrole remote set</code></li>
  <li><code>gitrole add</code>, so an existing role can be updated</li>
  <li><code>gitrole import current --name</code></li>
</ul>

<code>gitrole add --ssh</code> completes file paths. <code>gitrole add --name</code>, <code>--email</code>, <code>--github-user</code>, and <code>--github-host</code> do not complete values. Those flags take the text you type.

Role names come from <code>gitrole list</code>. That command reads the same saved role file the CLI uses. The first list creates that file when it is missing. If the list cannot be read, role completion is empty and no error is printed. Command and flag completion still work.

Completion does not install itself. <code>npm install</code> does not edit your shell startup files.

<h2 id="where-the-scripts-live">Where the scripts live</h2>

The package ships a <code>completions</code> directory:

<ul>
  <li><code>gitrole.bash</code> for bash</li>
  <li><code>_gitrole</code> for zsh</li>
  <li><code>gitrole.fish</code> for fish</li>
</ul>

zsh looks up a function named <code>_gitrole</code>, so that file uses the function name.

Global install, after <code>npm install -g gitrole</code>:

```bash
npm root -g
```

The directory is <code>$(npm root -g)/gitrole/completions</code>. <code>npm root -g</code> prints the real prefix, including nvm and other Node installs.

Project install, from the project that depends on gitrole:

```text
node_modules/gitrole/completions
```

Repository checkout:

```text
completions
```

Role name completion calls whichever <code>gitrole</code> is on <code>PATH</code>. Command and flag completion do not need the binary.

<h2 id="zsh">zsh</h2>

Add the completions directory to <code>fpath</code> before <code>compinit</code>. If your startup file already runs <code>compinit</code>, put the <code>fpath</code> line above that call. <code>compinit</code> loads <code>_gitrole</code> from <code>fpath</code>. Sourcing that file does not register completion.

```zsh
# Global npm install
completions="$(npm root -g)/gitrole/completions"

# Project install
# completions="node_modules/gitrole/completions"

# Repository checkout
# completions="/path/to/gitrole/completions"

fpath=("$completions" $fpath)
autoload -Uz compinit
compinit
```

Open a new shell. <code>gitrole</code> then Tab lists commands. <code>gitrole use</code> then Tab lists saved roles.

<h2 id="bash">bash</h2>

Source <code>gitrole.bash</code> from <code>~/.bashrc</code>.

```bash
# Global npm install
completions="$(npm root -g)/gitrole/completions"

# Project install
# completions="node_modules/gitrole/completions"

# Repository checkout
# completions="/path/to/gitrole/completions"

source "$completions/gitrole.bash"
```

Open a new shell. <code>gitrole</code> then Tab lists commands. <code>gitrole use</code> then Tab lists saved roles.

<h2 id="fish">fish</h2>

Fish reads <code>gitrole.fish</code> from a directory on <code>fish_complete_path</code>. The user directory is <code>~/.config/fish/completions</code>. Symlink the packaged file there.

```fish
# Global npm install
set -l completions (npm root -g)/gitrole/completions

# Project install
# set -l completions node_modules/gitrole/completions

# Repository checkout
# set -l completions /path/to/gitrole/completions

mkdir -p ~/.config/fish/completions
ln -sf $completions/gitrole.fish ~/.config/fish/completions/gitrole.fish
```

A machine-wide fish install uses a vendor completions directory instead of the user directory. On this layout that is often <code>/usr/share/fish/vendor_completions.d</code>. Homebrew fish often uses <code>/usr/local/share/fish/vendor_completions.d</code> or <code>/opt/homebrew/share/fish/vendor_completions.d</code>. <code>echo $fish_complete_path</code> prints the directories fish actually searches. Copy or symlink <code>gitrole.fish</code> into one of those vendor directories. That path is separate from the npm package path.

<h2 id="what-this-does-not-do">What this does not do</h2>

<ul>
  <li>It does not change Git identity, remotes, or which role is saved.</li>
  <li>It does not run as part of <code>npm install</code>.</li>
  <li>It does not edit <code>~/.zshrc</code>, <code>~/.bashrc</code>, or fish config for you.</li>
</ul>
