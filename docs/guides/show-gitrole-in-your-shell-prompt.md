---
layout: layouts/base.njk
title: Show gitrole in your shell prompt
eyebrow: Guide
summary: Print a one-line gitrole segment from status --short --offline in Starship, oh-my-zsh, zsh, bash, or fish.
order: 4
---

<h2 id="what-you-get">What you get</h2>

Snippets run `gitrole status --short --offline` and pass that line to `gitrole-prompt --format`:

| Short line | Segment |
| ---------- | ------- |
| `commit=ok`, `policy` is `ok` or `na`, `remote` is `ok` or `na`, `auth=na`, `overall=aligned` | `gitrole:work ✓` |
| `commit`, `policy`, `remote`, or `auth` is `warn`, `auth=ok`, or `overall=warning` | `gitrole:work ⚠` |
| status failed, or `role` or those fields are missing or `role` is not a role token | `gitrole:? ⚠` |

`role` has to match a saved role token: lowercase letters, digits, `-`, and `_`. `no-role` is that shape, so a repo with no matching role shows `gitrole:no-role ⚠` when commit or policy is warn. A hand-built aligned line with `role=no-role` still shows `gitrole:no-role ✓`. The glyph comes from the status fields. `no-role` cannot be saved as a role name. Fields are read by name.

`✓` means commit and policy are ok and auth was not checked. `✓` does not mean network auth was verified. Live auth verification is for push-time `gitrole doctor` and the optional check-only hook, not the prompt. On SSH, `auth=na` because the live `githubUser` probe is skipped. That `na` is not a green auth check. `gitrole status --short --offline` does not emit `auth=ok`. `auth=ok` means the line did not come from `--offline`; the segment shows ⚠ because ✓ only covers the offline contract. `gitrole:? ⚠` stays reserved for an unreadable or malformed line, missing fields, a failed command, or `gitrole` not on `PATH`.

Outside a git work tree the prompt prints nothing. The terminal needs UTF-8 for `✓` and `⚠`. The helper exits `0` when it prints a segment, including a warning, so the prompt itself does not fail. It does not switch roles, and it does not install hooks. There is no auth cache.

<h2 id="install">Install</h2>

The snippets need gitrole 0.9.0 or newer.

Install puts `gitrole` and `gitrole-prompt` on `PATH`:

```bash
brew install synthesiseng/tap/gitrole
```

or with npm:

```bash
npm install -g gitrole
```

Confirm the helper is on `PATH`:

```bash
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

Each snippet calls `gitrole status --short --offline` only. The segment has no trailing space. The functions below add one only when the segment is non-empty, so directories outside a repo stay unchanged.

The copy-paste files and the stdout contract are in `examples/prompt/` in the repo. The command stays `gitrole status --short --offline`. `✓` stays “commit and policy ok, auth not checked.” Setup prose on this page can change without moving those.

<h3 id="starship">Starship</h3>

Add this to `~/.config/starship.toml`. The command is the offline check, not a live SSH probe.

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

<h3 id="oh-my-zsh">oh-my-zsh</h3>

Put this in `~/.zshrc` after `source $ZSH/oh-my-zsh.sh`. Themes that set `PROMPT` once at startup keep the segment. If a theme rewrites `PROMPT` on every precmd, add `$(gitrole_prompt_segment)` inside that theme string.

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

This wraps the current `fish_prompt` instead of replacing it:

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

<h2 id="offline">What offline checks</h2>

Each prompt runs `gitrole status --short --offline` and never the networked `status --short`. There is no cache.

Offline status still reads local git config, author and committer env vars, whether the repo has commits, `origin` (for protocol, host, and the HTTPS pin check), the saved roles file, and `.gitrole`.

It does not open SSH and it does not call GitHub. On an SSH remote, `auth=na`. `✓` means commit and policy are ok and auth was not checked. It does not mean the githubUser probe succeeded.

`gitrole status` and `gitrole status --short` without `--offline` still probe SSH remotes. Use those when you want the network check. The prompt snippets do not.

<h2 id="troubleshooting">Troubleshooting</h2>

The snippets need gitrole 0.9.0 or newer. That release added `gitrole status --short --offline` and `gitrole-prompt`.

| What you see | What to check |
| ------------ | ------------- |
| `gitrole:? ⚠` | Status failed, `gitrole` is not on `PATH`, or the short line had no readable role. Run `gitrole status --short --offline` in that repo. Exit `1` prints the error on stderr and no line. A role token is lowercase letters, digits, `-`, and `_`, the same rule as a saved role name. |
| no segment, and the shell says `gitrole-prompt: command not found` | `gitrole-prompt` is not on `PATH`. The snippets ignore a failed format pipe, so they print nothing. `brew install synthesiseng/tap/gitrole` or `npm install -g gitrole` installs both commands. `command -v gitrole-prompt` should print a path. |
| nothing, outside a git work tree | Expected. The snippets do not run `gitrole` there. |
