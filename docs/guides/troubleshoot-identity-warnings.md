---
layout: layouts/base.njk
title: Troubleshoot identity warnings
eyebrow: Guide
summary: Find the warning, inspect the relevant identity or push destination, and choose a focused next step.
order: 3
---

Run the diagnosis in the same repository and environment as the check that warned:

```bash
gitrole doctor
```

For structured detail, use `gitrole doctor --json`. Both commands may exit `2` and still return a valid diagnosis. Exit `1` is failure; the error is on stderr and no result is printed on stdout.

<h2 id="choose-a-warning">Choose the warning</h2>

| What warned | What to inspect | Next action |
| --- | --- | --- |
| `commit` | Effective author and committer; environment and included configuration | Confirm the intended role, then apply it locally if appropriate. Recheck any author/committer overrides. |
| `remote` | `repository.push.remoteName` and all `targets` | Check the selected push remote, push URLs, protocol, and expected host alias. |
| `auth` on HTTPS | Active role's `githubUser` and the `.gitrole` policy | Follow the <a href="{{ '/guides/use-the-right-git-identity-for-this-repo/#https' | url }}">HTTPS first-use explanation</a> below through the first-use guide. A matching pin expresses an expectation; it does not check credentials. |
| `auth` on SSH | Each endpoint's supported SSH context and observed account | Read <a href="{{ '/use-cases/fix-pushes-using-the-wrong-github-account/' | url }}">the SSH account guide</a>. Unverified contexts warn even when a separate SSH command works. |
| `policy` | Default/allowed roles and the effective author | Review <a href="{{ '/guides/use-repo-local-identity-policy-with-gitrole/' | url }}">repo-local policy</a> before changing it. |

Do not switch roles or widen policy just to clear a warning. Choose the identity and policy the repository is intended to use.

<h2 id="https">HTTPS warns after add and use</h2>

This is expected without an allowing pin and a saved GitHub username. Read <a href="{{ '/guides/use-the-right-git-identity-for-this-repo/' | url }}">Use the right Git identity for this repo</a>, including its HTTPS step. The check remains active offline. A matching pin can yield `auth=na`; it does not prove which account an HTTPS credential helper will use. Mixed SSH/HTTPS destinations warn online.

<h2 id="scope">The role or scope differs from your Git config</h2>

`current` and `import current` use Git's effective author. `doctor --json` reports the effective author as `commitIdentity` and the committer as `committerIdentity`. Their field sources can be `env`, while `scope` still describes underlying configured author scope. A global name and local email yield `mixed`, not `local`.

If author and committer differ, commit alignment warns. A repository with no commits and no local/worktree override also warns, even if its global identity matches a role. Applying a local role can address that case; it does not prove the first push has a usable refspec.

<h2 id="push">Changing origin did not fix the push check</h2>

Inspect `gitrole doctor --json`. Gitrole selects the default push destination and checks every URL Git resolves for it. A branch `pushRemote`, `remote.pushDefault`, branch remote, explicit `pushurl`, or a URL or path used in place of a remote name can make the destination differ from origin's fetch URL. URL rewrites (`insteadOf`, `pushInsteadOf`) apply to that destination. `gitrole remote set` changes origin's fetch URL only. Correct the intended Git configuration after reviewing those destinations; see <a href="{{ '/machine-readable-contracts/' | url }}">Machine-readable contracts</a> for selection rules and limitations.

<h2 id="prompt">The prompt is empty or warns</h2>

The supplied zsh and Oh My Zsh functions have a known read-only `status` variable error. Use the existing `gitrole-prompt` helper directly or the Bash example; see <a href="{{ '/guides/show-gitrole-in-your-shell-prompt/' | url }}">the prompt guide</a>. Offline prompts do not verify network authentication.

<h2 id="version">A command or output differs from the docs</h2>

Check `gitrole --version` and `command -v gitrole`, then read <a href="{{ '/guides/install-and-update-gitrole/' | url }}">Install and update gitrole</a>. Source changes and npm/Homebrew publication are separate. Completion, skills, and hooks have optional asset setup; installation does not enable them automatically.

<h2 id="limits">An aligned result still cannot establish push success</h2>

A check does not prove refspec readiness or repository authorization. It observes current identity and default destinations. A later explicit `git push` target, `git commit --author`, or changed environment/configuration falls outside that snapshot.
