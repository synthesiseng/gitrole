---
layout: layouts/base.njk
title: Machine Readable CLI Contracts
eyebrow: Reference
summary: Public contract reference for gitrole machine readable CLI output, including status --short, doctor --json, and resolve --json for scripts and automation.
---

gitrole has three commands designed to be consumed by scripts, agents, and automation:

- `gitrole status --short` - fast preflight check, one line of output
- `gitrole doctor --json` - full structured diagnosis
- `gitrole resolve --json` - repo-local identity policy

This page tells you what each one outputs, what the fields mean, and what you can rely on staying stable.

---

## `gitrole status --short`

The fastest way to ask "is this repo ready to commit or push?"

```bash
gitrole status --short
```

Output is exactly one line:

```text
role=work scope=local override=true commit=ok remote=ok auth=ok overall=aligned
```

### Fields

| Field      | What it tells you                                    | Values                              |
| ---------- | ---------------------------------------------------- | ----------------------------------- |
| `role`     | Which saved role matches the current commit identity | role name, or `no-role`             |
| `scope`    | Where the commit identity is coming from             | `global`, `local`, `mixed`, `unset` |
| `override` | Whether a repo-local Git config is active            | `true`, `false`                     |
| `commit`   | Commit identity check result                         | `ok`, `warn`, `na`                  |
| `remote`   | Remote/repo alignment check result                   | `ok`, `warn`, `na`                  |
| `auth`     | SSH push-auth check result                           | `ok`, `warn`, `na`                  |
| `overall`  | Summary                                              | `aligned`, `warning`                |

`na` means the check was not applicable. For example, `remote=na` when you are not inside a Git repo.

### Using it in a script

```bash
result=$(gitrole status --short)
overall=$(echo "$result" | grep -o 'overall=[^ ]*' | cut -d= -f2)

if [ "$overall" != "aligned" ]; then
  echo "repo is not aligned, stopping"
  exit 1
fi
```

### Exit codes

| Code | Meaning                                                  |
| ---- | -------------------------------------------------------- |
| `0`  | Aligned - valid output was emitted                       |
| `2`  | Warning - valid output was emitted, but something is off |
| `1`  | Failure - error written to stderr, no output             |

An invalid `.gitrole` role name is this exit `1` failure for `gitrole status`, including `gitrole status --short`. Policy is loaded before either view is written, so stdout stays empty and the one-line contract is not emitted. See [Role name format](#role-name-format).

### What's stable

Field names, field order, and the value vocabularies above are the contract. If any of those change, it is a breaking change.

---

## `gitrole doctor --json`

The full picture. Use this when you need to understand exactly what is going on: commit identity, push identity, SSH auth, repo policy.

```bash
gitrole doctor --json
```

### Example output

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

### Top-level fields

| Field                | What it tells you                                                                       |
| -------------------- | --------------------------------------------------------------------------------------- |
| `role`               | The saved role that matches the current commit identity. Omitted if no role matches.    |
| `overall`            | `aligned` or `warning`                                                                  |
| `commitIdentity`     | Effective name and email, plus where each is coming from: `local`, `global`, or `unset` |
| `configuredIdentity` | Raw local and global Git config values                                                  |
| `scope`              | Aggregate view of where the commit identity comes from                                  |
| `repository`         | Repo context, branch, and parsed remote info                                            |
| `sshAuth`            | SSH probe result. Omitted if no SSH probe was run.                                      |
| `repoPolicy`         | `.gitrole` policy evaluation. Omitted if no policy file exists.                         |
| `checks`             | Ordered list of individual check results                                                |

The top-level field names above are the stable contract for `doctor --json`.

### Safe automation targets

Use these parts for automation:

| Surface              | Safe to automate against                                                       |
| -------------------- | ------------------------------------------------------------------------------ |
| `overall`            | yes                                                                            |
| `commitIdentity`     | yes                                                                            |
| `configuredIdentity` | yes                                                                            |
| `scope`              | yes                                                                            |
| `repository`         | yes, but prefer presence/absence and documented fields over incidental details |
| `sshAuth`            | yes                                                                            |
| `repoPolicy`         | yes                                                                            |
| `checks`             | yes, as an ordered list of results                                             |

Do not treat every descriptive field as the same kind of contract:

| Surface                    | Guidance                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| `checks[].message`         | human-readable text; do not parse this                                                    |
| `checks[].label`           | diagnostic category string; useful for display and debugging, but not a closed vocabulary |
| `repository.currentBranch` | useful context, but not the primary contract surface                                      |
| `repository.topLevelPath`  | useful context, but not the primary contract surface                                      |

### Important nested fields

These nested fields are documented for meaning and current shape. Additive changes may happen over time.

#### `commitIdentity`

| Field             | Meaning                             | Values                        |
| ----------------- | ----------------------------------- | ----------------------------- |
| `fullName.value`  | Effective commit author name        | string, or omitted when unset |
| `fullName.source` | Where the effective name came from  | `local`, `global`, `unset`    |
| `email.value`     | Effective commit author email       | string, or omitted when unset |
| `email.source`    | Where the effective email came from | `local`, `global`, `unset`    |

#### `configuredIdentity`

| Field                                | Meaning                                 |
| ------------------------------------ | --------------------------------------- |
| `configuredIdentity.local.fullName`  | Raw repo-local `user.name`, if present  |
| `configuredIdentity.local.email`     | Raw repo-local `user.email`, if present |
| `configuredIdentity.global.fullName` | Raw global `user.name`, if present      |
| `configuredIdentity.global.email`    | Raw global `user.email`, if present     |

#### `scope`

| Field              | Meaning                                                                | Values                              |
| ------------------ | ---------------------------------------------------------------------- | ----------------------------------- |
| `effective`        | Aggregate source for the active commit identity                        | `local`, `global`, `mixed`, `unset` |
| `hasLocalOverride` | Whether either commit-identity field is sourced from repo-local config | `true`, `false`                     |

#### `repository`

| Field              | Meaning                                                               |
| ------------------ | --------------------------------------------------------------------- |
| `isInsideWorkTree` | Whether the current working directory is inside a Git work tree       |
| `hasCommits`       | Whether `HEAD` exists. Omitted outside a Git repo.                    |
| `topLevelPath`     | Absolute path to the repo root. Omitted outside a Git repo.           |
| `currentBranch`    | Current branch name, when available                                   |
| `upstreamBranch`   | Configured upstream branch, when available                            |
| `remote`           | Parsed `origin` remote info. Omitted when `origin` is not configured. |

#### `repository.remote`

| Field        | Meaning                        | Values                    |
| ------------ | ------------------------------ | ------------------------- |
| `name`       | Remote name                    | currently `origin`        |
| `url`        | Raw remote URL                 | string                    |
| `protocol`   | Parsed remote protocol         | `ssh`, `https`, `unknown` |
| `host`       | Parsed remote host             | string when parseable     |
| `owner`      | Parsed repository owner or org | string when parseable     |
| `repository` | Parsed repository name         | string when parseable     |

#### `sshAuth`

| Field        | Meaning                                                 |
| ------------ | ------------------------------------------------------- |
| `ok`         | Whether the SSH probe succeeded                         |
| `host`       | SSH host alias or hostname that was probed              |
| `githubUser` | GitHub user resolved from the SSH probe, when available |
| `message`    | Probe detail when no GitHub user could be resolved      |

#### `repoPolicy`

| Field           | Meaning                                 | Values                             |
| --------------- | --------------------------------------- | ---------------------------------- |
| `version`       | Policy schema version                   | currently `1`                      |
| `defaultRole`   | Preferred role for this repo            | role name                          |
| `allowedRoles`  | Roles allowed by `.gitrole`             | array of role names                |
| `effectiveRole` | Active matched role used for evaluation | role name, or omitted              |
| `status`        | Policy evaluation result                | `default`, `allowed`, `notAllowed` |

### The `checks` array

Each entry looks like:

```json
{
  "status": "ok",
  "label": "role",
  "message": "commit identity matches saved role work"
}
```

| Field     | Meaning                    | Values                                           |
| --------- | -------------------------- | ------------------------------------------------ |
| `status`  | Per-check result           | `ok`, `warn`, `info`                             |
| `label`   | Diagnostic category string | short string such as `role`, `remote`, or `auth` |
| `message` | Human-readable explanation | string; do not parse this                        |

### Exit codes

| Code | Meaning                                       |
| ---- | --------------------------------------------- |
| `0`  | Diagnosis complete, no warnings               |
| `2`  | Diagnosis complete, at least one `warn` check |
| `1`  | Failure - error written to stderr, no JSON    |

An invalid `.gitrole` `defaultRole` or `allowedRoles` name is this exit `1` failure: stderr gets the error and stdout stays empty, so no JSON is emitted. See [Role name format](#role-name-format).

### What's stable

The top-level field names are the contract. The meaning of `overall`, `scope`, the presence of `checks`, and the `checks[].status` vocabulary are stable. Key order is not. `checks[].message` is descriptive text, not an automation surface. Adding new fields is not a breaking change; removing or renaming documented top-level fields is.

---

## `gitrole resolve --json`

Returns the `.gitrole` repo-local identity policy as JSON. Useful when you need to know the expected role for a repo without running a full diagnosis.

```bash
gitrole resolve --json
```

### Output

```json
{
  "version": 1,
  "defaultRole": "work",
  "allowedRoles": ["work", "maintainer-personal"]
}
```

| Field          | What it tells you                                                |
| -------------- | ---------------------------------------------------------------- |
| `version`      | Policy schema version. Currently always `1`.                     |
| `defaultRole`  | The preferred role for this repo                                 |
| `allowedRoles` | All roles that are valid here. `defaultRole` is always included. |

### When it fails

`resolve --json` does not emit empty success output when `.gitrole` is missing. It fails clearly, exits nonzero, and writes the error to stderr with no JSON.

`resolve --json` exits with code `1` and writes to stderr with no JSON when:

| Condition                                             | Result                            |
| ----------------------------------------------------- | --------------------------------- |
| Not inside a Git repo                                 | exit `1`, stderr message, no JSON |
| No `.gitrole` file exists                             | exit `1`, stderr message, no JSON |
| `.gitrole` is invalid JSON or fails schema validation | exit `1`, stderr message, no JSON |
| invalid `defaultRole` or `allowedRoles` name          | exit `1`, stderr message, no JSON |

### Exit codes

| Code | Meaning                                    |
| ---- | ------------------------------------------ |
| `0`  | Policy resolved, JSON emitted              |
| `1`  | Failure - error written to stderr, no JSON |

---

<h2 id="role-name-format">Role name format</h2>

Role names are constrained so machine-readable output stays unambiguous.

| Rule       | Allowed                                           |
| ---------- | ------------------------------------------------- |
| letters    | lowercase `a-z` only                              |
| digits     | `0-9`                                             |
| separators | `-`, `_`                                          |
| disallowed | spaces, slashes, uppercase, and other punctuation |

| Example       | Valid |
| ------------- | ----- |
| `work`        | yes   |
| `personal`    | yes   |
| `client-acme` | yes   |
| `agent_bot`   | yes   |
| `client acme` | no    |
| `Work`        | no    |
| `my@role`     | no    |

If you try to create a role with an invalid name, you will get:

```text
error: invalid role name "client acme"; use lowercase letters, numbers, "-" or "_"
```

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
