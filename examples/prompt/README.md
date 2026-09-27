# Shell prompt snippets

Needs gitrole 0.9.0 or newer.

Copy-paste setup for Starship, oh-my-zsh, zsh, bash, and fish. Shell setup docs can link this directory. The command and the lines below stay stable.

## Command

Every snippet calls only:

```text
gitrole status --short --offline
```

That skips the live SSH `githubUser` probe. Snippets do not call `gitrole status --short` without `--offline`. There is no auth cache and no prompt memo. Each prompt runs that command.

`gitrole-prompt --format` reads one short line from stdin and prints the segment. It does not run `gitrole` and it does not cache.

## Short line

`gitrole status --short --offline` prints one line on stdout. Fields are read by name, in this order:

```text
role scope override commit remote auth policy overall
```

`--offline` does not change the names or the order. On SSH, the skipped probe is `auth=na`. That `na` is not a passed auth check and does not by itself set `overall=warning`.

| Exit | Stdout |
| ---- | ------ |
| `0` | one line, `overall=aligned` |
| `2` | one line, `overall=warning` |
| `1` | empty |

## Segment

The formatter prints at most one line and exits `0`, including for a warning. No trailing space. Snippets add one space only when the segment is non-empty.

Glyphs are U+2713 CHECK MARK (`✓`) and U+26A0 WARNING SIGN (`⚠`), with no variation selector.

`✓` means commit and policy are ok and auth was not checked. `✓` does not mean network auth was verified. `auth=na` is a skipped check, not a green auth check. `auth=ok` never prints `✓`. Live auth verification is for push-time `gitrole doctor` and the optional check-only hook, not the prompt.

`gitrole status --short --offline` does not emit `auth=ok`. SSH auth is `na`. HTTPS auth is `na` or `warn`. A short line that still contains `auth=ok` is unexpected on this path. The formatter prints `gitrole:<role> ⚠` for it.

| When | Stdout |
| ---- | ------ |
| `commit=ok`, `policy` is `ok` or `na`, `remote` is `ok` or `na`, `auth=na`, `overall=aligned`, and `role` matches `^[a-z0-9_-]+$` | `gitrole:<role> ✓` |
| `commit`, `policy`, `remote`, or `auth` is `warn`, `auth=ok`, or `overall=warning`, with a role token | `gitrole:<role> ⚠` |
| missing or invalid `role`, missing `commit` / `remote` / `auth` / `policy` / `overall`, more than one line, command failure, or `gitrole` not on `PATH` | `gitrole:? ⚠` |
| `gitrole-prompt` is not on `PATH` | empty; the shell reports `gitrole-prompt: command not found`. Snippets ignore a failed format pipe, so they do not print `gitrole:? ⚠` |
| outside a git work tree | empty, and `gitrole` is not called |

`no-role`, `agent_bot`, and `client-acme` match the role token. `policy=na` means no `.gitrole` file. That can sit next to `✓` when commit is ok and auth was not checked.

## Files

| File | Where it goes |
| ---- | ------------- |
| [starship.toml](starship.toml) | `~/.config/starship.toml` |
| [oh-my-zsh.zsh](oh-my-zsh.zsh) | `~/.zshrc`, after Oh My Zsh is sourced |
| [zsh.zsh](zsh.zsh) | `~/.zshrc` |
| [bash.sh](bash.sh) | `~/.bashrc` |
| [fish.fish](fish.fish) | `~/.config/fish/config.fish` |

Each file calls `gitrole status --short --offline` and pipes that line to `gitrole-prompt --format`.
