# Calls `gitrole status --short --offline` only. No auth cache.
# ✓ means commit and policy are ok and auth was not checked. ✓ ≠ auth verified.
# Contract: examples/prompt/README.md
# Wraps the current fish_prompt instead of replacing it.

functions -c fish_prompt _gitrole_original_prompt

function fish_prompt
  if not git rev-parse --is-inside-work-tree >/dev/null 2>&1
    _gitrole_original_prompt
    return
  end
  set -l line (gitrole status --short --offline 2>/dev/null)
  set -l code $status
  if test $code -ne 0; and test $code -ne 2
    printf '%s ' 'gitrole:? ⚠'
  else
    set -l segment (printf '%s\n' $line | gitrole-prompt --format)
    if test -n "$segment"
      printf '%s ' $segment
    end
  end
  _gitrole_original_prompt
end
