---
layout: layouts/base.njk
title: Verify Git identity before an agent commits
eyebrow: Guide
summary: Install and discover the Gitrole agent skill, keep it updated separately from the CLI, and review older skill or hook installations before migration.
order: 4
---

The Gitrole skill helps an agent save or select identities, inspect repository policy, check commit authorship locally, and diagnose push accounts separately. It supplies instructions, not an enforced Git permission boundary or permission to commit, push, or change settings.

<h2 id="quick-start">Install the skill</h2>

From the project where you want the skill available:

```bash
npx skills add synthesiseng/gitrole
```

The Skills installer installs project-scoped skills by default. Review its agent selection and destination before accepting. To select Codex explicitly:

```bash
npx skills add synthesiseng/gitrole --agent codex
```

For user-wide availability instead of the current project, add `--global`:

```bash
npx skills add synthesiseng/gitrole --agent codex --global
```

These are commands for the separate [Skills installer](https://github.com/vercel-labs/skills), not `gitrole` CLI subcommands. Do not run an installer over an existing skill without reviewing its files, ownership, destination, and proposed replacement. Keep custom instructions and older copies until you deliberately reconcile them.

<h2 id="cli-prerequisite">Install the CLI separately</h2>

Installing a skill does not install the Gitrole executable. You need Gitrole 0.12.0 or newer with local commit-check support on the agent’s actual `PATH`. Install through your chosen channel, then verify in the environment where the agent will work:

```bash
gitrole --version
gitrole check commit --help
```

Help must describe the local commit check. An unsupported or missing CLI is a blocker; the agent should report it rather than silently install, upgrade, change PATH, or substitute an online check. See [Install and update Gitrole]({{ '/guides/install-and-update-gitrole/' | url }}) for Homebrew and npm instructions.

<h2 id="discover">Confirm discovery and behavior</h2>

Confirm the skill appears in your agent’s skill list using that agent’s current setup instructions. For Codex, invoke `$gitrole` in a task to test explicit discovery. Installation paths and automatic selection depend on the agent and version; a folder on disk alone does not prove loading.

The entrypoint loads only the reference needed for the task:

- `references/identity-and-policy.md`: saving, importing, explicit local switching, and policy inspection
- `references/commit-preflight.md`: the local `gitrole check commit` gate, offline diagnosis, and separate retained-author review for amend
- `references/push-diagnosis.md`: default push destinations, account diagnostics, and limits of status for explicit push arguments

Try a read-only request such as “Use Gitrole to check whether this repository’s identity is ready for an ordinary commit; do not commit or change configuration.” Inspect the agent’s actual commands and result: it should use `check commit` for the commit decision and `doctor --offline --json` if local diagnosis is needed. No remote or authentication is required for this local check. A successful local check is quiet exit `0`; mismatches exit `2`, required-data or operational failures exit `1`. Neither failure authorizes automatic repair.

Push diagnosis uses `status --short` separately. A default-destination alignment result cannot approve arbitrary explicit push arguments. See the [machine-readable contracts]({{ '/machine-readable-contracts/' | url }}) and [automation guide]({{ '/use-cases/use-gitrole-as-an-identity-preflight-for-agents-and-automation/' | url }}) for command behavior.

<h2 id="where-the-skill-lives">Manual installation and packaging</h2>

The repository source is `skills/gitrole/`. The npm package includes the same folder at `$(npm root -g)/gitrole/skills/gitrole` for a global installation, or `node_modules/gitrole/skills/gitrole` for a project dependency. Homebrew users can use the Skills installer or a source checkout; no supported Homebrew asset path is documented here.

Install or link the **entire `gitrole` folder**, including `SKILL.md` and `references/`, into the skill directory documented by your agent. Copying only `SKILL.md` breaks its relative reference links. Inspect existing files and symlinks first; do not overwrite or retarget them silently. Keep the source available when linking: a moved checkout or removed package can break the link.

<h2 id="updates">Update the skill and CLI independently</h2>

Before updating, review the desired source revision, installation scope, and existing files, and retain a private backup of custom or older instructions. The current Skills installer supports `npx skills update gitrole --project` for a project installation or `npx skills update gitrole --global` for a user-wide installation. These commands replace installed content; run them only after approving that update. Installer versions can behave differently: consult the installed version’s help and source before use. Do not assume `npx skills check` is read-only; current versions alias it to the update workflow. For a manual installation, reconcile the entire folder using your original installation method.

A CLI upgrade does not update a separately copied or Skills-managed skill. A linked npm skill follows that package’s files, while a copied folder remains unchanged. Updating a skill does not upgrade the CLI. Recheck CLI compatibility, reference files, discovery, and an actual read-only task after either changes. A source merge does not establish publication in every installation channel.

<h2 id="migration">Review older skills and hooks</h2>

Older skill copies may use combined `status --short` results to block local commits on remote or authentication warnings. The current skill keeps local commit gating separate from push diagnosis. Review and migrate those instructions deliberately; do not simply layer a new copy over an active old one or bypass an installed hook.

The optional `hooks/pre-commit` also uses the local `check commit` guard. Installing or updating the skill does not install, replace, or enable hooks. Existing hook chains, shared paths, and symlinks need their own owner-approved review and backup. See [local hook compatibility and migration]({{ '/guides/check-identity-before-a-local-commit/' | url }}) before changing them.
