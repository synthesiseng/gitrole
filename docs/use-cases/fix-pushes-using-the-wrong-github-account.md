---
layout: layouts/base.njk
title: Fix pushes using the wrong GitHub account
eyebrow: Use case
summary: Diagnose and fix repositories where Git commit identity looks right locally but SSH pushes still authenticate as the wrong GitHub account.
order: 1
---

<h2 id="when-to-use-this">When to use this</h2>

Use this page when the repo identity looks right locally, but pushes still go through the wrong GitHub account.

If you still need the baseline role setup, go back to <a href="{{ '/guides/use-the-right-git-identity-for-this-repo/' | url }}">Use the right Git identity for this repo</a> first.

Common signs:

- `gitrole status` looks warning-heavy even after switching roles
- GitHub shows the wrong account when you push over SSH
- the repository remote is still pointing at the wrong SSH host alias

<h2 id="start-with-doctor">Start with doctor</h2>

Run:

```bash
gitrole doctor
```

`doctor` is the full explanation view. It is the fastest way to see whether the problem is in the commit identity, the remote configuration, or the SSH auth path.

If you want the raw result for scripting or debugging, use:

```bash
gitrole doctor --json
```

<h2 id="check-the-remote">Check the remote</h2>

If the role expects a GitHub host alias, the remote needs to point at that alias too.

Inspect `gitrole doctor --json` and its `repository.push.targets` before changing a remote. Gitrole observes every default push URL; an explicit push URL or another selected remote can differ from origin's fetch URL. `gitrole remote set` rewrites origin's fetch URL only. When the effective push destination uses that URL and its host does not match the role, rewrite `origin`:

```bash
gitrole remote set work
```

That keeps the same owner and repository name, but swaps the host to the alias configured for the `work` role.

<h2 id="check-your-ssh-setup">Check your SSH setup</h2>

If the remote host is right but pushes still authenticate as the wrong account, inspect the SSH alias in `~/.ssh/config`.

Example:

```sshconfig
Host github.com-acme-dev
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_work
  IdentitiesOnly yes
```

Then make sure the saved role points at the same SSH setup:

```bash
gitrole add work \
  --name "Alex Developer" \
  --email "alex@work.example" \
  --ssh ~/.ssh/id_work \
  --github-user acme-dev \
  --github-host github.com-acme-dev
```

<h2 id="confirm-the-fix">Confirm the fix</h2>

After updating the remote or SSH alias, rerun the checks:

```bash
gitrole status
gitrole doctor
```

Use `status` for the quick daily check. Use `doctor` again if you need to confirm that the remote host and SSH account now match the selected role.

If the repository also has a preferred-role policy, see <a href="{{ '/guides/use-repo-local-identity-policy-with-gitrole/' | url }}">Use repo-local identity policy with .gitrole</a> to make that expectation explicit.
