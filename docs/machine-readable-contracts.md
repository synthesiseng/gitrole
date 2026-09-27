---
layout: layouts/base.njk
title: Machine Readable CLI Contracts
eyebrow: Reference
summary: Public contract reference for gitrole machine readable CLI output, including status --short, doctor --json, and resolve --json for scripts and automation.
---

Three commands are meant for scripts and agents. Each command below uses the same order: signature, example, fields, exit codes, when it fails, what's stable. Shared role-name rules are at the end.

<dl class="command-list">
  <dt><a href="#status-short"><code>gitrole status --short</code></a></dt>
  <dd>One line. Order is <code>role scope override commit remote auth policy overall</code>.</dd>
  <dt><a href="#doctor-json"><code>gitrole doctor --json</code></a></dt>
  <dd>Full diagnosis as JSON. HTTPS auth is <code>info</code> only when a pin allows the role; otherwise it is <code>warn</code>.</dd>
  <dt><a href="#resolve-json"><code>gitrole resolve --json</code></a></dt>
  <dd>The <code>.gitrole</code> file as JSON.</dd>
  <dt><a href="#role-name-format">Role name format</a></dt>
  <dd>Saved role names that can show up in <code>role=</code>.</dd>
</dl>

<h2 id="status-short"><code>gitrole status --short</code></h2>

<p>One line: is this repo aligned to commit or push?</p>

<p><a href="#status-short-signature">Signature</a> · <a href="#status-short-example">Example</a> · <a href="#status-short-fields">Fields</a> · <a href="#status-short-exit-codes">Exit codes</a> · <a href="#status-short-failures">When it fails</a> · <a href="#status-short-stable">What's stable</a></p>

<h3 id="status-short-signature">Signature</h3>

```bash
gitrole status --short
gitrole status --short --offline
```

<h3 id="status-short-example">Example</h3>

No `.gitrole` file. `policy=na`.

```text
role=work scope=local override=true commit=ok remote=ok auth=ok policy=na overall=aligned
```

A pin is the repo's `.gitrole` file (what `gitrole pin` writes). It names `defaultRole` and `allowedRoles` for that repo. See [Pin a repo to one role]({{ '/guides/use-repo-local-identity-policy-with-gitrole/' | url }}#pin-a-repo-to-one-role).

HTTPS origin whose pin allows the effective role, and that role has a `githubUser`. `auth=na` and `overall=aligned` together. Exit `0`.

```text
role=work scope=local override=true commit=ok remote=ok auth=na policy=ok overall=aligned
```

HTTPS origin with no pin. `auth=warn` and `overall=warning`. Exit `2`.

```text
role=work scope=local override=true commit=ok remote=ok auth=warn policy=na overall=warning
```

HTTPS origin whose pin does not allow the effective role. `auth=warn` and `overall=warning`. Exit `2`.

```text
role=personal scope=local override=true commit=ok remote=ok auth=warn policy=warn overall=warning
```

Effective role is outside `allowedRoles`. `policy=warn` and `overall=warning`. Exit `2`.

```text
role=client-acme scope=local override=true commit=ok remote=ok auth=ok policy=warn overall=warning
```

Read `overall` by name. It is the eighth field, after `policy`.

```bash
result=$(gitrole status --short)
overall=$(echo "$result" | grep -o 'overall=[^ ]*' | cut -d= -f2)

if [ "$overall" != "aligned" ]; then
  echo "repo is not aligned, stopping"
  exit 1
fi
```

<p>Prompt snippets call <code>gitrole status --short --offline</code> only. <code>gitrole:work ✓</code> means commit and policy are ok and auth was not checked. It does not mean network auth was verified. Live auth verification is for push-time <code>gitrole doctor</code> and the optional check-only hook, not the prompt. <code>auth=na</code> is a skipped probe, not a green auth check. <code>auth=ok</code> means the line did not come from <code>--offline</code>; the segment shows ⚠ because ✓ only covers the offline contract. <code>gitrole:? ⚠</code> stays reserved for an unreadable or malformed line, missing fields, a failed command, or <code>gitrole</code> not on <code>PATH</code>. The segment lines and copy-paste snippets are in <code>examples/prompt/</code>. Setup for Starship, oh-my-zsh, zsh, bash, and fish is in <a href="{{ '/guides/show-gitrole-in-your-shell-prompt/' | url }}">Show gitrole in your shell prompt</a>.</p>

<h3 id="status-short-offline"><code>--offline</code></h3>

<p><code>--offline</code> skips the live SSH <code>githubUser</code> probe. Field names and order stay the same. <code>auth=na</code> on SSH means the probe was skipped. That <code>na</code> does not by itself set <code>overall=warning</code>. <code>--offline</code> does not emit <code>auth=ok</code>.</p>

<p>Local checks still run: commit identity, <code>GIT_AUTHOR_*</code> and <code>GIT_COMMITTER_*</code> overrides, a fresh repo with no local role, remote host compared with the saved <code>githubHost</code>, and <code>.gitrole</code> policy.</p>

<p>HTTPS auth is the same with or without <code>--offline</code>. It uses the repo pin and the saved role's <code>githubUser</code>. No pin, or a pin that does not allow the active role, is <code>auth=warn</code>. A pin that allows the role, when that role has a <code>githubUser</code>, is <code>auth=na</code>.</p>

SSH remote, probe skipped. <code>auth=na</code> and <code>overall=aligned</code> when the local checks are clean. Exit <code>0</code>.

```text
role=work scope=local override=true commit=ok remote=ok auth=na policy=na overall=aligned
```

<p>A live <code>gitrole status --short</code> on that same SSH remote would probe GitHub and might report <code>auth=ok</code> or <code>auth=warn</code> instead. The prompt helper does not do that.</p>

<h3 id="status-short-fields">Fields</h3>

Exactly one line. Eight `key=value` fields, in this order, separated by single spaces.

| Field      | What it tells you | Values |
| ---------- | ----------------- | ------ |
| `role`     | Saved role that matches the current commit identity | role name, or `no-role` |
| `scope`    | Where the commit identity comes from | `global`, `local`, `mixed`, `unset` |
| `override` | Whether a repo-local Git config is active | `true`, `false` |
| `commit`   | Commit identity check | `ok`, `warn`, `na` |
| `remote`   | Remote and repo alignment | `ok`, `warn`, `na` |
| `auth`     | SSH `githubUser` probe, or the HTTPS pin check | `ok`, `warn`, `na` |
| `policy`   | `.gitrole` against the effective role | `ok`, `warn`, `na` |
| `overall`  | Summary | `aligned`, `warning` |

| Field | `na` when |
| ----- | --------- |
| `remote` | Not inside a Git repo |
| `auth` | Not inside a Git repo, no `origin`, HTTPS whose pin allows the active role and that role has a `githubUser`, or `--offline` when the live SSH probe is skipped |
| `policy` | No `.gitrole` file |

<h4 id="status-short-na">How <code>na</code> rolls into <code>overall</code></h4>

`na` means that check does not apply. It does not by itself set `overall=warning` or exit `2`.

| What is true | `overall` | Exit |
| ------------ | --------- | ---- |
| `commit`, `remote`, `auth`, or `policy` is `warn` | `warning` | `2` |
| Working directory is outside a Git repo | `warning` | `2` |
| Those checks are only `ok` or `na`, inside a Git repo | `aligned` | `0` |

Only `warn` on those checks, or being outside a Git repo, drives `overall=warning`. `policy=na` when there is no `.gitrole` file can sit next to `overall=aligned` when nothing is `warn`.

`auth` on SSH is `ok` or `warn` from the `githubUser` probe. `--offline` does not run that probe, so SSH `auth` is `na`. On HTTPS, `auth=na` only when a repo pin allows the active role and that role has a `githubUser`. That `na` does not by itself set `overall=warning` or exit `2`. No pin, or a pin that does not allow the active role, is `auth=warn` and exit `2`. HTTPS auth is the same with `--offline`.

`policy=ok` when `.gitrole` allows the effective role: that role is `defaultRole`, or it is listed in `allowedRoles`. `policy=warn` when the evaluation is `notAllowed`.

<h3 id="status-short-exit-codes">Exit codes</h3>

| Code | Meaning |
| ---- | ------- |
| `0` | `overall=aligned`. The line was written to stdout. An HTTPS repo reaches this only when the pin allows the active role, that role has a `githubUser`, and no other field is `warn`. |
| `2` | `overall=warning`. The line was written to stdout. |
| `1` | Failure. Error on stderr. Stdout empty. No line. |

<h3 id="status-short-failures">When it fails</h3>

Exit `1` writes the error to stderr and does not print the line.

| Condition | Result |
| --------- | ------ |
| Saved role data contains a name outside the [role name format](#role-name-format) | exit `1`, empty stdout, stderr `error: saved role data is invalid; fix or recreate the roles file` |
| Saved role is already named `no-role` | not this failure; the line is still printed. [`gitrole doctor`](#doctor-json) warns and suggests a rename |
| `.gitrole` is invalid JSON or fails schema validation | exit `1`, stderr, empty stdout |
| Invalid `.gitrole` `defaultRole` or `allowedRoles` name | exit `1`, empty stdout. Policy is loaded before the line is written. See [Role name format](#role-name-format). |
| Another operational failure before the line is written | exit `1`, stderr, empty stdout |

A missing `.gitrole` file still prints the line, with `policy=na`.

<h3 id="status-short-stable">What's stable</h3>

Field names, this order, and the value vocabularies above are the contract:

```text
role scope override commit remote auth policy overall
```

`policy` is the seventh field. `overall` is the eighth. Read them by name. A parser that treated the seventh field as `overall` is reading `policy` now.

Changing a name, the order, or a vocabulary is a breaking change.

<h2 id="doctor-json"><code>gitrole doctor --json</code></h2>

<p>Structured diagnosis: commit identity, repo context, SSH auth, and <code>.gitrole</code> policy.</p>

<p><a href="#doctor-json-signature">Signature</a> · <a href="#doctor-json-example">Example</a> · <a href="#doctor-json-fields">Fields</a> · <a href="#doctor-json-exit-codes">Exit codes</a> · <a href="#doctor-json-failures">When it fails</a> · <a href="#doctor-json-stable">What's stable</a></p>

<h3 id="doctor-json-signature">Signature</h3>

```bash
gitrole doctor --json
```

<h3 id="doctor-json-example">Example</h3>

```json
{
  "role": {
    "name": "work",
    "fullName": "Alex Developer",
    "email": "alex@work.example",
    "sshKeyPath": "~/.ssh/id_work",
    "githubUser": "acme-dev",
    "githubHost": "github.com-work"
  },
  "overall": "aligned",
  "commitIdentity": {
    "fullName": { "value": "Alex Developer", "source": "local" },
    "email": { "value": "alex@work.example", "source": "local" }
  },
  "configuredIdentity": {
    "local": {
      "fullName": "Alex Developer",
      "email": "alex@work.example"
    },
    "global": {
      "fullName": "Example Global Identity",
      "email": "global@example.test"
    }
  },
  "scope": {
    "effective": "local",
    "hasLocalOverride": true
  },
  "repository": {
    "isInsideWorkTree": true,
    "hasCommits": true,
    "topLevelPath": "/path/to/service",
    "currentBranch": "main",
    "remote": {
      "name": "origin",
      "url": "git@github.com-work:acme/service.git",
      "protocol": "ssh",
      "host": "github.com-work",
      "owner": "acme",
      "repository": "service"
    }
  },
  "sshAuth": {
    "ok": true,
    "host": "github.com-work",
    "githubUser": "acme-dev"
  },
  "checks": [
    {
      "status": "ok",
      "label": "role",
      "message": "commit identity matches saved role work"
    }
  ]
}
```

HTTPS auth is `info`, with message `origin uses HTTPS; SSH auth verification does not apply`, only when a repo pin allows the active role and that role has a `githubUser`. No pin, or a pin that does not allow the active role, is `warn` and exit `2`. `sshAuth` is omitted when no SSH probe runs.

<h3 id="doctor-json-fields">Fields</h3>

<h4 id="doctor-json-top-level">Top-level fields</h4>

| Field                | What it tells you |
| -------------------- | ----------------- |
| `role`               | Saved role that matches the current commit identity. Omitted if no role matches. |
| `overall`            | `aligned` or `warning` |
| `commitIdentity`     | Effective name and email, plus where each comes from: `local`, `global`, `env`, or `unset` |
| `configuredIdentity` | Raw local and global Git config values |
| `scope`              | Aggregate view of where the commit identity comes from |
| `repository`         | Repo context, branch, and parsed remote info |
| `sshAuth`            | SSH probe result. Omitted if no SSH probe was run, including HTTPS origins. |
| `repoPolicy`         | `.gitrole` policy evaluation. Omitted if no policy file exists. |
| `checks`             | Ordered list of individual check results |

<h4 id="doctor-json-commit-identity"><code>commitIdentity</code></h4>

| Field             | Meaning | Values |
| ----------------- | ------- | ------ |
| `fullName.value`  | Effective commit author name | string, or omitted when unset |
| `fullName.source` | Where the effective name came from | `local`, `global`, `env`, `unset` |
| `email.value`     | Effective commit author email | string, or omitted when unset |
| `email.source`    | Where the effective email came from | `local`, `global`, `env`, `unset` |

<h4 id="doctor-json-configured-identity"><code>configuredIdentity</code></h4>

| Field | Meaning |
| ----- | ------- |
| `configuredIdentity.local.fullName` | Raw repo-local `user.name`, if present |
| `configuredIdentity.local.email` | Raw repo-local `user.email`, if present |
| `configuredIdentity.global.fullName` | Raw global `user.name`, if present |
| `configuredIdentity.global.email` | Raw global `user.email`, if present |

<h4 id="doctor-json-scope"><code>scope</code></h4>

| Field | Meaning | Values |
| ----- | ------- | ------ |
| `effective` | Aggregate source for the active commit identity | `local`, `global`, `mixed`, `unset` |
| `hasLocalOverride` | Whether either commit-identity field is sourced from repo-local config | `true`, `false` |

<h4 id="doctor-json-repository"><code>repository</code></h4>

| Field | Meaning |
| ----- | ------- |
| `isInsideWorkTree` | Whether the current working directory is inside a Git work tree |
| `hasCommits` | Whether `HEAD` exists. Omitted outside a Git repo. |
| `topLevelPath` | Absolute path to the repo root. Omitted outside a Git repo. |
| `currentBranch` | Current branch name, when available |
| `upstreamBranch` | Configured upstream branch, when available |
| `remote` | Parsed `origin` remote info. Omitted when `origin` is not configured. |

<h4 id="doctor-json-remote"><code>repository.remote</code></h4>

| Field | Meaning | Values |
| ----- | ------- | ------ |
| `name` | Remote name | currently `origin` |
| `url` | Raw remote URL | string |
| `protocol` | Parsed remote protocol | `ssh`, `https`, `unknown` |
| `host` | Parsed remote host | string when parseable |
| `owner` | Parsed repository owner or org | string when parseable |
| `repository` | Parsed repository name | string when parseable |

<h4 id="doctor-json-ssh-auth"><code>sshAuth</code></h4>

| Field | Meaning |
| ----- | ------- |
| `ok` | Whether the SSH probe succeeded |
| `host` | SSH host alias or hostname that was probed |
| `githubUser` | GitHub user resolved from the SSH probe, when available |
| `message` | Probe detail when no GitHub user could be resolved |

<h4 id="doctor-json-repo-policy"><code>repoPolicy</code></h4>

| Field | Meaning | Values |
| ----- | ------- | ------ |
| `version` | Policy schema version | currently `1` |
| `defaultRole` | Preferred role for this repo | role name |
| `allowedRoles` | Roles allowed by `.gitrole` | array of role names |
| `effectiveRole` | Active matched role used for evaluation | role name, or omitted |
| `status` | Policy evaluation result | `default`, `allowed`, `notAllowed` |

`status` `default` and `allowed` are `policy=ok` on [`status --short`](#status-short). `notAllowed` is `policy=warn`.

<h4 id="doctor-json-checks"><code>checks</code></h4>

```json
{
  "status": "ok",
  "label": "role",
  "message": "commit identity matches saved role work"
}
```

| Field | Meaning | Values |
| ----- | ------- | ------ |
| `status` | Per-check result | `ok`, `warn`, `info` |
| `label` | Diagnostic category string | short string such as `role`, `remote`, or `auth` |
| `message` | Human-readable explanation | string; do not parse this |

When a pin allows the active role and that role has a `githubUser`, the HTTPS auth entry is `info`:

```json
{
  "status": "info",
  "label": "auth",
  "message": "origin uses HTTPS; SSH auth verification does not apply"
}
```

No pin is `warn`. With no `githubUser` on the active role:

```json
{
  "status": "warn",
  "label": "auth",
  "message": "origin uses HTTPS and no identity pin is configured"
}
```

With a `githubUser` but no allowing `.gitrole`, the message is `origin uses HTTPS and no repo pin is configured`.

A pin that does not allow the active role is `warn`. When both github users are known and differ:

```json
{
  "status": "warn",
  "label": "auth",
  "message": "origin uses HTTPS; github user thisyearearth does not match pin alex-dev"
}
```

Otherwise the message is `origin uses HTTPS; active identity does not match pinned role <defaultRole>`.

`info` does not set `overall` to `warning` and does not cause exit `2`. A `warn` auth check does. Exit `0` with `overall` `aligned` on HTTPS requires the pin to allow the active role, that role to have a `githubUser`, and no other `warn` check.

<h3 id="doctor-json-exit-codes">Exit codes</h3>

| Code | Meaning |
| ---- | ------- |
| `0` | Diagnosis complete, no `warn` check. JSON on stdout. |
| `2` | Diagnosis complete, at least one `warn` check. JSON on stdout. |
| `1` | Failure. Error on stderr. No JSON. |

An HTTPS auth check selects exit `2` when it is `warn` (no pin, or a pin that does not allow the active role). It stays `info`, and does not by itself select exit `2`, only when the pin allows the active role and that role has a `githubUser`.

<h3 id="doctor-json-failures">When it fails</h3>

Exit `1` writes the error to stderr and does not print JSON.

| Condition | Result |
| --------- | ------ |
| Saved role data contains a name outside the [role name format](#role-name-format) | exit `1`, stderr, no JSON |
| Saved role is already named `no-role` | not this failure; JSON is printed, `overall` is `warning`, and a `warn` check suggests a rename |
| `.gitrole` is invalid JSON or fails schema validation | exit `1`, stderr, no JSON |
| Invalid `.gitrole` `defaultRole` or `allowedRoles` name | exit `1`, stderr, no JSON. See [Role name format](#role-name-format). |
| Another operational failure before JSON is written | exit `1`, stderr, no JSON |

A missing `.gitrole` file still returns JSON. `repoPolicy` is omitted.

<h3 id="doctor-json-stable">What's stable</h3>

The top-level field names are the contract. The meaning of `overall`, `scope`, the presence of `checks`, and the `checks[].status` vocabulary (`ok`, `warn`, `info`) are stable. Key order is not. `checks[].message` is descriptive text, not an automation surface. Adding new fields is not a breaking change. Removing or renaming documented top-level fields is.

| Surface | Safe to automate against |
| ------- | ------------------------ |
| `overall` | yes |
| `commitIdentity` | yes |
| `configuredIdentity` | yes |
| `scope` | yes |
| `repository` | yes, but prefer presence/absence and documented fields over incidental details |
| `sshAuth` | yes |
| `repoPolicy` | yes |
| `checks` | yes, as an ordered list of results |

| Surface | Guidance |
| ------- | -------- |
| `checks[].message` | human-readable text; do not parse this |
| `checks[].label` | diagnostic category string; useful for display and debugging, but not a closed vocabulary |
| `repository.currentBranch` | useful context, but not the primary contract surface |
| `repository.topLevelPath` | useful context, but not the primary contract surface |

Nested fields above are documented for meaning and current shape. Additive changes may happen over time.

<h2 id="resolve-json"><code>gitrole resolve --json</code></h2>

<p>The <code>.gitrole</code> policy as JSON, without a full diagnosis.</p>

<p><a href="#resolve-json-signature">Signature</a> · <a href="#resolve-json-example">Example</a> · <a href="#resolve-json-fields">Fields</a> · <a href="#resolve-json-exit-codes">Exit codes</a> · <a href="#resolve-json-failures">When it fails</a> · <a href="#resolve-json-stable">What's stable</a></p>

<h3 id="resolve-json-signature">Signature</h3>

```bash
gitrole resolve --json
```

<h3 id="resolve-json-example">Example</h3>

```json
{
  "version": 1,
  "defaultRole": "work",
  "allowedRoles": ["work", "maintainer-personal"]
}
```

<h3 id="resolve-json-fields">Fields</h3>

| Field | What it tells you |
| ----- | ----------------- |
| `version` | Policy schema version. Currently always `1`. |
| `defaultRole` | The preferred role for this repo |
| `allowedRoles` | Roles that are valid here. `defaultRole` is always included. |

<h3 id="resolve-json-exit-codes">Exit codes</h3>

| Code | Meaning |
| ---- | ------- |
| `0` | Policy resolved. JSON on stdout. |
| `1` | Failure. Error on stderr. No JSON. |

<h3 id="resolve-json-failures">When it fails</h3>

`resolve --json` does not emit empty success output when `.gitrole` is missing. It exits `1`, writes the error to stderr, and prints no JSON.

| Condition | Result |
| --------- | ------ |
| Not inside a Git repo | exit `1`, stderr message, no JSON |
| No `.gitrole` file exists | exit `1`, stderr message, no JSON |
| `.gitrole` is invalid JSON or fails schema validation | exit `1`, stderr message, no JSON |
| invalid `defaultRole` or `allowedRoles` name          | exit `1`, stderr message, no JSON |

<h3 id="resolve-json-stable">What's stable</h3>

The field names `version`, `defaultRole`, and `allowedRoles` are the contract. `version` is `1`. Key order is not. `status` and `doctor` still run when the file is absent; this command does not.

<h2 id="role-name-format">Role name format</h2>

Saved role names use this format so machine-readable values such as `role=` stay unambiguous.

| Rule | Allowed |
| ---- | ------- |
| letters | lowercase `a-z` only |
| digits | `0-9` |
| separators | `-`, `_` |
| disallowed | spaces, slashes, uppercase, and other punctuation |

| Example | Valid |
| ------- | ----- |
| `work` | yes |
| `personal` | yes |
| `client-acme` | yes |
| `agent_bot` | yes |
| `client acme` | no |
| `Work` | no |
| `my@role` | no |
| `no-role` | no; reserved sentinel |

Creating a role with an invalid name prints:

```text
error: invalid role name "client acme"; use lowercase letters, numbers, "-" or "_"
```

`no-role` matches the shape above, and it is still reserved. `status --short` writes `role=no-role` when no saved role matches. `gitrole add no-role` and `gitrole import current --name no-role` exit `1`, write this to stderr, and print nothing on stdout:

```text
error: role name "no-role" is reserved for the status and prompt sentinel when no saved role matches; choose a different name
```

A saved role that already uses that name is not deleted or renamed. `gitrole doctor` warns and suggests adding the identity under a new name, then `gitrole remove no-role`. `gitrole status` still prints its line. The prompt segment still chooses `✓` or `⚠` from the status fields only, so a hand-built aligned line with `role=no-role` stays `gitrole:no-role ✓`.

If saved role data already contains a name outside this format, commands that load saved roles fail closed: exit `1`, error on stderr, nothing on stdout. That includes [`gitrole status --short`](#status-short-failures) and [`gitrole doctor --json`](#doctor-json-failures). The reserved name `no-role` is not that failure.

The same rules apply to `.gitrole` `defaultRole` and every `allowedRoles` entry. An invalid policy name is fail-closed. These commands exit `1`, write the error to stderr, and write nothing to stdout:

- `gitrole resolve`
- `gitrole resolve --json`
- `gitrole status`
- `gitrole doctor`
- `gitrole doctor --json`

`gitrole status --short` takes the same path as `gitrole status`: the policy is loaded before the one-line contract is written, so an invalid name also exits `1` with empty stdout. The field names and order for a valid policy are unchanged.

A `defaultRole` of `client acme` produces this stderr line and no stdout:

```text
error: repo policy file .gitrole is invalid: defaultRole invalid role name "client acme"; use lowercase letters, numbers, "-" or "_"
```

An invalid allowed role is reported on that field. With `defaultRole` set to `work` and `Client` in `allowedRoles`:

```text
error: repo policy file .gitrole is invalid: allowedRoles invalid role name "Client"; use lowercase letters, numbers, "-" or "_"
```

A missing `.gitrole` file is not this failure for `status` or `doctor`. Those commands still run without repo policy when the file is absent. `resolve` and `resolve --json` still exit `1` when the file is missing. Valid names such as `client-acme` and `agent_bot` still succeed.
