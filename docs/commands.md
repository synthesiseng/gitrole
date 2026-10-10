---
layout: layouts/base.njk
title: gitrole Commands Reference
eyebrow: Reference
summary: Reference for gitrole CLI commands for saved roles, Git identity switching, SSH push alignment, diagnosis, and repo-local policy.
---

<p>You usually need one command: save an identity, switch this repo to it, or check it before you commit. This page is that lookup. The walkthrough is <a href="{{ '/guides/use-the-right-git-identity-for-this-repo/' | url }}">Use the right Git identity for this repo</a>.</p>

<p>For installation and a first run, use <a href="{{ '/guides/install-and-update-gitrole/' | url }}">Install and update</a> and <a href="{{ '/guides/use-the-right-git-identity-for-this-repo/' | url }}">the first-use guide</a>. For output fields, provenance and exit codes, use <a href="{{ '/machine-readable-contracts/' | url }}">Machine-readable contracts</a>.</p>

<h2 id="command-list">Command list</h2>

<dl class="command-list">
  <dt><code>gitrole add &lt;name&gt; --name "..." --email "..." [--ssh ...] [--github-user ...] [--github-host ...]</code></dt>
  <dd>Create or replace a saved role profile; include all optional fields you intend to keep. Empty or whitespace-only full names and emails are rejected before changing saved roles.</dd>

  <dt><code>gitrole import current --name &lt;role&gt;</code></dt>
  <dd>Save Git’s effective current author name and email as a named role. <code>--name &lt;role&gt;</code> is required. See <a href="{{ '/guides/import-the-current-git-identity/' | url }}">Import the current Git identity</a>.</dd>

  <dt><code>gitrole use &lt;name&gt; [--global | --local]</code></dt>
  <dd>Apply a saved role globally (the default) or only in the current repository with <code>--local</code>. A saved role with an empty or whitespace-only full name or email is rejected before changing Git config or loading an SSH key. A saved SSH key may be loaded with <code>ssh-add</code>.</dd>

  <dt><code>gitrole pin &lt;role&gt;</code></dt>
  <dd>Create a strict repo-local <code>.gitrole</code> policy for one role.</dd>

  <dt><code>gitrole resolve</code></dt>
  <dd>Print the repo-local default role from <code>.gitrole</code>.</dd>

  <dt><code>gitrole resolve --json</code></dt>
  <dd>Write the repo policy as JSON.</dd>

  <dt><code>gitrole current</code></dt>
  <dd>Show which saved role matches the active commit identity.</dd>

  <dt><code>gitrole list</code></dt>
  <dd>List all saved roles and mark the active one when there is a match.</dd>

  <dt><code>gitrole check commit</code></dt>
  <dd>Check the complete effective author and committer against a saved role and any repository policy, using local data only. Requires a saved-role match even without a pin. Quiet exit 0 passes; exit 2 explains a mismatch; exit 1 explains a required read, parse, or operational failure. No operands, <code>--offline</code>, or JSON mode. See <a href="{{ '/guides/check-identity-before-a-local-commit/' | url }}">the local commit guide</a>.</dd>

  <dt><code>gitrole status</code></dt>
  <dd>Check current author/committer identity, policy, and every resolved default push destination. Alignment does not prove push success.</dd>

  <dt><code>gitrole status --short</code></dt>
  <dd>Show the one-line machine-friendly alignment check. Add <code>--offline</code> to <code>status</code> to invoke no SSH commands, including configuration inspection. Local HTTPS pin checks still apply.</dd>

  <dt><code>gitrole doctor</code></dt>
  <dd>Explain commit identity, remote configuration, and SSH auth alignment in more detail. Also warn about every saved role with a blank full name or email, including inactive roles. Replace such a role with <code>gitrole add</code> using a valid identity, or remove it with <code>gitrole remove</code>; diagnosis does not rewrite saved roles or Git config. A read-only legacy pre-commit inspection may add an informational migration hint; it never installs, executes, or replaces hooks, and that hint does not change the verdict or exit. This hint is available in both default online diagnosis and <code>doctor --offline</code>.</dd>

  <dt><code>gitrole doctor --json</code></dt>
  <dd>Return the full diagnosis as structured JSON.</dd>

  <dt><code>gitrole doctor --offline</code></dt>
  <dd>Run local diagnosis without any SSH execution, including <code>ssh -G</code>. Combine with <code>--json</code> in either order. SSH authentication is skipped as <code>info</code>; local warnings still cause exit <code>2</code>. Exit <code>0</code> means only that local checks have no warnings. Every push host and HTTPS pin is still checked, including mixed SSH/HTTPS destinations. No authentication history is read or saved. Default doctor retains online SSH checks and their possible network/configuration effects.</dd>

  <dt><code>gitrole remote set &lt;name&gt;</code></dt>
  <dd>Rewrite origin’s fetch URL to the saved GitHub SSH host alias, preserving its owner/repository. It does not change a separate push URL or another selected push remote.</dd>

  <dt><code>gitrole remove &lt;name&gt;</code></dt>
  <dd>Remove a saved role profile.</dd>
</dl>

<h2 id="what-it-does-not-do">What these commands don't do</h2>

<p>None of them switch your GitHub browser session, store an HTTPS token, or install a hook for you. The optional check-only hook is a file you copy yourself. It runs <code>gitrole check commit</code>. Older copied hooks keep their combined <code>status --short</code> behavior until <a href="{{ '/guides/check-identity-before-a-local-commit/' | url }}#migration">manually migrated</a>.</p>

<p>Optional <a href="{{ '/guides/enable-shell-tab-completion/' | url }}">shell tab completion</a> completes commands and saved role names; installation does not enable it automatically.</p>

## `gitrole auth test`

Run an explicit SSH account check yourself in a terminal:

```bash
gitrole auth test
```

Gitrole checks every effective default push destination, using the destination's SSH alias, user and port. This uses the same destination and SSH configuration, not an identical push: command-dependent rules may differ. It does not test repository permissions or guarantee a future push. It does not change status or doctor verdicts, and stores no history.

```text
Destination: git@work-alias.example:team/repo.git
Host: work-alias.example
Authenticated as: example-user
Role expects: example-user
Checked: 2026-10-09T12:00:00.000Z
This connection does not guarantee the account or success of a future push.
```

The effective commit identity selects the saved role, just as in `current`. Account comparison uses the existing exact-string rule. A mismatch prints `Mismatch: observed actual-user, role expects expected-user` and exits 2. Without a matching role or configured `githubUser`, the command reports that no account expectation is configured; it never invents one.

| Exit | Meaning |
| --- | --- |
| 0 | Every endpoint reported an account and met any applicable account expectation |
| 2 | An account mismatched, or at least one endpoint remained unobserved/unsupported |
| 1 | Repository, configuration or other operational error |
| 130 | Cancelled by Ctrl-C (SIGINT) |
| 143 | Terminated by SIGTERM |

Each endpoint has its own result; one success cannot hide another failure. Results go to stdout; notices and operational errors go to stderr. There is no JSON mode. Unsupported transports, SSH wrappers/overrides and configured remote commands are not executed. Unsafe or credential-bearing destinations are withheld from output. Only a recognized, complete GitHub-style account greeting counts as observed.

SSH may use the network, execute `Match exec`, proxies or providers, and prompt according to existing settings. It may update known hosts or save credentials under those settings. Gitrole never weakens host-key validation or adds a credential-saving policy, and does not override `BatchMode=yes`. Configured effects can occur even during SSH settings inspection. Run this deliberately, never from an agent skill, prompt or hook.

In a terminal, the connection timeout is five seconds; time spent answering prompts has no overall deadline. Use Ctrl-C to cancel. SIGTERM uses the same cleanup; if signals repeat during cleanup, the first signal determines the exit status. Gitrole sends TERM, allows a one-second grace period, then escalates to KILL. It never signals your terminal's shared process group: a pipeline or parent application may share that group. Instead, it uses process snapshots to track SSH's known descendants and rechecks their start times before signalling them, even if SSH has already exited. This cleanup is best effort: children that exit or become reparented between snapshots may escape tracking; PID reuse and the interval between checking a process and signalling it cannot be eliminated. If process inspection is unavailable, only SSH itself is targeted.

Without a terminal, Gitrole uses BatchMode=yes, disables OpenSSH askpass and supplies no stdin; configured providers or hardware may still show UI. The total budget is ten seconds plus one second of cleanup. Gitrole creates and terminates its own process group on timeout, including TERM/KILL escalation. Processes that deliberately leave that group or detach may survive. A terminal suggestion is not a diagnosis of why authentication failed. Platforms without the required process-group support remain unsupported.

### SSH key paths

`--ssh` accepts a file path, including absolute paths, relative paths, `~` paths,
and quoted paths containing spaces. Paths starting with `-` after whitespace
normalization are rejected when saving. For a filename beginning with `-`, use
an explicit relative path such as `./-key`. A lone `-` is also rejected because
OpenSSH treats it as standard input.

Older saved roles remain readable and removable. If one has an unsafe key path,
`use` applies the Git identity as usual but reports SSH key loading as failed,
without invoking `ssh-add` for that path. Update it with `add` and a safe path,
or use `import current` to replace the role with the current commit identity
without SSH metadata.

Key loading passes `--` before the path. This follows OpenSSH argument parsing
(verified against portable OpenSSH 9.9p2 and Apple's OpenSSH source). Custom
`GITROLE_SSH_ADD_BIN` executables must accept the same argument convention;
arbitrary wrappers are not qualified. This does not guarantee that a key exists
or that loading it will succeed.
