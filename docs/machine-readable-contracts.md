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
  <dd>Full diagnosis as JSON. HTTPS auth is an <code>info</code> check.</dd>
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
```

<h3 id="status-short-example">Example</h3>

No `.gitrole` file. `policy=na`.

```text
role=work scope=local override=true commit=ok remote=ok auth=ok policy=na overall=aligned
```

HTTPS origin whose pin allows the effective role. `auth=na` and `overall=aligned` together. Exit `0`.

```text
role=work scope=local override=true commit=ok remote=ok auth=na policy=ok overall=aligned
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

<h3 id="status-short-fields">Fields</h3>

Exactly one line. Eight `key=value` fields, in this order, separated by single spaces.

| Field      | What it tells you | Values |
| ---------- | ----------------- | ------ |
| `role`     | Saved role that matches the current commit identity | role name, or `no-role` |
| `scope`    | Where the commit identity comes from | `global`, `local`, `mixed`, `unset` |
| `override` | Whether a repo-local Git config is active | `true`, `false` |
| `commit`   | Commit identity check | `ok`, `warn`, `na` |
| `remote`   | Remote and repo alignment | `ok`, `warn`, `na` |
| `auth`     | SSH `githubUser` probe on SSH origins | `ok`, `warn`, `na` |
| `policy`   | `.gitrole` against the effective role | `ok`, `warn`, `na` |
| `overall`  | Summary | `aligned`, `warning` |

`na` means that check does not apply.

| Field | `na` when |
| ----- | --------- |
| `remote` | Not inside a Git repo |
| `auth` | Not inside a Git repo, no `origin`, or `origin` is HTTPS |
| `policy` | No `.gitrole` file |

`auth` on SSH is `ok` or `warn` from the `githubUser` probe. `auth=na` on HTTPS is not a warning. It does not by itself set `overall=warning` or exit `2`.

`policy=ok` when `.gitrole` allows the effective role: that role is `defaultRole`, or it is listed in `allowedRoles`. `policy=warn` when the evaluation is `notAllowed`.

`overall=warning` when the working directory is outside a Git repo, or when `commit`, `remote`, `auth`, or `policy` is `warn`. Otherwise `overall=aligned`.

<h3 id="status-short-exit-codes">Exit codes</h3>

| Code | Meaning |
| ---- | ------- |
| `0` | `overall=aligned`. The line was written to stdout. This includes a clean HTTPS repo. |
| `2` | `overall=warning`. The line was written to stdout. |
| `1` | Failure. Error on stderr. Stdout empty. No line. |

<h3 id="status-short-failures">When it fails</h3>

Exit `1` writes the error to stderr and does not print the line.

| Condition | Result |
| --------- | ------ |
| Saved role data contains a name outside the [role name format](#role-name-format) | exit `1`, empty stdout, stderr `error: saved role data is invalid; fix or recreate the roles file` |
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

HTTPS origins add an auth check with `status` `info` and this message: `origin uses HTTPS; SSH auth verification does not apply`. That check is not `warn`. `sshAuth` is omitted when no SSH probe runs.

<h3 id="doctor-json-fields">Fields</h3>

<h4 id="doctor-json-top-level">Top-level fields</h4>

| Field                | What it tells you |
| -------------------- | ----------------- |
| `role`               | Saved role that matches the current commit identity. Omitted if no role matches. |
| `overall`            | `aligned` or `warning` |
| `commitIdentity`     | Effective name and email, plus where each comes from: `local`, `global`, or `unset` |
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
| `fullName.source` | Where the effective name came from | `local`, `global`, `unset` |
| `email.value`     | Effective commit author email | string, or omitted when unset |
| `email.source`    | Where the effective email came from | `local`, `global`, `unset` |

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

On an HTTPS origin the auth entry is `info`, not `warn`:

```json
{
  "status": "info",
  "label": "auth",
  "message": "origin uses HTTPS; SSH auth verification does not apply"
}
```

`info` does not set `overall` to `warning` and does not cause exit `2`. Exit `0` with `overall` `aligned` is reachable on HTTPS when identity and policy are fine.

<h3 id="doctor-json-exit-codes">Exit codes</h3>

| Code | Meaning |
| ---- | ------- |
| `0` | Diagnosis complete, no `warn` check. JSON on stdout. |
| `2` | Diagnosis complete, at least one `warn` check. JSON on stdout. |
| `1` | Failure. Error on stderr. No JSON. |

An HTTPS auth check is `info`, so it does not by itself select exit `2`.

<h3 id="doctor-json-failures">When it fails</h3>

Exit `1` writes the error to stderr and does not print JSON.

| Condition | Result |
| --------- | ------ |
| Saved role data contains a name outside the [role name format](#role-name-format) | exit `1`, stderr, no JSON |
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

Creating a role with an invalid name prints:

```text
error: invalid role name "client acme"; use lowercase letters, numbers, "-" or "_"
```

If saved role data already contains a name outside this format, commands that load saved roles fail closed: exit `1`, error on stderr, nothing on stdout. That includes [`gitrole status --short`](#status-short-failures) and [`gitrole doctor --json`](#doctor-json-failures).

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
