---
layout: layouts/base.njk
title: Show gitrole in your shell prompt
eyebrow: Guide
summary: Print a one-line gitrole segment from status --short --offline in Starship, oh-my-zsh, zsh, bash, or fish.
order: 4
---

<p>A repository can be on the wrong Git identity and the prompt won't say so until you run a command. A prompt that calls <code>gitrole status --short</code> without <code>--offline</code> also opens SSH every time the line redraws, and a checkmark on that line is easy to read as "auth passed" when the probe never ran. This page adds a segment that shows the role from a local check only.</p>

<h2 id="quick-start">Quick start</h2>

<p>The snippets need gitrole 0.9.0 or newer. That release added <code>gitrole status --short --offline</code> and <code>gitrole-prompt</code>. Install puts both binaries on <code>PATH</code>:</p>

```bash
brew install synthesiseng/tap/gitrole
```

<p>or with npm:</p>

```bash
npm install -g gitrole
```

<p>Confirm the helper:</p>

```bash
command -v gitrole-prompt
```

<p>If you use Starship, add this to <code>~/.config/starship.toml</code>. The command is the offline check, not a live SSH probe. <code>when</code> walks up to the work tree. <code>detect_folders = [".git"]</code> would not. You can stop after Starship reloads if the segment shows a role inside a repo and nothing outside one.</p>

```toml
# `when` walks up to the work tree. detect_folders = [".git"] would not.
[custom.gitrole]
shell = ["sh", "-c"]
command = """
line=$(gitrole status --short --offline 2>/dev/null)
status=$?
if [ "$status" -ne 0 ] && [ "$status" -ne 2 ]; then
  printf '%s\n' 'gitrole:? ⚠'
  exit 0
fi
printf '%s\n' "$line" | gitrole-prompt --format
"""
when = "git rev-parse --is-inside-work-tree"
format = "[$output]($style) "
style = "bold"
```

<p>From a checkout of this repo, before the package is installed, the helper lives in <code>shell/</code>:</p>

```bash
export PATH="/path/to/gitrole/shell:$PATH"
```

<p><code>/path/to/gitrole</code> is the repository root. Don't point a prompt at <code>gitrole status --short</code> without <code>--offline</code>. That command can open an SSH connection.</p>

<h2 id="how-to-read-the-segment">How to read the segment</h2>

<p>Each snippet runs <code>gitrole status --short --offline</code> and pipes that one line to <code>gitrole-prompt --format</code>. The helper prints at most one line and exits <code>0</code>, including for a warning, so the prompt itself doesn't fail. There is no trailing space on the helper's line. The functions add one space only when the segment is non-empty, so directories outside a repo stay unchanged.</p>

<p>`✓` means commit and policy are ok and auth was not checked. `✓` does not mean network auth was verified. Live auth is `gitrole doctor` and the optional check-only hook, not the prompt.</p>

<p>On SSH, `auth=na` because the live `githubUser` probe is skipped. That `na` is not a green auth check. `gitrole status --short --offline` does not emit `auth=ok`. SSH auth is `na`. HTTPS auth is `na` or `warn`. `auth=ok` means the line didn't come from `--offline`, and the segment shows ⚠ because ✓ only covers the offline contract.</p>

<p>If `gitrole-prompt` is not on `PATH`, the shell reports `gitrole-prompt: command not found` and the segment is empty. A failed or unreadable status shows `gitrole:? ⚠`.</p>

<p>Fields are read by name, in this order: <code>role scope override commit remote auth policy overall</code>. <code>role</code> has to match a role token: lowercase letters, digits, <code>-</code>, and <code>_</code>. <code>no-role</code> is that shape, so a repo with no matching role shows <code>gitrole:no-role ⚠</code> when commit or policy is warn. A hand-built aligned line with <code>role=no-role</code> still shows <code>gitrole:no-role ✓</code>. The glyph comes from the status fields. <code>no-role</code> can't be saved as a new role name.</p>

<table>
  <thead>
    <tr><th>When</th><th>Segment</th></tr>
  </thead>
  <tbody>
    <tr><td><code>commit=ok</code>, <code>policy</code> is <code>ok</code> or <code>na</code>, <code>remote</code> is <code>ok</code> or <code>na</code>, <code>auth=na</code>, <code>overall=aligned</code></td><td><code>gitrole:work ✓</code></td></tr>
    <tr><td><code>commit</code>, <code>policy</code>, <code>remote</code>, or <code>auth</code> is <code>warn</code>, or <code>auth=ok</code>, or <code>overall=warning</code></td><td><code>gitrole:work ⚠</code></td></tr>
    <tr><td>status failed, fields are missing, or <code>role</code> isn't a role token</td><td><code>gitrole:? ⚠</code></td></tr>
  </tbody>
</table>

<p>An offline SSH repo with a clean local role prints this line, and the segment is <code>gitrole:work ✓</code>:</p>

```text
role=work scope=local override=true commit=ok remote=ok auth=na policy=na overall=aligned
```

<p>The same fields with <code>auth=ok</code> are not what <code>--offline</code> prints. The formatter still shows <code>gitrole:work ⚠</code>, so a copied online line doesn't get a checkmark in the prompt.</p>

<h2 id="offline">What offline checks</h2>

<p>Each prompt runs <code>gitrole status --short --offline</code> and never the networked <code>status --short</code>. There is no cache, so the next prompt sees a role switch or an env override without a refresh flag.</p>

<p>Offline status still reads local git config, author and committer env vars, whether the repo has commits, <code>origin</code> (protocol, host, and the HTTPS pin check), the saved roles file, and <code>.gitrole</code>. It doesn't open SSH and it doesn't call GitHub. <code>gitrole status</code> and <code>gitrole status --short</code> without <code>--offline</code> still probe SSH remotes. Use those when you want the network check. The prompt snippets don't.</p>

<h2 id="other-shells">Other shells</h2>

<p>The copy-paste files are in <code>examples/prompt/</code>. Each one calls <code>gitrole status --short --offline</code> only. The stdout contract for the segment is in that directory's README, so setup prose here can change without moving the lines the snippets parse.</p>

<h3 id="oh-my-zsh">oh-my-zsh</h3>

<p>Put this in <code>~/.zshrc</code> after <code>source $ZSH/oh-my-zsh.sh</code>. Themes that set <code>PROMPT</code> once at startup keep the segment. If a theme rewrites <code>PROMPT</code> on every precmd, add <code>$(gitrole_prompt_segment)</code> inside that theme string, or the theme will drop the segment on the next prompt.</p>

```zsh
gitrole_prompt_segment() {
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0
  local line status segment
  line=$(gitrole status --short --offline 2>/dev/null)
  status=$?
  if [ "$status" -ne 0 ] && [ "$status" -ne 2 ]; then
    print -rn -- 'gitrole:? ⚠ '
    return 0
  fi
  segment=$(printf '%s\n' "$line" | gitrole-prompt --format) || return 0
  if [[ -n $segment ]]; then
    print -rn -- "$segment "
  fi
}

setopt prompt_subst
PROMPT='$(gitrole_prompt_segment)'"$PROMPT"
```

<h3 id="zsh">zsh</h3>

```zsh
setopt prompt_subst

gitrole_prompt_segment() {
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0
  local line status segment
  line=$(gitrole status --short --offline 2>/dev/null)
  status=$?
  if [ "$status" -ne 0 ] && [ "$status" -ne 2 ]; then
    print -rn -- 'gitrole:? ⚠ '
    return 0
  fi
  segment=$(printf '%s\n' "$line" | gitrole-prompt --format) || return 0
  if [[ -n $segment ]]; then
    print -rn -- "$segment "
  fi
}

PROMPT='$(gitrole_prompt_segment)'"$PROMPT"
```

<h3 id="bash">bash</h3>

```bash
gitrole_prompt_segment() {
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0
  local line status segment
  line=$(gitrole status --short --offline 2>/dev/null)
  status=$?
  if [ "$status" -ne 0 ] && [ "$status" -ne 2 ]; then
    printf '%s ' 'gitrole:? ⚠'
    return 0
  fi
  segment=$(printf '%s\n' "$line" | gitrole-prompt --format) || return 0
  if [ -n "$segment" ]; then
    printf '%s ' "$segment"
  fi
}

PS1='$(gitrole_prompt_segment)'"$PS1"
```

<h3 id="fish">fish</h3>

<p>This wraps the current <code>fish_prompt</code> instead of replacing it, so the rest of your prompt stays:</p>

```fish
functions -c fish_prompt _gitrole_original_prompt

function fish_prompt
  if not git rev-parse --is-inside-work-tree >/dev/null 2>&1
    _gitrole_original_prompt
    return
  end
  set -l line (gitrole status --short --offline 2>/dev/null)
  set -l code $status
  if test $code -ne 0; and test $code -ne 2
    printf '%s ' 'gitrole:? ⚠'
  else
    set -l segment (printf '%s\n' $line | gitrole-prompt --format)
    if test -n "$segment"
      printf '%s ' $segment
    end
  end
  _gitrole_original_prompt
end
```

<h2 id="troubleshooting">Troubleshooting</h2>

<p>The snippets need gitrole 0.9.0 or newer. The terminal needs UTF-8 for <code>✓</code> and <code>⚠</code>. Glyphs are U+2713 CHECK MARK and U+26A0 WARNING SIGN, with no variation selector.</p>

<table>
  <thead>
    <tr><th>What you see</th><th>What to check</th></tr>
  </thead>
  <tbody>
    <tr>
      <td><code>gitrole:? ⚠</code></td>
      <td>Status failed, <code>gitrole</code> is not on <code>PATH</code>, or the short line had no readable role. Run <code>gitrole status --short --offline</code> in that repo. Exit <code>1</code> prints the error on stderr and no line. A role token is lowercase letters, digits, <code>-</code>, and <code>_</code>, the same shape as a saved role name.</td>
    </tr>
    <tr>
      <td>no segment, and the shell says <code>gitrole-prompt: command not found</code></td>
      <td><code>gitrole-prompt</code> is not on <code>PATH</code>. The snippets ignore a failed format pipe, so they print nothing instead of <code>gitrole:? ⚠</code>. <code>brew install synthesiseng/tap/gitrole</code> or <code>npm install -g gitrole</code> installs both commands. <code>command -v gitrole-prompt</code> should print a path.</td>
    </tr>
    <tr>
      <td>nothing, outside a git work tree</td>
      <td>Expected. The snippets don't run <code>gitrole</code> there, so a home directory stays quiet.</td>
    </tr>
  </tbody>
</table>

<h2 id="what-it-does-not-do">What it doesn't do</h2>

<p>The prompt doesn't switch roles, install hooks, or verify network auth. It doesn't cache a previous line. <code>gitrole:? ⚠</code> stays reserved for an unreadable or malformed line, missing fields, a failed command, or <code>gitrole</code> not on <code>PATH</code>.</p>

<h2 id="files">Snippet files</h2>

<table>
  <thead>
    <tr><th>File in <code>examples/prompt/</code></th><th>Where it goes</th></tr>
  </thead>
  <tbody>
    <tr><td><code>starship.toml</code></td><td><code>~/.config/starship.toml</code></td></tr>
    <tr><td><code>oh-my-zsh.zsh</code></td><td><code>~/.zshrc</code>, after Oh My Zsh is sourced</td></tr>
    <tr><td><code>zsh.zsh</code></td><td><code>~/.zshrc</code></td></tr>
    <tr><td><code>bash.sh</code></td><td><code>~/.bashrc</code></td></tr>
    <tr><td><code>fish.fish</code></td><td><code>~/.config/fish/config.fish</code></td></tr>
  </tbody>
</table>
