---
layout: layouts/base.njk
title: Show gitrole in your shell prompt
eyebrow: Guide
summary: Print a one-line gitrole segment from status --short in Starship, oh-my-zsh, zsh, bash, or fish.
order: 4
---

<h2 id="what-you-get">What you get</h2>

`gitrole-prompt` reads one `gitrole status --short` line and prints a segment:

| Short line | Segment |
| ---------- | ------- |
| `overall=aligned` and `role=work` | `gitrole:work ✓` |
| any other `overall`, with a role token | `gitrole:work ⚠` |
| status failed, or `role` / `overall` is missing or not a role token | `gitrole:? ⚠` |

`role` has to match a saved role token: lowercase letters, digits, `-`, and `_`. `no-role` is that shape, so a repo with no matching role shows `gitrole:no-role ⚠`. The check mark is only `overall=aligned`. Fields are read by name, so this stays valid if later fields are added after `overall`.

Outside a git work tree the helper prints nothing. The terminal needs UTF-8 for `✓` and `⚠`. The helper exits `0` when it prints a segment, including a warning, so the prompt itself does not fail. It does not switch roles, and it does not install hooks.

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

Parse a line you already have, without the cache:

```bash
gitrole status --short | gitrole-prompt --format
```

<h2 id="snippets">Snippets</h2>

Each snippet calls `gitrole-prompt`. The segment has no trailing space. The functions below add one only when the segment is non-empty, so directories outside a repo stay unchanged.

<h3 id="starship">Starship</h3>

Add this to `~/.config/starship.toml`. `command_timeout` is milliseconds. `5000` gives a live `status --short` time to finish when the cache misses. Later prompts come from the cache.

```toml
[custom.gitrole]
command = "gitrole-prompt"
when = "git rev-parse --is-inside-work-tree"
format = "[$output]($style) "
style = "bold"
command_timeout = 5000
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

<h2 id="cache">Cache and staleness</h2>

`gitrole status --short` can run an SSH probe. That is too slow to put on every prompt, so the helper caches the segment.

The cache key is the git work tree plus the author and committer env, `HOME`, `XDG_CONFIG_HOME`, and `GIT_CONFIG_GLOBAL`. The default directory is `$GITROLE_PROMPT_CACHE`, or `${XDG_CACHE_HOME:-$HOME/.cache}/gitrole/prompt`.

These inputs invalidate the cache before the segment is printed. That prompt runs `gitrole status --short` and waits:

- repo `.git/config`
- `HEAD`, the branch ref it points at, and `.git/logs/HEAD`
- `.gitrole` in the work tree
- the roles file (`$XDG_CONFIG_HOME/gitrole/roles.json`, or `~/.config/gitrole/roles.json`)
- `~/.gitconfig` and the XDG git config
- `GIT_CONFIG_GLOBAL`, when it is set
- `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL`

SSH auth, ssh-agent keys, and included git config files are not in that fingerprint. When those change and the files above do not, the cached segment stays up for `GITROLE_PROMPT_TTL` seconds. The default is `60`.

After the TTL, the prompt still prints the previous segment immediately and refreshes `status --short` in the background. The next prompt shows the new segment. One refresh runs at a time per cache entry. On an SSH remote, that background command opens an SSH connection. Raise the TTL to do that less often:

```bash
export GITROLE_PROMPT_TTL=300
```

`GITROLE_PROMPT_TTL=0` disables the cache and runs status on every prompt.

Force a foreground check after `ssh-add` or any change the fingerprint does not see:

```bash
gitrole-prompt --refresh
```

A linked work tree (a `.git` file that contains `gitdir:`) uses the git dir from that file, so config and `HEAD` there still invalidate the cache.
