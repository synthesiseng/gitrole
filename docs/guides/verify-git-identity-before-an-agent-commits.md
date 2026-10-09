---
layout: layouts/base.njk
title: Verify Git identity before an agent commits
eyebrow: Guide
summary: Point Claude Code, Codex, or Cursor at the gitrole skill shipped in the npm package so the agent runs status --short before it commits and stops on a warning.
order: 4
---

<p>The packaged gitrole skill instructs an agent to check the repository's effective identity and stop on warnings. It supplies instructions, not an enforced Git permission boundary.</p>

<h2 id="quick-start">Quick start</h2>

<p>You need <code>gitrole</code> on <code>PATH</code> (<code>brew install synthesiseng/tap/gitrole</code>, or <code>npm install -g gitrole</code>). The skill file ships in the npm package. This quick start uses a global npm install and symlinks that folder into the two example personal skill directories. A symlink keeps the skill on the package when you upgrade, instead of copying a stale file.</p>

```bash
GITROLE_SKILL="$(npm root -g)/gitrole/skills/gitrole"
if [ -f "$GITROLE_SKILL/SKILL.md" ]; then
  mkdir -p ~/.claude/skills ~/.agents/skills
  for GITROLE_SKILL_LINK in ~/.claude/skills/gitrole ~/.agents/skills/gitrole; do
    if [ -e "$GITROLE_SKILL_LINK" ] || [ -L "$GITROLE_SKILL_LINK" ]; then
      printf 'Review existing skill path: %s\n' "$GITROLE_SKILL_LINK"
    else
      ln -s "$GITROLE_SKILL" "$GITROLE_SKILL_LINK"
    fi
  done
else
  printf '%s\n' 'Skill file not found; check the package or checkout path.'
fi
```

<p>Confirm that your agent has loaded the skill using that tool's current skill setup instructions. These paths are examples of common skill locations; loading and automatic invocation depend on your agent and version.</p>

<p>Homebrew users can set <code>GITROLE_SKILL</code> to <code>/absolute/path/to/gitrole/skills/gitrole</code> in a source checkout instead. The npm example requires the npm package to be installed. No supported Homebrew asset path is documented here.</p>

<h2 id="what-the-agent-runs">How the agent reads the check</h2>

<p>Use <code>gitrole status --short</code> as the precommit gate, including before the first commit:</p>

```bash
gitrole status --short
```

<p>The line is <code>role scope override commit remote auth policy overall</code>. The agent reads the fields by name. <code>overall</code> is the eighth field, after <code>policy</code>, because a parser that still treats field seven as the summary is reading <code>policy</code>.</p>

<table>
  <thead>
    <tr><th>Result</th><th>Action</th></tr>
  </thead>
  <tbody>
    <tr><td>Exit <code>0</code> and <code>overall=aligned</code></td><td>Identity checks are aligned. Proceed only within existing user authorization; this does not prove push permission or success.</td></tr>
    <tr><td>Exit <code>2</code> or <code>overall=warning</code></td><td>Stop. Do not commit or push.</td></tr>
    <tr><td><code>commit</code>, <code>remote</code>, <code>auth</code>, or <code>policy</code> is <code>warn</code></td><td>Stop. Do not commit or push.</td></tr>
    <tr><td>Exit <code>1</code></td><td>Stop. The error is on stderr and stdout is empty. Do not commit or push.</td></tr>
  </tbody>
</table>

<p><code>na</code> means that check doesn't apply. It doesn't by itself mean stop. <code>policy=na</code> with <code>overall=aligned</code> is aligned, because there is no <code>.gitrole</code> file to violate.</p>

<p>An aligned local role with no <code>.gitrole</code> file looks like this:</p>

```text
role=work scope=local override=true commit=ok remote=ok auth=ok policy=na overall=aligned
```

<h2 id="trust-the-effective-identity">Trust the effective identity</h2>

<p><code>GIT_AUTHOR_NAME</code>, <code>GIT_AUTHOR_EMAIL</code>, <code>GIT_COMMITTER_NAME</code>, and <code>GIT_COMMITTER_EMAIL</code> override Git config. Agents set those variables often. A present <code>user.name</code> or <code>user.email</code> doesn't mean the commit is aligned, so the agent has to read gitrole instead of the config keys.</p>

<p>On <code>gitrole doctor --json</code>, <code>commitIdentity</code> is the effective name and email. Each <code>source</code> is <code>local</code>, <code>global</code>, <code>system</code>, <code>worktree</code>, <code>command</code>, <code>git</code>, <code>env</code>, or <code>unset</code>. <code>configuredIdentity</code> is only the raw config, so an env override can leave <code>configuredIdentity</code> looking fine while <code>commitIdentity</code> is someone else.</p>

<p>An env value that moves the author off the saved role is <code>commit=warn</code> and <code>overall=warning</code>. This line is <code>GIT_AUTHOR_EMAIL</code> set to an address that matches no saved role, on a global identity that otherwise matches <code>work</code>:</p>

```text
role=no-role scope=global override=false commit=warn remote=ok auth=ok policy=na overall=warning
```

<p><code>GIT_COMMITTER_EMAIL</code> or <code>GIT_COMMITTER_NAME</code> that disagrees with the effective author is also <code>commit=warn</code> and exit <code>2</code>. The role can still match, because the author didn't change:</p>

```text
role=work scope=global override=false commit=warn remote=ok auth=ok policy=na overall=warning
```

<p>An env value that matches the saved role can be <code>info</code> with <code>overall=aligned</code>. That <code>info</code> is not a warning. The agent still uses the gitrole result, not the config keys.</p>

<h2 id="warnings-that-still-stop">Warnings that still stop</h2>

<p>These are <code>overall=warning</code> and exit <code>2</code>. The agent stops and doesn't commit.</p>

<p><strong>HTTPS-only push destination with no <code>.gitrole</code> pin.</strong> <code>auth=warn</code> because the local HTTPS check requires an allowing pin and a saved <code>githubUser</code>. Even then the pin does not verify or select HTTPS credentials. <code>auth=na</code> on HTTPS is only that pinned case. Anything else warns, including a clean commit identity:</p>

```text
role=work scope=local override=true commit=ok remote=ok auth=warn policy=na overall=warning
```

<p><strong>A repository with no commits and no local role.</strong> <code>commit=warn</code> protects against taking the global identity for the first commit. The push destination is checked separately; an unborn branch can still resolve a destination:</p>

```text
role=work scope=global override=false commit=warn remote=ok auth=ok policy=na overall=warning
```

<p>An explicit local role can keep <code>commit=ok</code>. If the destination, supported authentication and policy also pass, status can be aligned even before the first commit. That observes identity; it does not prove branch/refspec readiness or that a push succeeds.</p>

<h2 id="full-diagnosis">Full diagnosis</h2>

<p>Use doctor for broader diagnosis when a check needs explanation. Doctor is not a substitute for the precommit gate:</p>

```bash
gitrole doctor --json
```

<p>Doctor also checks history. A fresh repository with an explicit local role and an allowing HTTPS pin can have aligned status while doctor exits <code>2</code> with only a <code>history</code> warning because it has no commits. Run the status gate before the separately authorized first commit; do not create a commit just to silence doctor. If doctor was run first, use status for the precommit decision. Other diagnostic warnings or errors require investigation; a clean status does not dismiss them.</p>

<p>Do not bypass any status warning. Status exit <code>1</code> or <code>2</code> still stops the agent. Doctor warnings remain warnings; do not filter checks to turn the diagnosis into a pass. <code>info</code> is not a warning. Doctor exit <code>1</code> prints no JSON. Don't parse <code>checks[].message</code>. Field names are in <a href="{{ '/machine-readable-contracts/' | url }}">Machine Readable Contracts</a>.</p>

<h2 id="what-it-does-not-do">What it doesn't do</h2>

<p>The skill doesn't install a git hook, switch roles, or block git. It checks, and the agent decides to stop. Scripted preflight without a skill is in <a href="{{ '/use-cases/use-gitrole-as-an-identity-preflight-for-agents-and-automation/' | url }}">Use gitrole as an identity preflight for agents and automation</a>.</p>

<p>The optional <code>hooks/pre-commit</code> asset now runs <code>gitrole check commit</code>, a local identity and policy guard. It requires a full saved-role match even without a pin. It does not change this skill's strict <code>status --short</code> gate. Existing copied hooks that run status keep their earlier behavior until manually migrated. For installation, compatibility, backup and rollback guidance, read <a href="{{ '/guides/check-identity-before-a-local-commit/' | url }}">Check identity before a local commit</a>.</p>

<h2 id="where-the-skill-lives">Where the skill lives</h2>

<table>
  <thead>
    <tr><th>Install</th><th>Skill directory</th></tr>
  </thead>
  <tbody>
    <tr><td>Global npm install</td><td><code>$(npm root -g)/gitrole/skills/gitrole</code></td></tr>
    <tr><td>Project dependency</td><td><code>node_modules/gitrole/skills/gitrole</code></td></tr>
    <tr><td>Checkout of this repository</td><td><code>skills/gitrole</code></td></tr>
  </tbody>
</table>

<p>For a project dependency, run this from the project root. The skill must exist in that project's <code>node_modules</code> before links are created:</p>

```bash
GITROLE_SKILL="$(pwd)/node_modules/gitrole/skills/gitrole"
if [ -f "$GITROLE_SKILL/SKILL.md" ]; then
  mkdir -p .claude/skills .agents/skills
  for GITROLE_SKILL_LINK in .claude/skills/gitrole .agents/skills/gitrole; do
    if [ -e "$GITROLE_SKILL_LINK" ] || [ -L "$GITROLE_SKILL_LINK" ]; then
      printf 'Review existing skill path: %s\n' "$GITROLE_SKILL_LINK"
    else
      ln -s "$GITROLE_SKILL" "$GITROLE_SKILL_LINK"
    fi
  done
else
  printf '%s\n' 'Skill file not found; check the project installation path.'
fi
```

<p>For a global npm package, set <code>GITROLE_SKILL</code> to <code>$(npm root -g)/gitrole/skills/gitrole</code> instead. For checkout assets, use the absolute checkout path. Existing links are left in place; review them before changing their targets.</p>

<p>Configure your agent to load this skill according to its current documentation, then confirm it runs the check. The links above place the skill in common project directories; they do not prove that every agent or version has loaded it. Review any existing links before replacing them.</p>
