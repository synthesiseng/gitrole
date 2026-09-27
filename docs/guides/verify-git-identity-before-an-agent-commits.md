---
layout: layouts/base.njk
title: Verify Git identity before an agent commits
eyebrow: Guide
summary: Point Claude Code, Codex, or Cursor at the gitrole skill shipped in the npm package so the agent runs status --short before it commits and stops on a warning.
order: 4
---

<h2 id="what-this-guide-does">What this guide does</h2>

Use this when a coding agent commits or pushes in a repository that already has a gitrole role.

The npm package ships one skill directory:

```text
skills/gitrole/SKILL.md
```

The skill tells the agent to run <code>gitrole status --short</code> before a commit, or <code>gitrole doctor --json</code> when it needs the full diagnosis, and to stop when the result is a warning. It does not install a git hook, switch roles, or block git itself.

The field names, <code>overall</code> values, and exit codes are the same contract as <a href="{{ '/machine-readable-contracts/' | url }}">Machine Readable Contracts</a>. Scripted preflight without a skill is covered in <a href="{{ '/use-cases/use-gitrole-as-an-identity-preflight-for-agents-and-automation/' | url }}">Use gitrole as an identity preflight for agents and automation</a>.

<h2 id="where-the-skill-lives">Where the skill lives</h2>

| Install | Skill directory |
| --- | --- |
| Global npm install | <code>$(npm root -g)/gitrole/skills/gitrole</code> |
| Project dependency | <code>node_modules/gitrole/skills/gitrole</code> |
| Checkout of this repository | <code>skills/gitrole</code> |

Each tool loads a skill from its own directory. The published layout is the same <code>gitrole/SKILL.md</code> folder. Symlink that folder into the tool path below. A symlink keeps the skill on the installed package.

<h2 id="install-for-your-agent">Install for your agent</h2>

Set <code>GITROLE_SKILL</code> to the skill directory from the table above. This example uses a global install:

```bash
GITROLE_SKILL="$(npm root -g)/gitrole/skills/gitrole"
```

Claude Code reads <code>.claude/skills/</code> in the project and <code>~/.claude/skills/</code> for every project. Codex reads <code>.agents/skills/</code> from the working directory up to the repository root, and <code>~/.agents/skills/</code> for every project. Cursor reads both of those layouts, plus <code>.cursor/skills/</code> and <code>~/.cursor/skills/</code>.

Personal install, available in every repository:

```bash
mkdir -p ~/.claude/skills ~/.agents/skills
ln -sfn "$GITROLE_SKILL" ~/.claude/skills/gitrole
ln -sfn "$GITROLE_SKILL" ~/.agents/skills/gitrole
```

Those two links cover Claude Code, Codex, and Cursor. Claude Code loads <code>~/.claude/skills/gitrole</code>. Codex and Cursor load <code>~/.agents/skills/gitrole</code>. Cursor also reads the Claude Code directory.

Project install, for one repository:

```bash
mkdir -p .claude/skills .agents/skills
ln -sfn "$GITROLE_SKILL" .claude/skills/gitrole
ln -sfn "$GITROLE_SKILL" .agents/skills/gitrole
```

Invoke it as <code>/gitrole</code> where the tool exposes skill commands. A commit or push also matches the skill description, so the agent can load it before it writes.

<h2 id="what-the-agent-runs">What the agent runs</h2>

Preferred preflight:

```bash
gitrole status --short
```

The line is <code>role scope override commit remote auth policy overall</code>. Read <code>overall</code> by name. It is the eighth field.

| Result | Action |
| --- | --- |
| Exit <code>0</code> and <code>overall=aligned</code> | The repo is aligned. |
| Exit <code>2</code> or <code>overall=warning</code> | Stop. Do not commit. |
| <code>commit</code>, <code>remote</code>, <code>auth</code>, or <code>policy</code> is <code>warn</code> | Stop. Do not commit. |
| Exit <code>1</code> | Stop. The error is on stderr and stdout is empty. |

<code>na</code> means that check does not apply. It does not by itself mean stop.

Full diagnosis:

```bash
gitrole doctor --json
```

Stop on exit <code>2</code>, on <code>overall</code> <code>warning</code>, or when any <code>checks[].status</code> is <code>warn</code>. <code>info</code> is not a warning. Exit <code>1</code> prints no JSON.

<h2 id="what-it-does-not-do">What it does not do</h2>

The skill does not copy <code>hooks/pre-commit</code> into <code>.git/hooks</code>. That hook is optional, check-only, and runs <code>gitrole status --short</code>. Install it yourself when you want git to run the same check:

```bash
cp "$(npm root -g)/gitrole/hooks/pre-commit" .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```
