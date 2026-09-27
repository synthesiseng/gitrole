---
layout: layouts/base.njk
title: Show gitrole in your shell prompt
eyebrow: Guide
summary: Print a one-line gitrole segment from status --short --offline in Starship, oh-my-zsh, zsh, bash, or fish.
order: 4
---

<h2 id="what-you-get">What you get</h2>

`gitrole-prompt` runs `gitrole status --short --offline` and prints a segment:

| Short line | Segment |
| ---------- | ------- |
| `overall=aligned` and `role=work` | `gitrole:work ✓` |
| any other `overall`, with a role token | `gitrole:work ⚠` |
| status failed, or `role` / `overall` is missing or not a role token | `gitrole:? ⚠` |

`role` has to match a saved role token: lowercase letters, digits, `-`, and `_`. `no-role` is that shape, so a repo with no matching role shows `gitrole:no-role ⚠`. The check mark is only `overall=aligned`. Fields are read by name, so this stays valid if later fields are added after `overall`.

Outside a git work tree the helper prints nothing. The terminal needs UTF-8 for `✓` and `⚠`. The helper exits `0` when it prints a segment, including a warning, so the prompt itself does not fail. It does not switch roles, and it does not install hooks.

The check mark means the offline line says `overall=aligned`. On an SSH remote, `auth=na` because the live `githubUser` probe is skipped, and that `na` does not by itself warn. HTTPS pin checks still run from the saved role and `.gitrole`: no pin, or a pin that does not allow the active role, is `auth=warn`.

<h2 id="install">Install</h2>

A global install puts the helper on `PATH` next to `gitrole`:

```bash
npm install -g gitrole
command -v gitrole-prompt
```

From a checkout of this repo:

```bash
export PATH="/path/to/gitrole/shell:$PATH"
```

Parse a line you already have:

```bash
gitrole status --short --offline | gitrole-prompt --format
```

Do not point a prompt at `gitrole status --short` without `--offline`. That command can open an SSH connection.

<h2 id="snippets">Snippets</h2>

Each snippet calls `gitrole-prompt`. The segment has no trailing space. The functions below add one only when the segment is non-empty, so directories outside a repo stay unchanged.

<h3 id="starship">Starship</h3>

Add this to `~/.config/starship.toml`. `gitrole-prompt` is the offline check, not a live SSH probe.

```toml
[custom.gitrole]
command = "gitrole-prompt"
when = "git rev-parse --is-inside-work-tree"
format = "[$output]($style) "
style = "bold"
```

<h3 id="oh-my-zsh">oh-my-zsh</h3>

Put this in `~/.zshrc` after `source $ZSH/oh-my-zsh.sh`. Themes that set `PROMPT` once at startup keep the segment. If a theme rewrites `PROMPT` on every precmd, add `$(gitrole_prompt_segment)` inside that theme string.

```zsh
gitrole_prompt_segment() {
  local segment
  segment=$(gitrole-prompt) || return
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
  local segment
  segment=$(gitrole-prompt) || return
  if [[ -n $segment ]]; then
    print -rn -- "$segment "
  fi
}

PROMPT='$(gitrole_prompt_segment)'"$PROMPT"
```

<h3 id="bash">bash</h3>

```bash
gitrole_prompt_segment() {
  local segment
  segment=$(gitrole-prompt) || return
  if [ -n "$segment" ]; then
    printf '%s ' "$segment"
  fi
}

PS1='$(gitrole_prompt_segment)'"$PS1"
```

<h3 id="fish">fish</h3>

This wraps the current `fish_prompt` instead of replacing it:

```fish
functions -c fish_prompt _gitrole_original_prompt

function fish_prompt
  set -l segment (gitrole-prompt)
  if test -n "$segment"
    printf '%s ' $segment
  end
  _gitrole_original_prompt
end
```

<h2 id="offline">What offline checks</h2>

Each prompt asks `gitrole-prompt` for a segment. That helper runs `gitrole status --short --offline` and never the networked `status --short`.

Offline status still reads local git config, author and committer env vars, whether the repo has commits, `origin` (for protocol, host, and the HTTPS pin check), the saved roles file, and `.gitrole`.

It does not open SSH and it does not call GitHub. On an SSH remote, `auth=na`. A check mark in the prompt is the local overall result, not a live githubUser probe.

`gitrole status` and `gitrole status --short` without `--offline` still probe SSH remotes. Use those when you want the network check. The prompt snippets do not.

The helper remembers the last offline line for this work tree while those local inputs are unchanged, so a redraw does not start Node again. Change git config, `HEAD`, `.gitrole`, the roles file, or the author and committer env, and the next prompt runs offline status before it prints. There is no timer and no background job. The memo lives in `$GITROLE_PROMPT_CACHE`, or `${XDG_CACHE_HOME:-$HOME/.cache}/gitrole/prompt`.
