# Shell prompt snippets

A prompt that runs a live SSH check on every redraw is slow, and a checkmark is easy to read as "auth passed" when the probe never ran. These snippets print the active role from `gitrole status --short --offline` only. They need gitrole 0.9.0 or newer.

Copy one file into your shell. The command and the lines below stay stable so a prompt can parse them. Setup prose on the docs site can change without moving this contract.

## Quick start

Every snippet calls only:

```text
gitrole status --short --offline
```

That skips the live SSH `githubUser` probe. Snippets don't call `gitrole status --short` without `--offline`. There is no auth cache and no prompt memo. Each prompt runs that command.

`gitrole-prompt --format` reads one short line from stdin and prints the segment. It doesn't run `gitrole` and it doesn't cache. Inside a git repo, `gitrole-prompt` with no arguments runs `gitrole status --short --offline` itself. Unknown flags exit `2` and print `usage: gitrole-prompt` on stderr.

Parse a line you already have:

```bash
gitrole status --short --offline | gitrole-prompt --format
```

## How to read the line

`gitrole status --short --offline` prints one line on stdout. Fields are read by name, in this order:

```text
role scope override commit remote auth policy overall
```

`--offline` doesn't change the names or the order. On SSH, the skipped probe is `auth=na`. That `na` is not a passed auth check and doesn't by itself set `overall=warning`.

| Exit | Stdout |
| ---- | ------ |
| `0` | one line, `overall=aligned` |
| `2` | one line, `overall=warning` |
| `1` | empty |

An offline SSH repo with a clean local role and no `.gitrole` file:

```text
role=work scope=local override=true commit=ok remote=ok auth=na policy=na overall=aligned
```

## How to read the segment

The formatter prints at most one line and exits `0`, including for a warning, so the prompt itself doesn't fail. No trailing space. Snippets add one space only when the segment is non-empty.

Glyphs are U+2713 CHECK MARK (`✓`) and U+26A0 WARNING SIGN (`⚠`), with no variation selector.

`✓` means commit and policy are ok and auth was not checked. `✓` does not mean network auth was verified. `auth=na` is a skipped check, not a green auth check. `auth=ok` never prints `✓`. Live auth verification is for push-time `gitrole doctor` and the optional check-only hook, not the prompt.

`gitrole status --short --offline` does not emit `auth=ok`. SSH auth is `na`. HTTPS auth is `na` or `warn`. `auth=ok` means the line didn't come from `--offline`. The segment shows ⚠ because ✓ only covers the offline contract. `gitrole:? ⚠` stays reserved for an unreadable or malformed line, missing fields, a failed command, or `gitrole` not on `PATH`.

| When | Stdout |
| ---- | ------ |
| `commit=ok`, `policy` is `ok` or `na`, `remote` is `ok` or `na`, `auth=na`, `overall=aligned`, and `role` matches `^[a-z0-9_-]+$` | `gitrole:<role> ✓` |
| `commit`, `policy`, `remote`, or `auth` is `warn`, `auth=ok`, or `overall=warning`, with a role token | `gitrole:<role> ⚠` |
| missing or invalid `role`, missing `commit` / `remote` / `auth` / `policy` / `overall`, more than one line, command failure, or `gitrole` not on `PATH` | `gitrole:? ⚠` |
| `gitrole-prompt` is not on `PATH` | empty; the shell reports `gitrole-prompt: command not found`. Snippets ignore a failed format pipe, so they don't print `gitrole:? ⚠` |
| outside a git work tree | empty, and `gitrole` is not called |

`no-role`, `agent_bot`, and `client-acme` match the role token. `policy=na` means no `.gitrole` file. That can sit next to `✓` when commit is ok and auth was not checked. A hand-built aligned line with `role=no-role` is `gitrole:no-role ✓`, because the glyph follows the status fields. `no-role` can't be saved as a new role name.

## What it doesn't do

The snippets don't switch roles, install hooks, or verify network auth. They don't cache. They don't call `gitrole` outside a git work tree.

## Files

| File | Where it goes |
| ---- | ------------- |
| [starship.toml](starship.toml) | `~/.config/starship.toml` |
| [oh-my-zsh.zsh](oh-my-zsh.zsh) | `~/.zshrc`, after Oh My Zsh is sourced |
| [zsh.zsh](zsh.zsh) | `~/.zshrc` |
| [bash.sh](bash.sh) | `~/.bashrc` |
| [fish.fish](fish.fish) | `~/.config/fish/config.fish` |

Each file calls `gitrole status --short --offline` and pipes that line to `gitrole-prompt --format`. The same setup is written up in [Show gitrole in your shell prompt](https://docs.gitrole.dev/guides/show-gitrole-in-your-shell-prompt/).
