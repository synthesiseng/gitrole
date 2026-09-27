# Calls `gitrole status --short --offline` only. No auth cache.
# ✓ means commit and policy are ok and auth was not checked. ✓ ≠ auth verified.
# Contract: examples/prompt/README.md

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
