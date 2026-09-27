# Shell prompt snippets

Copy-paste setup for Starship, oh-my-zsh, zsh, bash, and fish. Shell setup docs can link this directory. The command and the lines below stay stable.

## Command

Prompts call `gitrole-prompt`. That helper runs only:

```text
gitrole status --short --offline
```

It does not run `gitrole status --short` without `--offline`. That command can open SSH.

## Short line

`gitrole status --short --offline` prints one line on stdout. Fields are read by name, in this order:

```text
role scope override commit remote auth policy overall
```

`--offline` does not change the names or the order. It skips the live SSH `githubUser` probe. On an SSH remote, `auth=na`. That `na` does not by itself set `overall=warning`. HTTPS pin checks are the same as a live status: no pin, or a pin that does not allow the active role, is `auth=warn`.

| Exit | Stdout |
| ---- | ------ |
| `0` | one line, `overall=aligned` |
| `2` | one line, `overall=warning` |
| `1` | empty |

## Segment

`gitrole-prompt` prints at most one line. It exits `0` when it prints a segment, including a warning, so prompt substitution does not fail. The line has no trailing space. The snippets in this directory add one space only when the segment is non-empty.

Glyphs are U+2713 CHECK MARK (`✓`) and U+26A0 WARNING SIGN (`⚠`), with no variation selector.

| When | Stdout |
| ---- | ------ |
| `overall=aligned` and `role` matches `^[a-z0-9_-]+$` | `gitrole:<role> ✓` |
| any other `overall`, with a role token of that shape | `gitrole:<role> ⚠` |
| missing or invalid `role`, missing `overall`, more than one line, command failure, or `gitrole` not on `PATH` | `gitrole:? ⚠` |
| outside a git work tree | empty, and `gitrole` is not called |

`no-role`, `agent_bot`, and `client-acme` match the role token. Only `overall=aligned` prints `✓`.

`gitrole-prompt --format` reads one short line from stdin and prints the segment. It does not look for a git repo and it does not use the memo.

The helper may reuse the last offline segment while local inputs are unchanged. There is no timer and no background refresh. A changed input runs `gitrole status --short --offline` before the segment is printed.

## Files

| File | Where it goes |
| ---- | ------------- |
| [starship.toml](starship.toml) | `~/.config/starship.toml` |
| [oh-my-zsh.zsh](oh-my-zsh.zsh) | `~/.zshrc`, after Oh My Zsh is sourced |
| [zsh.zsh](zsh.zsh) | `~/.zshrc` |
| [bash.sh](bash.sh) | `~/.bashrc` |
| [fish.fish](fish.fish) | `~/.config/fish/config.fish` |

Each file calls `gitrole-prompt`. None calls `gitrole status`.
