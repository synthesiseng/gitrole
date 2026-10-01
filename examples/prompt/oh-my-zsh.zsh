# Calls `gitrole status --short --offline` only. No auth cache.
# ✓ means commit and policy are ok and auth was not checked. ✓ ≠ auth verified.
# Contract: examples/prompt/README.md
# Source this after `source $ZSH/oh-my-zsh.sh`.
# Themes that rewrite PROMPT on every precmd need $(gitrole_prompt_segment) inside that theme string.

gitrole_prompt_segment() {
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0
  local line status_code segment
  line=$(gitrole status --short --offline 2>/dev/null)
  status_code=$?
  if [ "$status_code" -ne 0 ] && [ "$status_code" -ne 2 ]; then
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
