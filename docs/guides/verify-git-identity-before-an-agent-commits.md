---
layout: layouts/base.njk
title: Verify Git identity before an agent commits
eyebrow: Guide
summary: Point Claude Code, Codex, or Cursor at the gitrole skill shipped in the npm package so ordinary commits use the local identity gate and pushes receive separate diagnosis.
order: 4
---

<p>The packaged gitrole skill instructs an agent to check local identity and policy before ordinary commits, and diagnose push destinations separately. It supplies instructions, not an enforced Git permission boundary.</p>

<h2 id="quick-start">Quick start</h2>

<p>You need <code>gitrole</code> 0.12.0 or newer with <code>check commit</code> support on the agent’s <code>PATH</code> (<code>brew install synthesiseng/tap/gitrole</code>, or <code>npm install -g gitrole</code>). The skill file ships in the npm package. This quick start uses a global npm install and symlinks that folder into the two example personal skill directories. A symlink keeps the skill on the package when you upgrade, instead of copying a stale file.</p>

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

<h2 id="what-the-agent-runs">Check ordinary commits locally</h2>

Confirm `gitrole --version` and `gitrole check commit --help` in the agent's actual environment. Help must describe the local check. If the CLI is missing, unsupported, or fails, stop and report it. Do not install or upgrade it automatically, change PATH, or fall back to online status gating. Copied skills and CLI installations can have different versions.

Use `gitrole check commit` as the commit gate, including before the first commit:

```bash
gitrole check commit
```

| Result | Action |
| --- | --- |
| Exit `0`, no output | Local identity and policy pass; proceed only within existing user authorization and the checked context. |
| Exit `2` | Stop the commit and report the mismatch on stderr. |
| Exit `1` or unexpected result | Stop the commit and report the failure; stdout is empty on exit `1`. |

The full effective author must match a saved usable role, the committer must match the author, and any `.gitrole` policy must allow the role. Missing usable identity, mixed configured sources and identity/policy mismatch block; malformed required data fails. The first commit requires a local or worktree identity override, even when a global identity matches. Missing policy is allowed. No remote, GitHub username, SSH key or authentication is required. The command performs no SSH, network or Keychain access and takes no `--offline` or `--json` flag.

<h2 id="trust-the-effective-identity">Trust the effective identity</h2>

`GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, and `GIT_COMMITTER_EMAIL` can override Git configuration. Raw `user.name` and `user.email` are not sufficient evidence. Diagnose locally:

```bash
gitrole doctor --offline --json
```

Read `commitIdentity`, `committerIdentity`, `overall`, and `checks[].status`/`checks[].label`; `configuredIdentity` is only raw configuration. Identity sources can be `local`, `global`, `system`, `worktree`, `command`, `git`, `env`, or `unset`. Do not parse `checks[].message` as a stable contract.

<h2 id="full-diagnosis">Keep diagnosis separate from the decision</h2>

Doctor is broader diagnosis, not a substitute for `check commit`. A fresh repository's `history` warning, missing push destination or unverified authentication can coexist with a passing local commit check. Report those warnings separately without changing doctor's verdict or filtering checks into a fabricated pass. `info` is not a warning. Exit `1` is a diagnostic failure with no JSON. Investigate identity/policy warnings and errors, then rerun `check commit` for the commit decision. Do not create a commit merely to silence doctor.

<h2 id="amend">Review retained or explicit authors separately</h2>

`git commit --amend` normally retains the existing author. The standalone local check observes ordinary-commit identity, so it does not validate amend's retained author. Inspect the existing author and intended committer against the approved role and policy; clarify intent with the user if needed. Do not silently add `--reset-author` or rewrite authorship.

A passing check also cannot cover a later explicit `--author`, reused author, or later configuration/environment changes, including `git -c`. Re-evaluate the actual context and rerun the check; stop if that identity cannot be established. An installed local hook can inspect Git's prepared environment for that attempt, but never assume it exists.

<h2 id="warnings-that-still-stop">Push warnings still stop pushes</h2>

For an authorized push, first identify the intended command and destination. The local commit check does not verify pushes. In the default push context:

```bash
gitrole status --short
```

The eight fields remain `role scope override commit remote auth policy overall`; `overall` is the eighth field. Exit `0` with `overall=aligned` reports alignment. Exit `2`, `overall=warning`, or a `warn` in `commit`, `remote`, `auth`, or `policy` stops the push. Exit `1` or malformed/unexpected output also stops it. Do not bypass a status warning for a push or relabel it as success.

Status observes every resolved default push URL, not merely fetch origin. It accepts no destination override: default alignment does not verify a future explicit remote, URL, refspec or other push arguments. Inspect actual push URLs, URL rewrites and refspec intent separately; stop and explain when that context cannot be verified. Even aligned status does not prove refspec readiness, authorization or push success.

HTTPS without an allowing pin and the role's saved `githubUser` still warns. HTTPS `auth=na` in the pinned case expresses a local expectation, not verified or selected credentials. Mixed online transports and unverified SSH still warn. Use `gitrole doctor --json` for structured push diagnosis when online inspection is appropriate; it can execute SSH, configured `Match exec`, proxies or DNS and have effects permitted by SSH settings. Offline diagnosis remains available but does not verify live authentication.

If an interactive check is needed, ask the user to run `gitrole auth test` in their terminal. Never invoke it automatically. Its result does not override a status warning or guarantee a future push.

<h2 id="what-it-does-not-do">Keep corrections under user control</h2>

The user must choose the role and approve identity switching, pinning, remote rewrites and hook changes. A diagnostic suggestion is not approval. Never silently switch globally. Recheck after an approved correction. The skill checks; it neither installs hooks nor blocks Git itself.

The optional `hooks/pre-commit` uses the same local `check commit` command. Existing copied hooks and skills retain their old behavior until deliberately reviewed and migrated; updating these instructions does not bypass a failing hook. See <a href="{{ '/guides/check-identity-before-a-local-commit/' | url }}">local hook compatibility and migration</a>. Scripted preflight is covered in <a href="{{ '/use-cases/use-gitrole-as-an-identity-preflight-for-agents-and-automation/' | url }}">the automation guide</a>.

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
