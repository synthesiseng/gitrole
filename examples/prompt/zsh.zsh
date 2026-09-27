# gitrole-prompt runs `gitrole status --short --offline`.
# Segment contract: examples/prompt/README.md

setopt prompt_subst

gitrole_prompt_segment() {
  local segment
  segment=$(gitrole-prompt) || return
  if [[ -n $segment ]]; then
    print -rn -- "$segment "
  fi
}

PROMPT='$(gitrole_prompt_segment)'"$PROMPT"
