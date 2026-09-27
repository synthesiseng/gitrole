# gitrole-prompt runs `gitrole status --short --offline`.
# Segment contract: examples/prompt/README.md
# Wraps the current fish_prompt instead of replacing it.

functions -c fish_prompt _gitrole_original_prompt

function fish_prompt
  set -l segment (gitrole-prompt)
  if test -n "$segment"
    printf '%s ' $segment
  end
  _gitrole_original_prompt
end
