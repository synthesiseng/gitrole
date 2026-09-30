---
layout: layouts/base.njk
title: Verify Git identity before an agent commits
eyebrow: Guide
summary: Point Claude Code, Codex, or Cursor at the gitrole skill shipped in the npm package so the agent runs status --short before it commits and stops on a warning.
order: 4
---

<p>Coding agents commit fast, and they often commit as the wrong person. The gitrole skill makes Claude Code, Codex, or Cursor check the repository's identity before every commit and stop if anything is off.</p>

<h2 id="quick-start">Quick start</h2>

<p>You need <code>gitrole</code> on <code>PATH</code> (<code>brew install synthesiseng/tap/gitrole</code>, or <code>npm install -g gitrole</code>). The skill file ships in the npm package. This quick start uses a global npm install and symlinks that folder into the two personal directories that cover Claude Code, Codex, and Cursor. A symlink keeps the skill on the package when you upgrade, instead of copying a stale file.</p>

```bash
GITROLE_SKILL="$(npm root -g)/gitrole/skills/gitrole"
mkdir -p ~/.claude/skills ~/.agents/skills
ln -sfn "$GITROLE_SKILL" ~/.claude/skills/gitrole
ln -sfn "$GITROLE_SKILL" ~/.agents/skills/gitrole
```

<p>Claude Code loads <code>~/.claude/skills/gitrole</code> and you invoke it with <code>/gitrole</code>. Codex loads <code>~/.agents/skills/gitrole</code> and you mention it with <code>$gitrole</code>. Cursor loads both of those directories, so the same two links are enough, and you invoke it with <code>/gitrole</code>. A commit or a push also matches the skill description, so the agent can load it without a slash command. You can stop here if the skill shows up in the tool.</p>

<p>The Homebrew formula installs the <code>gitrole</code> and <code>gitrole-prompt</code> binaries. It doesn't document a skill path under the Homebrew prefix, so this page doesn't invent one. Use the npm path above, a project <code>node_modules/gitrole/skills/gitrole</code>, or <code>skills/gitrole</code> in a checkout.</p>

<h2 id="what-the-agent-runs">How the agent reads the check</h2>

<p>The skill's preferred command is:</p>

```bash
gitrole status --short
```

<p>The line is <code>role scope override commit remote auth policy overall</code>. The agent reads the fields by name. <code>overall</code> is the eighth field, after <code>policy</code>, because a parser that still treats field seven as the summary is reading <code>policy</code>.</p>

<table>
  <thead>
    <tr><th>Result</th><th>Action</th></tr>
  </thead>
  <tbody>
    <tr><td>Exit <code>0</code> and <code>overall=aligned</code></td><td>The repo is aligned. The agent may commit or push.</td></tr>
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

<p><strong>HTTPS origin with no <code>.gitrole</code> pin.</strong> <code>auth=warn</code> because gitrole can't tell which GitHub user an HTTPS push will use unless a pin allows the active role and that role has a <code>githubUser</code>. <code>auth=na</code> on HTTPS is only that pinned case. Anything else warns, including a clean commit identity:</p>

```text
role=work scope=local override=true commit=ok remote=ok auth=warn policy=na overall=warning
```

<p><strong>A repository with no commits yet.</strong> <code>remote=warn</code> because <code>HEAD</code> doesn't exist yet, and the agent stops even when <code>commit=ok</code>. This catches the first commit in a fresh repository, which is the hardest one to fix later. With no local role, <code>commit=warn</code> as well, because the first commit would use the global identity:</p>

```text
role=work scope=global override=false commit=warn remote=warn auth=ok policy=na overall=warning
```

<p>A local role keeps <code>commit=ok</code>, and <code>remote=warn</code> still stops the commit:</p>

```text
role=work scope=local override=true commit=ok remote=warn auth=ok policy=na overall=warning
```

<h2 id="full-diagnosis">Full diagnosis</h2>

<p>When the agent needs the reason, not only the line:</p>

```bash
gitrole doctor --json
```

<p>Stop on exit <code>2</code>, on <code>overall</code> <code>warning</code>, or when any <code>checks[].status</code> is <code>warn</code>. <code>info</code> is not a warning. Exit <code>1</code> prints no JSON. Don't parse <code>checks[].message</code>. Field names are in <a href="{{ '/machine-readable-contracts/' | url }}">Machine Readable Contracts</a>.</p>

<h2 id="what-it-does-not-do">What it doesn't do</h2>

<p>The skill doesn't install a git hook, switch roles, or block git. It checks, and the agent decides to stop. Scripted preflight without a skill is in <a href="{{ '/use-cases/use-gitrole-as-an-identity-preflight-for-agents-and-automation/' | url }}">Use gitrole as an identity preflight for agents and automation</a>.</p>

<p>The package also ships <code>hooks/pre-commit</code>, which only runs <code>gitrole status --short</code>. Copy it yourself when you want git to run the same check:</p>

```bash
cp "$(npm root -g)/gitrole/hooks/pre-commit" .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

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

<p>Project install, for one repository, uses the same two directories the tools read from the working tree:</p>

```bash
GITROLE_SKILL="$(npm root -g)/gitrole/skills/gitrole"
mkdir -p .claude/skills .agents/skills
ln -sfn "$GITROLE_SKILL" .claude/skills/gitrole
ln -sfn "$GITROLE_SKILL" .agents/skills/gitrole
```

<p>Claude Code reads <code>.claude/skills/</code> in the project and parent directories up to the repository root, and <code>~/.claude/skills/</code> for every project. Codex reads <code>.agents/skills/</code> from the working directory up to the repository root, and <code>~/.agents/skills/</code> for every project. Cursor reads <code>.agents/skills/</code>, <code>.cursor/skills/</code>, <code>~/.agents/skills/</code>, and <code>~/.cursor/skills/</code>, and for compatibility it also reads <code>.claude/skills/</code>, <code>.codex/skills/</code>, <code>~/.claude/skills/</code>, and <code>~/.codex/skills/</code>. The two links in the quick start are enough for all three tools because of that overlap.</p>
