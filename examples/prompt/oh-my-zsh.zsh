# gitrole-prompt runs `gitrole status --short --offline`.
# Segment contract: examples/prompt/README.md
# Source this after `source $ZSH/oh-my-zsh.sh`.
# Themes that rewrite PROMPT on every precmd need $(gitrole_prompt_segment) inside that theme string.

gitrole_prompt_segment() {
  local segment
  segment=$(gitrole-prompt) || return
  if [[ -n $segment ]]; then
    print -rn -- "$segment "
  fi
}

setopt prompt_subst
PROMPT='$(gitrole_prompt_segment)'"$PROMPT"
