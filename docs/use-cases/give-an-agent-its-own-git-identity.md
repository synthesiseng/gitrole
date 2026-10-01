---
layout: layouts/base.njk
title: Give an agent its own Git identity
eyebrow: Use case
summary: Save and apply an agent identity whose account, SSH key, and host alias have already been configured.
order: 3
---

Use a dedicated role when automated commits should carry a distinct author identity. Gitrole saves that identity and its expected SSH account; it does not create accounts, keys, or SSH host aliases.

<h2 id="prerequisites">Prepare the identity outside gitrole</h2>

Before following the SSH example, you need an existing account with the intended repository access, an SSH key registered to that account, and an SSH host alias configured to select that key. Confirm the intended name/email and the agent's authorization to commit or push. Those setup steps are outside this guide.

If the agent should reuse an existing role, read <a href="{{ '/use-cases/use-gitrole-as-an-identity-preflight-for-agents-and-automation/' | url }}">the existing-role preflight guide</a> instead. For HTTPS, follow <a href="{{ '/guides/use-the-right-git-identity-for-this-repo/' | url }}">the first-use guide</a>; pins do not select or verify credentials.

<h2 id="create-the-agent-role">Save the prepared identity</h2>

Replace all example values with your existing setup:

```bash
gitrole add agent \
  --name "Example Build Agent" \
  --email "build-agent@work.example" \
  --ssh ~/.ssh/id_ed25519_agent \
  --github-user example-build-agent \
  --github-host github.com-build-agent
```

`--github-user` and `--github-host` save expectations for checks. They do not by themselves select an account. `use` may load the saved key with `ssh-add`; the effective SSH context and remote destination still matter.

<h2 id="switch-the-repo-to-the-agent-role">Apply locally and inspect destinations</h2>

```bash
gitrole use agent --local
gitrole doctor --json
```

Inspect the effective author and committer, `repository.push.remoteName`, and every `repository.push.targets` entry. If origin's fetch URL supplies the effective push destination and needs the prepared host alias, you can use:

```bash
gitrole remote set agent
```

This rewrites origin's fetch URL only. A different selected remote or explicit push URL requires reviewing the corresponding Git configuration.

<h2 id="check-that-it-worked">Check and stop on warnings</h2>

```bash
gitrole status --short
```

Exit `0` and `overall=aligned` indicate current identity alignment. Exit `2`, any `warn` field, or exit `1` means stop and diagnose. Online SSH inspection may execute configured `Match exec` commands or DNS lookups; custom, interactive, or incomplete contexts remain unverified.

A role name is not proof of authorship and does not grant repository access. A check does not prove refspec readiness, authorization, or push success. Changed environment/configuration and future explicit author/push arguments fall outside its snapshot.

Continue with <a href="{{ '/guides/verify-git-identity-before-an-agent-commits/' | url }}">the packaged agent instructions</a> and, if needed, <a href="{{ '/guides/use-repo-local-identity-policy-with-gitrole/' | url }}">repo-local policy</a>.
