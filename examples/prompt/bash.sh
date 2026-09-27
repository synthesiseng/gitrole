# gitrole-prompt runs `gitrole status --short --offline`.
# Segment contract: examples/prompt/README.md

gitrole_prompt_segment() {
  local segment
  segment=$(gitrole-prompt) || return
  if [ -n "$segment" ]; then
    printf '%s ' "$segment"
  fi
}

PS1='$(gitrole_prompt_segment)'"$PS1"
