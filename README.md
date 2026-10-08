<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/gitrole-white.png">
    <img src="docs/assets/gitrole-black.png" alt="gitrole" width="60">
  </picture>
  <h1>gitrole</h1>
</div>

<p align="center">
    Switch your git identity in one command.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/gitrole"><img alt="npm version" src="https://img.shields.io/npm/v/gitrole?style=flat-square"></a>
  <a href="https://www.npmjs.com/package/gitrole"><img alt="npm downloads" src="https://img.shields.io/npm/dm/gitrole?style=flat-square"></a>
  <a href="https://nodejs.org/"><img alt="node version" src="https://img.shields.io/node/v/gitrole?style=flat-square"></a>
  <a href="https://github.com/synthesiseng/gitrole/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/synthesiseng/gitrole?style=flat-square"></a>
</p>

Gitrole saves a Git name and email as a named role, applies it locally or globally, and checks Git's effective author and committer. It also observes current default push destinations and supported SSH authentication.

## Install and update

Gitrole requires Node.js 20 or newer. Choose one channel:

```bash
brew install synthesiseng/tap/gitrole
```

Or, with Node.js already installed:

```bash
npm install -g gitrole
```

Then check `gitrole --version` and `command -v gitrole`. Both channels expose `gitrole` and `gitrole-prompt`.

Update Homebrew with `brew update`, then `brew upgrade synthesiseng/tap/gitrole`. Update npm with `npm install -g gitrole@latest`. If both are installed, the first executable on `PATH` wins.

As checked on September 30, 2026, npm latest and the Homebrew formula both targeted 0.10.5. A source merge does not establish publication. See [Install and update](https://docs.gitrole.dev/guides/install-and-update-gitrole/) for version and optional-asset boundaries.

## First use

Inside the repository, replace the example identity with yours:

```bash
gitrole add work --name "Alex Developer" --email "alex@work.example"
gitrole use work --local
gitrole current
gitrole status --short --offline
```

`add` saves the profile; `use --local` writes this repository's Git user configuration. `current` matches the effective author to a saved role. The offline check invokes zero SSH commands, including configuration inspection, while retaining local identity, destination, and policy checks.

In an HTTPS repository without a `.gitrole` pin, the common first result is:

```text
role=work scope=local override=true commit=ok remote=ok auth=warn policy=na overall=warning
```

The role was applied, but HTTPS identity expectations still warn. If the repository should use this role, save its expected GitHub username and create a matching pin:

```bash
gitrole add work --name "Alex Developer" --email "alex@work.example" --github-user alex-work
gitrole pin work
gitrole status --short --offline
```

Use your actual username. `add` replaces the profile; include any other fields you want to keep. `pin` refuses to overwrite an existing policy. With a matching role and no other warnings, HTTPS becomes `auth=na policy=ok overall=aligned`. This expresses a local expectation; it **does not verify HTTPS credentials or repository access**. Review `.gitrole` before sharing it.

For SSH prerequisites and a full walkthrough, read [Use the right Git identity for this repo](https://docs.gitrole.dev/guides/use-the-right-git-identity-for-this-repo/).

## Interpret results

| Command | Purpose |
| --- | --- |
| `gitrole current` | Find the saved role matching the effective author. |
| `gitrole status` | Read a concise identity and default push check. |
| `gitrole doctor` | Explain warnings and each push destination. |
| `gitrole doctor --json` | Inspect structured identity, provenance, and check results. |

`status --short` prints eight fields in order: `role scope override commit remote auth policy overall`. Read fields by name. Exit `0` means `overall=aligned`; exit `2` means `overall=warning` with a valid result. Exit `1` means failure, with stderr and empty stdout. `na` is skipped or inapplicable, not proof of authentication.

Gitrole asks Git for the effective author and committer, including environment overrides and included configuration. `current` and `import current` use the author. A mismatched or missing committer warns. Configured scope can be `mixed` even when effective field sources are `env`.

Push checks cover the selected default remote and **every** Git-resolved push URL. HTTPS-only matching pins can yield `auth=na`; absent or mismatched pins warn, including offline. Mixed SSH/HTTPS warns online. Custom, interactive, or incomplete SSH contexts remain unverified. Online inspection may execute configured `Match exec` commands or DNS lookups.

For an unverified SSH account, read the specific reason and any manual-check guidance. `gitrole doctor --json` retains all reported reasons; a separate SSH greeting does not verify the push context. See [SSH warnings](https://docs.gitrole.dev/guides/troubleshoot-identity-warnings/#ssh-unverified).

A result is a snapshot. It cannot predict future explicit author/push arguments or changed configuration/environment, and it does not prove refspec readiness, push authorization, or push success.

## Troubleshoot and continue

Run `gitrole doctor` to identify a warning, then use [Troubleshoot identity warnings](https://docs.gitrole.dev/guides/troubleshoot-identity-warnings/).

- [Import the current Git identity](https://docs.gitrole.dev/guides/import-the-current-git-identity/): save the effective author Git already uses.
- [Use repo-local identity policy](https://docs.gitrole.dev/guides/use-repo-local-identity-policy-with-gitrole/): choose default and allowed roles.
- [Fix pushes using the wrong account](https://docs.gitrole.dev/use-cases/fix-pushes-using-the-wrong-github-account/): inspect the actual selected push destinations before changing origin.
- [Show gitrole in your shell prompt](https://docs.gitrole.dev/guides/show-gitrole-in-your-shell-prompt/): offline checks require 0.9.0 or newer. Current source examples are in `examples/prompt/`. Fish and full Starship rendering are not qualified by this documentation pass.
- [Enable shell completion](https://docs.gitrole.dev/guides/enable-shell-tab-completion/): load optional scripts from npm or a checkout.
- [Verify identity before an agent commits](https://docs.gitrole.dev/guides/verify-git-identity-before-an-agent-commits/): use the packaged skill or an optional check-only hook within an authorized workflow.

The npm package includes `skills`, `hooks`, and `completions`. This guide provides no supported Homebrew path for those assets; Homebrew users can use a source checkout. Installation does not enable them automatically.

Gitrole does not manage browser sessions, run `gh auth`, store HTTPS credentials, or create GitHub accounts. Role switching does not rewrite history or configure an SSH host alias.

A prompt checkmark means auth was not checked; it does not mean network auth was verified.

## Reference

Gitrole warns on violated expectations, not assumptions. Use the command reference for the full surface:

| Command | Purpose |
| --- | --- |
| `gitrole import current --name <role>` | Save the effective author. |
| `gitrole pin <role>` | Create a strict repository policy. |
| `gitrole resolve` / `gitrole resolve --json` | Read the default role or full policy. |
| `gitrole status --short` | Read eight alignment fields. |
| `gitrole remote set <name>` | Rewrite origin's fetch URL to a saved host alias. |


[Commands](https://docs.gitrole.dev/commands/) lists flags and side effects. [Machine-readable contracts](https://docs.gitrole.dev/machine-readable-contracts/) defines short fields, JSON, source/scope vocabulary, and exit codes. [Documentation](https://docs.gitrole.dev/) links the task guides.

## License

MIT
