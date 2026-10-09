# Bash completion for gitrole.
# Source this file from your shell startup. It does not install itself.
# Saved role names come from `gitrole list` lines shaped "* name ..." or "  name ...".

_gitrole_roles() {
  NO_COLOR=1 FORCE_COLOR=0 command gitrole list 2>/dev/null \
    | sed -n 's/^[* ] \([a-z0-9_-][a-z0-9_-]*\) .*/\1/p' \
    || true
}

_gitrole_comp_lines() {
  local line
  COMPREPLY=()
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    COMPREPLY+=("$line")
  done <<< "$1"
}

_gitrole_comp_words() {
  local matches
  matches="$(compgen -W "$1" -- "$cur" || true)"
  _gitrole_comp_lines "$matches"
}

_gitrole_comp_roles() {
  local roles
  roles="$(_gitrole_roles)"
  _gitrole_comp_words "$roles"
}

_gitrole() {
  local cur prev cmd sub word
  local i skip_next
  local flags has_global has_local

  COMPREPLY=()
  cur="${COMP_WORDS[COMP_CWORD]}"
  if (( COMP_CWORD > 0 )); then
    prev="${COMP_WORDS[COMP_CWORD-1]}"
  else
    prev=""
  fi

  cmd=""
  sub=""
  skip_next=0
  has_global=0
  has_local=0

  for (( i = 1; i < COMP_CWORD; i++ )); do
    word="${COMP_WORDS[i]}"
    if (( skip_next )); then
      skip_next=0
      continue
    fi
    case "$word" in
      --global)
        has_global=1
        ;;
      --local)
        has_local=1
        ;;
      --name|--email|--ssh|--github-user|--github-host)
        skip_next=1
        ;;
      -*)
        ;;
      *)
        if [[ -z "$cmd" ]]; then
          cmd="$word"
        elif [[ -z "$sub" ]]; then
          sub="$word"
        fi
        ;;
    esac
  done

  case "$prev" in
    --ssh)
      if [[ "$cmd" == "add" ]]; then
        if type compopt >/dev/null 2>&1; then
          compopt -o filenames 2>/dev/null || true
        fi
        local files
        files="$(compgen -f -- "$cur" || true)"
        _gitrole_comp_lines "$files"
        return 0
      fi
      ;;
    --name)
      if [[ "$cmd" == "import" && "$sub" == "current" ]]; then
        _gitrole_comp_roles
        return 0
      fi
      if [[ "$cmd" == "add" ]]; then
        return 0
      fi
      ;;
    --email|--github-user|--github-host)
      if [[ "$cmd" == "add" ]]; then
        return 0
      fi
      ;;
  esac

  if [[ -z "$cmd" ]]; then
    if [[ "$cur" == -* ]]; then
      _gitrole_comp_words "--help -h --version -V"
    else
      _gitrole_comp_words "add import use pin resolve current list check status doctor auth remote remove help"
    fi
    return 0
  fi

  case "$cmd" in
    add)
      if [[ "$cur" == -* ]]; then
        _gitrole_comp_words "--name --email --ssh --github-user --github-host --help -h"
      else
        _gitrole_comp_roles
      fi
      ;;
    import)
      if [[ -z "$sub" ]]; then
        if [[ "$cur" == -* ]]; then
          _gitrole_comp_words "--help -h"
        else
          _gitrole_comp_words "current"
        fi
      elif [[ "$sub" == "current" ]]; then
        if [[ "$cur" == -* ]]; then
          _gitrole_comp_words "--name --help -h"
        fi
      fi
      ;;
    use)
      flags="--help -h"
      if (( ! has_local && ! has_global )); then
        flags+=" --global --local"
      fi
      if [[ "$cur" == -* ]]; then
        _gitrole_comp_words "$flags"
      else
        _gitrole_comp_roles
      fi
      ;;
    pin|remove)
      if [[ "$cur" == -* ]]; then
        _gitrole_comp_words "--help -h"
      else
        _gitrole_comp_roles
      fi
      ;;
    check)
      if [[ -z "$sub" && "$cur" != -* ]]; then
        _gitrole_comp_words "commit"
      elif [[ "$cur" == -* ]]; then
        _gitrole_comp_words "--help -h"
      fi
      ;;
    auth)
      if [[ -z "$sub" && "$cur" != -* ]]; then
        _gitrole_comp_words "test"
      else
        _gitrole_comp_words "--help -h"
      fi
      ;;
    remote)
      if [[ -z "$sub" ]]; then
        if [[ "$cur" == -* ]]; then
          _gitrole_comp_words "--help -h"
        else
          _gitrole_comp_words "set"
        fi
      elif [[ "$sub" == "set" ]]; then
        if [[ "$cur" == -* ]]; then
          _gitrole_comp_words "--help -h"
        else
          _gitrole_comp_roles
        fi
      fi
      ;;
    resolve)
      if [[ "$cur" == -* ]]; then
        _gitrole_comp_words "--json --help -h"
      fi
      ;;
    status)
      if [[ "$cur" == -* ]]; then
        _gitrole_comp_words "--short --offline --help -h"
      fi
      ;;
    doctor)
      if [[ "$cur" == -* ]]; then
        _gitrole_comp_words "--json --offline --help -h"
      fi
      ;;
    current|list)
      if [[ "$cur" == -* ]]; then
        _gitrole_comp_words "--help -h"
      fi
      ;;
    help)
      if [[ "$cur" != -* ]]; then
        _gitrole_comp_words "add import use pin resolve current list check status doctor remote remove"
      fi
      ;;
  esac

  return 0
}

complete -F _gitrole gitrole
