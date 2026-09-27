# Fish completion for gitrole.
# Symlink this file into a fish completions directory. It does not install itself.
# Saved role names come from `gitrole list` lines shaped "* name ..." or "  name ...".

function __gitrole_roles
    NO_COLOR=1 FORCE_COLOR=0 command gitrole list 2>/dev/null | sed -n 's/^[* ] \([a-z0-9_-][a-z0-9_-]*\) .*/\1/p'
    return 0
end

complete -c gitrole -e
complete -c gitrole -f

complete -c gitrole -f -n '__fish_use_subcommand' -a add -d 'Save or update a named role'
complete -c gitrole -f -n '__fish_use_subcommand' -a import -d 'Import a role from the current Git identity'
complete -c gitrole -f -n '__fish_use_subcommand' -a use -d 'Apply a saved role globally or to the current repo'
complete -c gitrole -f -n '__fish_use_subcommand' -a pin -d 'Create a strict repo-local .gitrole policy for one role'
complete -c gitrole -f -n '__fish_use_subcommand' -a resolve -d 'Print the repo-local default role from .gitrole'
complete -c gitrole -f -n '__fish_use_subcommand' -a current -d 'Show which saved role matches the active commit identity'
complete -c gitrole -f -n '__fish_use_subcommand' -a list -d 'List saved roles and mark the active one'
complete -c gitrole -f -n '__fish_use_subcommand' -a status -d 'Check whether the current repo is aligned for commit and push'
complete -c gitrole -f -n '__fish_use_subcommand' -a doctor -d 'Diagnose identity, remote, and SSH auth alignment'
complete -c gitrole -f -n '__fish_use_subcommand' -a remote -d 'Manage repository remotes for a selected role'
complete -c gitrole -f -n '__fish_use_subcommand' -a remove -d 'Remove a saved role'
complete -c gitrole -f -n '__fish_use_subcommand' -a help -d 'Print help for a command'

complete -c gitrole -f -s h -l help -d 'Print help'
complete -c gitrole -f -s V -l version -d 'Print version'

complete -c gitrole -f -n '__fish_seen_subcommand_from add' -l name -r -d 'Git user.name for this role'
complete -c gitrole -f -n '__fish_seen_subcommand_from add' -l email -r -d 'Git user.email for this role'
complete -c gitrole -n '__fish_seen_subcommand_from add' -l ssh -rF -d 'SSH private key to load with ssh-add'
complete -c gitrole -f -n '__fish_seen_subcommand_from add' -l github-user -r -d 'Expected GitHub user for SSH pushes'
complete -c gitrole -f -n '__fish_seen_subcommand_from add' -l github-host -r -d 'Expected GitHub SSH host or host alias'
complete -c gitrole -f -n '__fish_seen_subcommand_from add; and not __fish_prev_arg_in --name --email --ssh --github-user --github-host' -a '(__gitrole_roles)' -d 'Saved role'

complete -c gitrole -f -n '__fish_seen_subcommand_from import; and not __fish_seen_subcommand_from current' -a current -d 'Save the effective current commit identity as a named role'
complete -c gitrole -f -n '__fish_seen_subcommand_from import; and __fish_seen_subcommand_from current' -l name -rka '(__gitrole_roles)' -d 'Saved role name'

complete -c gitrole -f -n '__fish_seen_subcommand_from use; and not __fish_seen_argument --global; and not __fish_seen_argument --local' -l global -d 'Apply the role to global Git config'
complete -c gitrole -f -n '__fish_seen_subcommand_from use; and not __fish_seen_argument --global; and not __fish_seen_argument --local' -l local -d 'Apply the role to repository-local Git config'
complete -c gitrole -f -n '__fish_seen_subcommand_from use' -a '(__gitrole_roles)' -d 'Saved role'

complete -c gitrole -f -n '__fish_seen_subcommand_from pin' -a '(__gitrole_roles)' -d 'Saved role'
complete -c gitrole -f -n '__fish_seen_subcommand_from remove' -a '(__gitrole_roles)' -d 'Saved role'

complete -c gitrole -f -n '__fish_seen_subcommand_from resolve' -l json -d 'Write the repo policy as JSON'
complete -c gitrole -f -n '__fish_seen_subcommand_from status' -l short -d 'Show machine-friendly one-line status output'
complete -c gitrole -f -n '__fish_seen_subcommand_from doctor' -l json -d 'Write the diagnostic result as JSON'

complete -c gitrole -f -n '__fish_seen_subcommand_from remote; and not __fish_seen_subcommand_from set' -a set -d 'Rewrite origin to the role GitHub host alias'
complete -c gitrole -f -n '__fish_seen_subcommand_from remote; and __fish_seen_subcommand_from set' -a '(__gitrole_roles)' -d 'Saved role'

complete -c gitrole -f -n '__fish_seen_subcommand_from help' -a 'add import use pin resolve current list status doctor remote remove' -d 'Command'
