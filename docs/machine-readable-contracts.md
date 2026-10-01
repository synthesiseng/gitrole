---
layout: layouts/base.njk
title: Machine Readable CLI Contracts
eyebrow: Reference
summary: Public contract reference for gitrole machine readable CLI output, including status --short, doctor --json, and resolve --json for scripts and automation.
---

<p>Scripts and agents break when they guess which field is the summary, or when they paraphrase <code>overall</code> as "ok". This page is the contract for the three commands they should parse. Field names, values, and exit codes below are the ones the CLI writes.</p>

<h2 id="quick-start">Quick start</h2>

<p>For a commit or a push check, run:</p>

```bash
gitrole status --short
```

<p>Read <code>overall</code> by name. It is the eighth field. <code>policy</code> is the seventh, so a parser that still treats field seven as the summary is reading <code>policy</code>. <code>overall=aligned</code> exits <code>0</code>. <code>overall=warning</code> exits <code>2</code> and still prints the line. Exit <code>1</code> is a failure: the error is on stderr and stdout is empty. If you only need to stop on a warning, you can stop here.</p>

<p>A local role, SSH auth matched, no <code>.gitrole</code> file:</p>

```text
role=work scope=local override=true commit=ok remote=ok auth=ok policy=na overall=aligned
```

```bash
result=$(gitrole status --short)
overall=$(echo "$result" | grep -o 'overall=[^ ]*' | cut -d= -f2)

if [ "$overall" != "aligned" ]; then
  echo "repo is not aligned, stopping"
  exit 1
fi
```

<p>Shell prompts call <code>gitrole status --short --offline</code> instead, so they don't open SSH on every redraw. <code>--offline</code> does not emit <code>auth=ok</code>. Setup and the segment glyphs are in <a href="{{ '/guides/show-gitrole-in-your-shell-prompt/' | url }}">Show gitrole in your shell prompt</a>.</p>

<dl class="command-list">
  <dt><a href="#status-short"><code>gitrole status --short</code></a></dt>
  <dd>One line. Order is <code>role scope override commit remote auth policy overall</code>.</dd>
  <dt><a href="#doctor-json"><code>gitrole doctor --json</code></a></dt>
  <dd>Full diagnosis as JSON. HTTPS auth is <code>info</code> only when a pin allows the role and that role has a <code>githubUser</code>. This does not verify HTTPS credentials. Otherwise it is <code>warn</code>.</dd>
  <dt><a href="#resolve-json"><code>gitrole resolve --json</code></a></dt>
  <dd>The <code>.gitrole</code> file as JSON.</dd>
  <dt><a href="#role-name-format">Role name format</a></dt>
  <dd>Saved role names, and the reserved <code>role=no-role</code> sentinel.</dd>
</dl>

<h2 id="status-short"><code>gitrole status --short</code></h2>

<p>One line answers whether this repo is aligned to commit or push. <code>--offline</code> is the same line with the live SSH probe skipped.</p>

<h3 id="status-short-signature">Signature</h3>

```bash
gitrole status --short
gitrole status --short --offline
```

<h3 id="status-short-example">How to read the line</h3>

<p>Exactly one line. Eight <code>key=value</code> fields, in this order, separated by single spaces. A pin is the repo's <code>.gitrole</code> file (what <code>gitrole pin</code> writes). It names <code>defaultRole</code> and <code>allowedRoles</code>. See <a href="{{ '/guides/use-repo-local-identity-policy-with-gitrole/' | url }}#pin-a-repo-to-one-role">Pin a repo to one role</a>.</p>

<p>No <code>.gitrole</code> file, so <code>policy=na</code>, and SSH auth matched:</p>

```text
role=work scope=local override=true commit=ok remote=ok auth=ok policy=na overall=aligned
```

<p>HTTPS-only push destination whose pin allows the effective role, and that role has a <code>githubUser</code>. <code>auth=na</code> and <code>overall=aligned</code> together. Exit <code>0</code>. <code>auth=na</code> here means SSH verification doesn't apply, not that a probe passed:</p>

```text
role=work scope=local override=true commit=ok remote=ok auth=na policy=ok overall=aligned
```

<p>HTTPS-only push destination with no pin. Since 0.8.0 this is <code>auth=warn</code> and <code>overall=warning</code>, exit <code>2</code>. gitrole can't tell which GitHub user the push will use:</p>

```text
role=work scope=local override=true commit=ok remote=ok auth=warn policy=na overall=warning
```

<p>HTTPS-only push destination whose pin doesn't allow the effective role. <code>auth=warn</code> and <code>policy=warn</code>. Exit <code>2</code>:</p>

```text
role=personal scope=local override=true commit=ok remote=ok auth=warn policy=warn overall=warning
```

<p>Effective role is outside <code>allowedRoles</code>. <code>policy=warn</code> and <code>overall=warning</code>. Exit <code>2</code>:</p>

```text
role=client-acme scope=local override=true commit=ok remote=ok auth=ok policy=warn overall=warning
```

<h3>Default push observation</h3>

<p><code>remote</code> and <code>auth</code> cover the destination of a plain <code>git push</code>, not the fetch origin. Selection follows branch <code>pushRemote</code>, <code>remote.pushDefault</code>, branch remote, sole remote, then origin. Git resolves every URL with <code>git remote get-url --push --all</code>, including configured rewrites. Every endpoint is checked; an unverified endpoint warns. Mixed SSH/HTTPS warns online; offline retains HTTPS pin checks and invokes no SSH.</p>
<p>Online standard OpenSSH inspection includes URL user/port and receive-pack context. Custom Git SSH commands, alternate diagnostic binaries, incomplete configuration, context differences or interactive authentication remain unverified. Inspection may execute configured <code>Match exec</code> commands or DNS lookups. These checks do not prove branch/refspec readiness, remote permission or push success, and do not predict future explicit push arguments.</p>

<h3 id="status-short-offline"><code>--offline</code></h3>

<p><code>--offline</code> skips the live SSH <code>githubUser</code> probe. Field names and order stay the same. <code>auth=na</code> on SSH means the probe was skipped. That <code>na</code> doesn't by itself set <code>overall=warning</code>. <code>--offline</code> does not emit <code>auth=ok</code>.</p>

<p>Local checks still run: commit identity, <code>GIT_AUTHOR_*</code> and <code>GIT_COMMITTER_*</code> overrides, a fresh repo with no local role, remote host compared with the saved <code>githubHost</code>, and <code>.gitrole</code> policy. HTTPS auth is the same with or without <code>--offline</code>, because it uses the repo pin and the saved role's <code>githubUser</code>, not the network.</p>

<p>SSH remote, probe skipped, local checks clean. Exit <code>0</code>:</p>

```text
role=work scope=local override=true commit=ok remote=ok auth=na policy=na overall=aligned
```

<p>A live <code>gitrole status --short</code> on that same SSH remote probes GitHub and can report <code>auth=ok</code> or <code>auth=warn</code> instead. The prompt helper doesn't do that. A line that still says <code>auth=ok</code> didn't come from <code>--offline</code>.</p>

<h3 id="status-short-fields">Fields</h3>

<table>
  <thead>
    <tr><th>Field</th><th>What it tells you</th><th>Values</th></tr>
  </thead>
  <tbody>
    <tr><td><code>role</code></td><td>Saved role that matches the current commit identity</td><td>role name, or <code>no-role</code></td></tr>
    <tr><td><code>scope</code></td><td>Underlying configured author scope, retained under environment overrides</td><td><code>global</code>, <code>local</code>, <code>system</code>, <code>worktree</code>, <code>command</code>, <code>git</code>, <code>mixed</code>, <code>unset</code></td></tr>
    <tr><td><code>override</code></td><td>Whether a repo-local Git config is active</td><td><code>true</code>, <code>false</code></td></tr>
    <tr><td><code>commit</code></td><td>Commit identity check</td><td><code>ok</code>, <code>warn</code>, <code>na</code></td></tr>
    <tr><td><code>remote</code></td><td>All default push destinations against role host expectations</td><td><code>ok</code>, <code>warn</code>, <code>na</code></td></tr>
    <tr><td><code>auth</code></td><td>Every supported SSH push account, or HTTPS-only pin checks; mixed online destinations warn</td><td><code>ok</code>, <code>warn</code>, <code>na</code></td></tr>
    <tr><td><code>policy</code></td><td><code>.gitrole</code> against the effective role</td><td><code>ok</code>, <code>warn</code>, <code>na</code></td></tr>
    <tr><td><code>overall</code></td><td>Summary</td><td><code>aligned</code>, <code>warning</code></td></tr>
  </tbody>
</table>

<table>
  <thead>
    <tr><th>Field</th><th><code>na</code> when</th></tr>
  </thead>
  <tbody>
    <tr><td><code>remote</code></td><td>Not inside a Git repo</td></tr>
    <tr><td><code>auth</code></td><td>Not inside a Git repo, HTTPS whose pin allows the active role and that role has a <code>githubUser</code>, or <code>--offline</code> when the live SSH probe is skipped</td></tr>
    <tr><td><code>policy</code></td><td>No <code>.gitrole</code> file</td></tr>
  </tbody>
</table>

<h4 id="status-short-na">How <code>na</code> rolls into <code>overall</code></h4>

<p><code>na</code> means that check doesn't apply. It doesn't by itself set <code>overall=warning</code> or exit <code>2</code>. <code>policy=na</code> when there is no <code>.gitrole</code> file can sit next to <code>overall=aligned</code> when nothing is <code>warn</code>.</p>

<table>
  <thead>
    <tr><th>What is true</th><th><code>overall</code></th><th>Exit</th></tr>
  </thead>
  <tbody>
    <tr><td><code>commit</code>, <code>remote</code>, <code>auth</code>, or <code>policy</code> is <code>warn</code></td><td><code>warning</code></td><td><code>2</code></td></tr>
    <tr><td>Working directory is outside a Git repo</td><td><code>warning</code></td><td><code>2</code></td></tr>
    <tr><td>Those checks are only <code>ok</code> or <code>na</code>, inside a Git repo</td><td><code>aligned</code></td><td><code>0</code></td></tr>
  </tbody>
</table>

<p>Only <code>warn</code> on those checks, or being outside a Git repo, drives <code>overall=warning</code>. <code>auth</code> on SSH is <code>ok</code> or <code>warn</code> from the <code>githubUser</code> probe. <code>--offline</code> doesn't run that probe, so SSH <code>auth</code> is <code>na</code>. On HTTPS, <code>auth=na</code> only when a repo pin allows the active role and that role has a <code>githubUser</code>. No pin, or a pin that doesn't allow the active role, is <code>auth=warn</code> and exit <code>2</code>.</p>

<p><code>policy=ok</code> when <code>.gitrole</code> allows the effective role: that role is <code>defaultRole</code>, or it is listed in <code>allowedRoles</code>. <code>policy=warn</code> when the evaluation is <code>notAllowed</code>.</p>

<p>Outside a Git repo, with a global name and email that match no saved role, one run printed this line and exited <code>2</code>. <code>remote=na</code> and <code>auth=na</code> because there is no work tree. <code>commit=warn</code> because nothing saved matches. Your <code>role</code> and <code>commit</code> follow the identity that is actually configured. <code>overall</code> is still <code>warning</code> outside a repo:</p>

```text
role=no-role scope=global override=false commit=warn remote=na auth=na policy=na overall=warning
```

<h3 id="status-short-exit-codes">Exit codes</h3>

<table>
  <thead>
    <tr><th>Code</th><th>Meaning</th></tr>
  </thead>
  <tbody>
    <tr><td><code>0</code></td><td><code>overall=aligned</code>. The line was written to stdout. An HTTPS repo reaches this only when the pin allows the active role, that role has a <code>githubUser</code>, and no other field is <code>warn</code>.</td></tr>
    <tr><td><code>2</code></td><td><code>overall=warning</code>. The line was written to stdout.</td></tr>
    <tr><td><code>1</code></td><td>Failure. Error on stderr. Stdout empty. No line.</td></tr>
  </tbody>
</table>

<h3 id="status-short-failures">When it fails</h3>

<p>Exit <code>1</code> writes the error to stderr and doesn't print the line. A missing <code>.gitrole</code> file still prints the line, with <code>policy=na</code>.</p>

<table>
  <thead>
    <tr><th>Condition</th><th>Result</th></tr>
  </thead>
  <tbody>
    <tr><td>Saved role data contains a name outside the <a href="#role-name-format">role name format</a></td><td>exit <code>1</code>, empty stdout, stderr <code>error: saved role data is invalid; fix or recreate the roles file</code></td></tr>
    <tr><td>Saved role is already named <code>no-role</code></td><td>not this failure; the line is still printed. <a href="#doctor-json"><code>gitrole doctor</code></a> warns and suggests a rename</td></tr>
    <tr><td><code>.gitrole</code> is invalid JSON or fails schema validation</td><td>exit <code>1</code>, stderr, empty stdout</td></tr>
    <tr><td>Invalid <code>.gitrole</code> <code>defaultRole</code> or <code>allowedRoles</code> name</td><td>exit <code>1</code>, empty stdout. Policy is loaded before the line is written. See <a href="#role-name-format">Role name format</a>.</td></tr>
    <tr><td>Another operational failure before the line is written</td><td>exit <code>1</code>, stderr, empty stdout</td></tr>
  </tbody>
</table>

<h3 id="status-short-stable">What's stable</h3>

<p>Field names, this order, and the value vocabularies above are the contract:</p>

```text
role scope override commit remote auth policy overall
```

<p><code>policy</code> is the seventh field. <code>overall</code> is the eighth. Read them by name. Since 0.7.6 the line has eight fields. A parser that treated the seventh field as <code>overall</code> is reading <code>policy</code>. Changing a name, the order, or a vocabulary is a breaking change.</p>

<h2 id="doctor-json"><code>gitrole doctor --json</code></h2>

<p>Use this when the one-line check isn't enough and you need commit identity, repo context, SSH auth, and <code>.gitrole</code> policy as JSON. Don't parse <code>checks[].message</code>. Read <code>overall</code>, <code>commitIdentity</code>, and <code>checks[].status</code>.</p>

<h3 id="doctor-json-signature">Signature</h3>

```bash
gitrole doctor --json
```

<h3 id="doctor-json-example">Example</h3>

<p>This illustrative subset shows the single-endpoint JSON shape; additive push/fetch metadata is described below. The saved role <code>work</code> matches the repo-local name and email, <code>origin</code> is <code>git@github.com-work:acme/service.git</code>, the SSH probe returned <code>acme-dev</code>, and there is no <code>.gitrole</code> file, so <code>repoPolicy</code> is omitted. <code>repository.topLevelPath</code> is that repo's absolute path. Yours will differ. Exit <code>0</code>.</p>

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
    "fullName": {
      "value": "Alex Developer",
      "source": "local"
    },
    "email": {
      "value": "alex@work.example",
      "source": "local"
    }
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
    "topLevelPath": "/tmp/gitrole-doc-sample/service",
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
    },
    {
      "status": "info",
      "label": "remote",
      "message": "default push remote origin uses ssh at git@github.com-work:acme/service.git"
    },
    {
      "status": "ok",
      "label": "scope",
      "message": "selected role work is applied via local config"
    },
    {
      "status": "ok",
      "label": "commit",
      "message": "effective commit identity matches selected role work"
    },
    {
      "status": "ok",
      "label": "host",
      "message": "remote host matches role githubHost github.com-work"
    },
    {
      "status": "ok",
      "label": "auth",
      "message": "SSH auth matches role githubUser acme-dev"
    }
  ]
}
```

<p>HTTPS auth is <code>info</code>, with message <code>push destination uses HTTPS; SSH auth verification does not apply</code>, only when a repo pin allows the active role and that role has a <code>githubUser</code>. No pin, or a pin that doesn't allow the active role, is <code>warn</code> and exit <code>2</code>. <code>sshAuth</code> is omitted when no SSH probe runs.</p>

<h3 id="doctor-json-fields">Fields</h3>

<h4 id="doctor-json-top-level">Top-level fields</h4>

<table>
  <thead>
    <tr><th>Field</th><th>What it tells you</th></tr>
  </thead>
  <tbody>
    <tr><td><code>role</code></td><td>Saved role that matches the current commit identity. Omitted if no role matches.</td></tr>
    <tr><td><code>overall</code></td><td><code>aligned</code> or <code>warning</code></td></tr>
    <tr><td><code>commitIdentity</code></td><td>Effective name and email, plus where each comes from: <code>local</code>, <code>global</code>, <code>system</code>, <code>worktree</code>, <code>command</code>, <code>git</code>, <code>env</code>, or <code>unset</code></td></tr>
    <tr><td><code>configuredIdentity</code></td><td>Raw local and global Git config values. This is not the commit identity when an env var overrides it.</td></tr>
    <tr><td><code>scope</code></td><td>Aggregate view of underlying configured author scope</td></tr>
    <tr><td><code>repository</code></td><td>Repo context, branch, and parsed remote info</td></tr>
    <tr><td><code>sshAuth</code></td><td>SSH probe result. Omitted if no SSH probe was run, including HTTPS-only push destinations.</td></tr>
    <tr><td><code>repoPolicy</code></td><td><code>.gitrole</code> policy evaluation. Omitted if no policy file exists.</td></tr>
    <tr><td><code>checks</code></td><td>Ordered list of individual check results</td></tr>
  </tbody>
</table>

<h4 id="doctor-json-commit-identity"><code>commitIdentity</code></h4>

<table>
  <thead>
    <tr><th>Field</th><th>Meaning</th><th>Values</th></tr>
  </thead>
  <tbody>
    <tr><td><code>fullName.value</code></td><td>Effective commit author name</td><td>string, or omitted when unset</td></tr>
    <tr><td><code>fullName.source</code></td><td>Where the effective name came from</td><td><code>local</code>, <code>global</code>, <code>system</code>, <code>worktree</code>, <code>command</code>, <code>git</code>, <code>env</code>, <code>unset</code></td></tr>
    <tr><td><code>email.value</code></td><td>Effective commit author email</td><td>string, or omitted when unset</td></tr>
    <tr><td><code>email.source</code></td><td>Where the effective email came from</td><td><code>local</code>, <code>global</code>, <code>system</code>, <code>worktree</code>, <code>command</code>, <code>git</code>, <code>env</code>, <code>unset</code></td></tr>
  </tbody>
</table>

<h4 id="doctor-json-configured-identity"><code>configuredIdentity</code></h4>

<table>
  <thead>
    <tr><th>Field</th><th>Meaning</th></tr>
  </thead>
  <tbody>
    <tr><td><code>configuredIdentity.local.fullName</code></td><td>Raw repo-local <code>user.name</code>, if present</td></tr>
    <tr><td><code>configuredIdentity.local.email</code></td><td>Raw repo-local <code>user.email</code>, if present</td></tr>
    <tr><td><code>configuredIdentity.global.fullName</code></td><td>Raw global <code>user.name</code>, if present</td></tr>
    <tr><td><code>configuredIdentity.global.email</code></td><td>Raw global <code>user.email</code>, if present</td></tr>
  </tbody>
</table>

<h4 id="doctor-json-scope"><code>scope</code></h4>

<table>
  <thead>
    <tr><th>Field</th><th>Meaning</th><th>Values</th></tr>
  </thead>
  <tbody>
    <tr><td><code>effective</code></td><td>Underlying configured author scope, including when effective values come from the environment</td><td><code>local</code>, <code>global</code>, <code>system</code>, <code>worktree</code>, <code>command</code>, <code>git</code>, <code>mixed</code>, <code>unset</code></td></tr>
    <tr><td><code>hasLocalOverride</code></td><td>Whether underlying author configuration includes a local or worktree field</td><td><code>true</code>, <code>false</code></td></tr>
  </tbody>
</table>

<h4 id="doctor-json-repository"><code>repository</code></h4>

<table>
  <thead>
    <tr><th>Field</th><th>Meaning</th></tr>
  </thead>
  <tbody>
    <tr><td><code>isInsideWorkTree</code></td><td>Whether the current working directory is inside a Git work tree</td></tr>
    <tr><td><code>hasCommits</code></td><td>Whether <code>HEAD</code> exists. Omitted outside a Git repo.</td></tr>
    <tr><td><code>topLevelPath</code></td><td>Absolute path to the repo root. Omitted outside a Git repo.</td></tr>
    <tr><td><code>currentBranch</code></td><td>Current branch name, when available</td></tr>
    <tr><td><code>upstreamBranch</code></td><td>Configured upstream branch, when available</td></tr>
    <tr><td><code>fetchRemote</code></td><td>Parsed fetch origin, independent of push qualification.</td></tr>
    <tr><td><code>push</code></td><td>Selected <code>remoteName</code>, optional resolution <code>message</code> and all <code>targets</code>. Each target contains parsed <code>remote</code>, optional <code>sshAuth</code> and unverified <code>message</code>. Singular top-level <code>sshAuth</code> is populated only for one endpoint.</td></tr>
    <tr><td><code>remote</code></td><td>First effective default push endpoint. Omitted when no destination can be resolved.</td></tr>
  </tbody>
</table>

<h4 id="doctor-json-remote"><code>repository.remote</code></h4>

<table>
  <thead>
    <tr><th>Field</th><th>Meaning</th><th>Values</th></tr>
  </thead>
  <tbody>
    <tr><td><code>name</code></td><td>Remote name</td><td>selected default push remote</td></tr>
    <tr><td><code>url</code></td><td>Raw remote URL</td><td>string</td></tr>
    <tr><td><code>protocol</code></td><td>Parsed remote protocol</td><td><code>ssh</code>, <code>https</code>, <code>unknown</code></td></tr>
    <tr><td><code>host</code></td><td>Parsed remote host</td><td>string when parseable</td></tr>
    <tr><td><code>user</code></td><td>Explicit SSH URL user, when present</td><td>string</td></tr>
    <tr><td><code>port</code></td><td>Explicit supported SSH URL port, when present</td><td>integer 1–65535</td></tr>
    <tr><td><code>path</code></td><td>SSH repository path as interpreted by Git</td><td>string</td></tr>
    <tr><td><code>owner</code></td><td>Parsed repository owner or org</td><td>string when parseable</td></tr>
    <tr><td><code>repository</code></td><td>Parsed repository name</td><td>string when parseable</td></tr>
  </tbody>
</table>

<h4 id="doctor-json-ssh-auth"><code>sshAuth</code></h4>

<table>
  <thead>
    <tr><th>Field</th><th>Meaning</th></tr>
  </thead>
  <tbody>
    <tr><td><code>ok</code></td><td>Whether the SSH probe succeeded</td></tr>
    <tr><td><code>host</code></td><td>SSH host alias or hostname that was probed</td></tr>
    <tr><td><code>githubUser</code></td><td>GitHub user resolved from the SSH probe, when available</td></tr>
    <tr><td><code>message</code></td><td>Probe detail when no GitHub user could be resolved</td></tr>
  </tbody>
</table>

<h4 id="doctor-json-repo-policy"><code>repoPolicy</code></h4>

<table>
  <thead>
    <tr><th>Field</th><th>Meaning</th><th>Values</th></tr>
  </thead>
  <tbody>
    <tr><td><code>version</code></td><td>Policy schema version</td><td>currently <code>1</code></td></tr>
    <tr><td><code>defaultRole</code></td><td>Preferred role for this repo</td><td>role name</td></tr>
    <tr><td><code>allowedRoles</code></td><td>Roles allowed by <code>.gitrole</code></td><td>array of role names</td></tr>
    <tr><td><code>effectiveRole</code></td><td>Active matched role used for evaluation</td><td>role name, or omitted</td></tr>
    <tr><td><code>status</code></td><td>Policy evaluation result</td><td><code>default</code>, <code>allowed</code>, <code>notAllowed</code></td></tr>
  </tbody>
</table>

<p><code>status</code> <code>default</code> and <code>allowed</code> are <code>policy=ok</code> on <a href="#status-short"><code>status --short</code></a>. <code>notAllowed</code> is <code>policy=warn</code>.</p>

<h4 id="doctor-json-checks"><code>checks</code></h4>

<p>Each entry has <code>status</code>, <code>label</code>, and <code>message</code>. <code>info</code> doesn't set <code>overall</code> to <code>warning</code> and doesn't cause exit <code>2</code>. A <code>warn</code> check does.</p>

<table>
  <thead>
    <tr><th>Field</th><th>Meaning</th><th>Values</th></tr>
  </thead>
  <tbody>
    <tr><td><code>status</code></td><td>Per-check result</td><td><code>ok</code>, <code>warn</code>, <code>info</code></td></tr>
    <tr><td><code>label</code></td><td>Diagnostic category string</td><td>short string such as <code>role</code>, <code>remote</code>, or <code>auth</code>. Not a closed vocabulary.</td></tr>
    <tr><td><code>message</code></td><td>Human-readable explanation</td><td>string. Don't parse this.</td></tr>
  </tbody>
</table>

<p>When a pin allows the active role and that role has a <code>githubUser</code>, the HTTPS auth entry is <code>info</code>:</p>

```json
{
  "status": "info",
  "label": "auth",
  "message": "push destination uses HTTPS; SSH auth verification does not apply"
}
```

<p>No pin is <code>warn</code>. With no <code>githubUser</code> on the active role the message is <code>push destination uses HTTPS and no identity pin is configured</code>:</p>

```json
{
  "status": "warn",
  "label": "auth",
  "message": "push destination uses HTTPS and no identity pin is configured"
}
```

<p>With a <code>githubUser</code> but no allowing <code>.gitrole</code>, the message is <code>push destination uses HTTPS and no repo pin is configured</code>.</p>

<p>A pin that doesn't allow the active role is <code>warn</code>. When both GitHub users are known and differ:</p>

```json
{
  "status": "warn",
  "label": "auth",
  "message": "push destination uses HTTPS; github user thisyearearth does not match pin alex-dev"
}
```

<p>Otherwise the message is <code>push destination uses HTTPS; active identity does not match pinned role &lt;defaultRole&gt;</code>.</p>

<p>Exit <code>0</code> with <code>overall</code> <code>aligned</code> on HTTPS requires the pin to allow the active role, that role to have a <code>githubUser</code>, and no other <code>warn</code> check.</p>

<h3 id="doctor-json-exit-codes">Exit codes</h3>

<table>
  <thead>
    <tr><th>Code</th><th>Meaning</th></tr>
  </thead>
  <tbody>
    <tr><td><code>0</code></td><td>Diagnosis complete, no <code>warn</code> check. JSON on stdout.</td></tr>
    <tr><td><code>2</code></td><td>Diagnosis complete, at least one <code>warn</code> check. JSON on stdout.</td></tr>
    <tr><td><code>1</code></td><td>Failure. Error on stderr. No JSON.</td></tr>
  </tbody>
</table>

<p>An HTTPS auth check selects exit <code>2</code> when it is <code>warn</code> (no pin, or a pin that doesn't allow the active role). It stays <code>info</code>, and doesn't by itself select exit <code>2</code>, only when the pin allows the active role and that role has a <code>githubUser</code>.</p>

<h3 id="doctor-json-failures">When it fails</h3>

<p>Exit <code>1</code> writes the error to stderr and doesn't print JSON. A missing <code>.gitrole</code> file still returns JSON. <code>repoPolicy</code> is omitted.</p>

<table>
  <thead>
    <tr><th>Condition</th><th>Result</th></tr>
  </thead>
  <tbody>
    <tr><td>Saved role data contains a name outside the <a href="#role-name-format">role name format</a></td><td>exit <code>1</code>, stderr, no JSON</td></tr>
    <tr><td>Saved role is already named <code>no-role</code></td><td>not this failure. JSON is printed, <code>overall</code> is <code>warning</code>, and a <code>warn</code> check suggests a rename</td></tr>
    <tr><td><code>.gitrole</code> is invalid JSON or fails schema validation</td><td>exit <code>1</code>, stderr, no JSON</td></tr>
    <tr><td>Invalid <code>.gitrole</code> <code>defaultRole</code> or <code>allowedRoles</code> name</td><td>exit <code>1</code>, stderr, no JSON. See <a href="#role-name-format">Role name format</a>.</td></tr>
    <tr><td>Another operational failure before JSON is written</td><td>exit <code>1</code>, stderr, no JSON</td></tr>
  </tbody>
</table>

<h3 id="doctor-json-stable">What's stable</h3>

<p>The top-level field names are the contract. The meaning of <code>overall</code>, <code>scope</code>, the presence of <code>checks</code>, and the <code>checks[].status</code> vocabulary (<code>ok</code>, <code>warn</code>, <code>info</code>) are stable. Key order is not. <code>checks[].message</code> is descriptive text, not an automation surface. Adding new fields is not a breaking change. Removing or renaming documented top-level fields is.</p>

<table>
  <thead>
    <tr><th>Surface</th><th>Safe to automate against</th></tr>
  </thead>
  <tbody>
    <tr><td><code>overall</code></td><td>yes</td></tr>
    <tr><td><code>commitIdentity</code></td><td>yes</td></tr>
    <tr><td><code>configuredIdentity</code></td><td>yes</td></tr>
    <tr><td><code>scope</code></td><td>yes</td></tr>
    <tr><td><code>repository</code></td><td>yes, but prefer presence and absence and documented fields over incidental details</td></tr>
    <tr><td><code>sshAuth</code></td><td>yes</td></tr>
    <tr><td><code>repoPolicy</code></td><td>yes</td></tr>
    <tr><td><code>checks</code></td><td>yes, as an ordered list of results</td></tr>
  </tbody>
</table>

<table>
  <thead>
    <tr><th>Surface</th><th>Guidance</th></tr>
  </thead>
  <tbody>
    <tr><td><code>checks[].message</code></td><td>human-readable text. Don't parse this.</td></tr>
    <tr><td><code>checks[].label</code></td><td>diagnostic category string. Useful for display, not a closed vocabulary.</td></tr>
    <tr><td><code>repository.currentBranch</code></td><td>useful context, not the primary contract surface</td></tr>
    <tr><td><code>repository.topLevelPath</code></td><td>useful context, not the primary contract surface</td></tr>
  </tbody>
</table>

<p>Nested fields above are documented for meaning and current shape. Additive changes may happen over time.</p>

<h2 id="resolve-json"><code>gitrole resolve --json</code></h2>

<p>Use this when you need the <code>.gitrole</code> policy and you don't need a diagnosis. <code>status</code> and <code>doctor</code> still run when the file is absent. This command doesn't.</p>

<h3 id="resolve-json-signature">Signature</h3>

```bash
gitrole resolve --json
```

<h3 id="resolve-json-example">Example</h3>

<p><code>gitrole resolve --json</code> with <code>defaultRole</code> <code>work</code> and <code>allowedRoles</code> <code>work</code> and <code>maintainer-personal</code>. Exit <code>0</code>:</p>

```json
{
  "version": 1,
  "defaultRole": "work",
  "allowedRoles": [
    "work",
    "maintainer-personal"
  ]
}
```

<h3 id="resolve-json-fields">Fields</h3>

<table>
  <thead>
    <tr><th>Field</th><th>What it tells you</th></tr>
  </thead>
  <tbody>
    <tr><td><code>version</code></td><td>Policy schema version. Currently always <code>1</code>.</td></tr>
    <tr><td><code>defaultRole</code></td><td>The preferred role for this repo</td></tr>
    <tr><td><code>allowedRoles</code></td><td>Roles that are valid here. <code>defaultRole</code> is always included.</td></tr>
  </tbody>
</table>

<h3 id="resolve-json-exit-codes">Exit codes</h3>

<table>
  <thead>
    <tr><th>Code</th><th>Meaning</th></tr>
  </thead>
  <tbody>
    <tr><td><code>0</code></td><td>Policy resolved. JSON on stdout.</td></tr>
    <tr><td><code>1</code></td><td>Failure. Error on stderr. No JSON.</td></tr>
  </tbody>
</table>

<h3 id="resolve-json-failures">When it fails</h3>

<p><code>resolve --json</code> doesn't emit empty success output when <code>.gitrole</code> is missing. It exits <code>1</code>, writes the error to stderr, and prints no JSON. That is different from <code>status</code> and <code>doctor</code>, which still run without a policy file.</p>

<table>
  <thead>
    <tr><th>Condition</th><th>Result</th></tr>
  </thead>
  <tbody>
    <tr><td>Not inside a Git repo</td><td>exit <code>1</code>, stderr message, no JSON</td></tr>
    <tr><td>No <code>.gitrole</code> file exists</td><td>exit <code>1</code>, stderr message, no JSON</td></tr>
    <tr><td><code>.gitrole</code> is invalid JSON or fails schema validation</td><td>exit <code>1</code>, stderr message, no JSON</td></tr>
    <tr><td>invalid <code>defaultRole</code> or <code>allowedRoles</code> name</td><td>exit <code>1</code>, stderr message, no JSON</td></tr>
  </tbody>
</table>

<h3 id="resolve-json-stable">What's stable</h3>

<p>The field names <code>version</code>, <code>defaultRole</code>, and <code>allowedRoles</code> are the contract. <code>version</code> is <code>1</code>. Key order is not.</p>

<h2 id="role-name-format">Role name format</h2>

<p>Saved role names use this format so machine-readable values such as <code>role=</code> stay unambiguous. The same rules apply to <code>.gitrole</code> <code>defaultRole</code> and every <code>allowedRoles</code> entry.</p>

<table>
  <thead>
    <tr><th>Rule</th><th>Allowed</th></tr>
  </thead>
  <tbody>
    <tr><td>letters</td><td>lowercase <code>a-z</code> only</td></tr>
    <tr><td>digits</td><td><code>0-9</code></td></tr>
    <tr><td>separators</td><td><code>-</code>, <code>_</code></td></tr>
    <tr><td>disallowed</td><td>spaces, slashes, uppercase, and other punctuation</td></tr>
  </tbody>
</table>

<table>
  <thead>
    <tr><th>Example</th><th>Valid</th></tr>
  </thead>
  <tbody>
    <tr><td><code>work</code></td><td>yes</td></tr>
    <tr><td><code>personal</code></td><td>yes</td></tr>
    <tr><td><code>client-acme</code></td><td>yes</td></tr>
    <tr><td><code>agent_bot</code></td><td>yes</td></tr>
    <tr><td><code>client acme</code></td><td>no</td></tr>
    <tr><td><code>Work</code></td><td>no</td></tr>
    <tr><td><code>my@role</code></td><td>no</td></tr>
    <tr><td><code>no-role</code></td><td>no. Reserved sentinel.</td></tr>
  </tbody>
</table>

<p>Creating a role with an invalid name prints:</p>

```text
error: invalid role name "client acme"; use lowercase letters, numbers, "-" or "_"
```

<p><code>no-role</code> matches the shape above, and it is still reserved. <code>status --short</code> writes <code>role=no-role</code> when no saved role matches. <code>gitrole add no-role</code> and <code>gitrole import current --name no-role</code> exit <code>1</code>, write this to stderr, and print nothing on stdout:</p>

```text
error: role name "no-role" is reserved for the status and prompt sentinel when no saved role matches; choose a different name
```

<p>A saved role that already uses that name isn't deleted or renamed. <code>gitrole doctor</code> warns and suggests adding the identity under a new name, then <code>gitrole remove no-role</code>. <code>gitrole status</code> still prints its line. The prompt segment still chooses <code>✓</code> or <code>⚠</code> from the status fields only, so a hand-built aligned line with <code>role=no-role</code> stays <code>gitrole:no-role ✓</code>.</p>

<p>If saved role data already contains a name outside this format, commands that load saved roles fail closed: exit <code>1</code>, error on stderr, nothing on stdout. That includes <a href="#status-short-failures"><code>gitrole status --short</code></a> and <a href="#doctor-json-failures"><code>gitrole doctor --json</code></a>. The reserved name <code>no-role</code> is not that failure.</p>

<p>An invalid policy name is fail-closed for the same reason: a bad name would otherwise show up as a <code>role=</code> value scripts can't trust. These commands exit <code>1</code>, write the error to stderr, and write nothing to stdout:</p>

<ul>
  <li><code>gitrole resolve</code></li>
  <li><code>gitrole resolve --json</code></li>
  <li><code>gitrole status</code></li>
  <li><code>gitrole status --short</code></li>
  <li><code>gitrole doctor</code></li>
  <li><code>gitrole doctor --json</code></li>
</ul>

<p><code>gitrole status --short</code> loads the policy before the one-line contract is written. The field names and order for a valid policy are unchanged.</p>

<p>A <code>defaultRole</code> of <code>client acme</code> produces this stderr line and no stdout:</p>

```text
error: repo policy file .gitrole is invalid: defaultRole invalid role name "client acme"; use lowercase letters, numbers, "-" or "_"
```

<p>An invalid allowed role is reported on that field. With <code>defaultRole</code> set to <code>work</code> and <code>Client</code> in <code>allowedRoles</code>:</p>

```text
error: repo policy file .gitrole is invalid: allowedRoles invalid role name "Client"; use lowercase letters, numbers, "-" or "_"
```

<p>A missing <code>.gitrole</code> file is not this failure for <code>status</code> or <code>doctor</code>. Those commands still run without repo policy when the file is absent. <code>resolve</code> and <code>resolve --json</code> still exit <code>1</code> when the file is missing. Valid names such as <code>client-acme</code> and <code>agent_bot</code> still succeed.</p>

<h2 id="what-it-does-not-do">What this page doesn't cover</h2>

<p>These commands check. They don't switch roles, rewrite remotes, or install hooks. Human-readable <code>gitrole status</code> and <code>gitrole doctor</code> text isn't a parse contract. The prompt segment glyphs are in <a href="{{ '/guides/show-gitrole-in-your-shell-prompt/' | url }}">Show gitrole in your shell prompt</a>.</p>

<h2 id="effective-identity">Effective ordinary-commit identity</h2>

<p>Gitrole asks Git for <code>GIT_AUTHOR_IDENT</code> and <code>GIT_COMMITTER_IDENT</code>. Included configuration, author/committer-specific settings, worktree/system/command configuration and environment overrides participate in Git’s precedence. Role matching, <code>current</code> and <code>import current</code> use the effective author. A differing or unavailable committer warns rather than proving alignment. <code>doctor --json</code> additionally reports <code>committerIdentity</code> with the same name/email value/source shape as <code>commitIdentity</code>.</p>

<p>Config includes retain their reported Git scope. <code>git</code> identifies Git-generated fallback values; <code>env</code> identifies environment input. Aggregate scope reports the underlying author configuration; environment overrides retain that convention. <code>hasLocalOverride</code> includes local and worktree configuration. The source and scope vocabularies are expanded: strict consumers accepting only the older values must update. The eight short fields, their order and exits remain unchanged.</p>

<p>This is a snapshot for an ordinary commit in the checked context. A later <code>git commit --author</code> argument or changed config/environment can change identity after the check; Gitrole cannot predict it.</p>
