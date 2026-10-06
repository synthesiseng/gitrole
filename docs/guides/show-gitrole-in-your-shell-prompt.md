---
layout: layouts/base.njk
title: Show gitrole in your shell prompt
eyebrow: Guide
summary: Use the offline prompt helper, read its checkmark correctly, and choose an available shell setup.
order: 4
---

The prompt helper displays the saved role from local identity and policy checks. It requires gitrole 0.9.0 or newer. See <a href="{{ '/guides/install-and-update-gitrole/' | url }}">Install and update gitrole</a> first.

<h2 id="quick-start">Try the helper</h2>

```bash
command -v gitrole-prompt
gitrole-prompt
```

Inside a Git work tree, the helper runs `gitrole status --short --offline`. Outside a work tree it prints nothing. It performs no role switching and invokes no SSH commands, including SSH configuration inspection. HTTPS pin checks remain active and can warn.

You can also format an existing short line:

```bash
gitrole status --short --offline | gitrole-prompt --format
```

The pipeline shows the formatter's exit status, not the status check's exit. Use the status command separately when you need its exit code.

<h2 id="how-to-read-the-segment">Read the segment</h2>

| Segment | Meaning |
| --- | --- |
| `gitrole:work ✓` | Local checks are aligned; `auth=na`. Network authentication was not verified. |
| `gitrole:work ⚠` | A check warns, or the formatter received an online `auth=ok` line instead of the offline contract. |
| `gitrole:? ⚠` | The status command failed or its line was unreadable. |
| Empty | Outside a Git work tree, or the helper is unavailable in a setup that suppresses formatter failure. |

`✓` requires `commit=ok`, `remote` and `policy` each `ok` or `na`, `auth=na`, and `overall=aligned`. HTTPS `auth=na` can reflect a matching pin; it does not verify credentials. The helper reads fields by name, in order `role scope override commit remote auth policy overall`.

<h2 id="bash">Bash setup</h2>

The existing Bash example handles aligned, warning, command-failure, and outside-repository cases. Add it to the startup file your Bash session reads. Interactive non-login Bash normally reads `~/.bashrc`; a login shell may need its profile to source that file. Review how your current prompt is configured before adding the prefix.

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


The function adds a space only when it prints a segment. It preserves the status exit code before formatting, accepting `0` and `2` as valid results.

<h2 id="zsh">zsh and Oh My Zsh setup</h2>

Copy the current `examples/prompt/zsh.zsh` into `~/.zshrc`. For Oh My Zsh, use `examples/prompt/oh-my-zsh.zsh` after `source $ZSH/oh-my-zsh.sh`. Both use `status_code` to capture the command exit; zsh’s `status` parameter is read-only. Replace older copies that assign `status`.

Both snippet functions and their prompt expansion are checked in native zsh for repeated local checks, warnings, command failures, and use outside a repository. Full Oh My Zsh framework and theme behavior remains unverified. A theme that rewrites `PROMPT` on every `precmd` needs `$(gitrole_prompt_segment)` inside its theme string. Review your theme before adding the prefix.

To print the segment on demand:

```zsh
gitrole-prompt
```


<h2 id="starship">Starship example</h2>

The existing example's shell command body handles the offline status line. Full Starship rendering was not established in this verification pass. If you choose to try it, add the custom module to your Starship configuration and ensure your configured format includes the module.

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


<h2 id="fish">Fish example</h2>

The source repository includes `examples/prompt/fish.fish`. Fish was unavailable in this verification environment, so its interactive behavior remains unverified. Review the file and test it in your own shell before adding it to a startup file.

<h2 id="troubleshooting">Troubleshoot</h2>

| What you see | Next check |
| --- | --- |
| `gitrole:? ⚠` | Git discovery failed (for example, broken Git configuration or missing `git`), or status inside a real work tree failed: the status line was unreadable, the command failed, or `gitrole` is not on `PATH`. Run `gitrole status --short --offline` separately and read stderr. |
| `gitrole-prompt: command not found` | Run `command -v gitrole-prompt`, then check your installation channel/version. |
| A role with `⚠` | Use `gitrole doctor` to explain warnings; HTTPS pins are checked even offline. |
| Empty in zsh | Replace an older function that assigns read-only `status` with the current source example using `status_code`. If a theme rewrites `PROMPT`, review its theme string. |
| Empty outside a repository | Expected. An empty or corrupt `.git` directory, or a `.git` file that does not point at a repository, is not a work tree. The segment stays empty and does not warn. |

`gitrole-prompt` is not on `PATH` if `command -v gitrole-prompt` prints no path. The offline status command does not emit `auth=ok`.

Your terminal needs UTF-8 and glyphs for U+2713 CHECK MARK and U+26A0 WARNING SIGN. There is no cache: each helper invocation checks current local state. Use an online `gitrole doctor` when you need supported SSH authentication evidence; the prompt does not provide it.

<h2 id="files">Example files</h2>

Examples live in <a href="https://github.com/synthesiseng/gitrole/tree/main/examples/prompt">the source repository</a>, not the npm package's published file list. The source <code>examples/prompt/README.md</code> describes the formatter contract and shell qualification limits. The helper itself is included in both documented installation channels.
