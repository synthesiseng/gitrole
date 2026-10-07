# Releasing

`gitrole` is shipped primarily through npm. This document keeps the release path short, repeatable, and easy to verify.

## Release Policy

- Release tags use `vX.Y.Z`.
- `package.json` stays semver-aligned with the release tag. Example: tag `v0.4.1` matches package version `0.4.1`.
- Every release tag should have a corresponding GitHub Release.
- npm is the canonical shipped artifact. GitHub Releases document the version; npm is the package users install.
- Existing legacy tags may use older naming. New releases should use the `vX.Y.Z` format only.

## Release Checklist

1. Merge conventional-commit changes to `main`.
2. Let Release Please open or update the release PR.
3. Review the release PR contents:
   - `package.json` and `package-lock.json` version bump
   - generated changelog/release notes
   - green CI
4. Merge the release PR to `main`.
5. Let Release Please create the `vX.Y.Z` tag and corresponding GitHub Release from that merged `main` commit.
6. Let `.github/workflows/publish.yml` publish the package to npm from the published GitHub Release.
7. Verify the release externally:
   - `npm view gitrole version`
   - confirm the GitHub Release exists for `vX.Y.Z`
   - confirm the docs site is live at `https://docs.gitrole.dev`

Manual version bumps and hand-cut release tags should no longer be the default path. If Release Please is unavailable, follow the same invariants manually: cut the version on `main`, tag the merged `main` commit with `vX.Y.Z`, and publish only after the GitHub Release is created.

## GitHub Release Notes Template

Use this as the starting point for each GitHub Release:

```md
## Summary

- Short description of the release.

## Notable Changes

- Change 1
- Change 2

## Breaking Changes

- None

## Docs

- Docs site: https://docs.gitrole.dev

## Package

- npm: https://www.npmjs.com/package/gitrole
```

Keep the notes focused on externally meaningful changes. Pull request bodies are good input, but they are not the release note by themselves.

## Branch Hygiene

- Use pull requests to merge into `main`.
- Keep `main` as the protected long-lived branch.
- Delete merged topic branches once they are no longer needed.
- Keep branch names short, readable, and scoped, for example `feat/...`, `fix/...`, `docs/...`, `test/...`, or `ci/...`.
- Reserve release tags for shipped versions only. Do not use ad hoc tags for temporary checkpoints.

## Governance Expectations

- Branch protection or rulesets should prevent direct pushes to `main`.
- Required CI should stay green before merging.
- Tag protections, when configured, should reserve `v*.*.*` tags for intentional releases.

## Safe Automation

- The repository includes `.github/workflows/release-please.yml` to manage the release PR, release tag, and GitHub Release for the root npm package. It should use a GitHub App token generated from the `RELEASE_PLEASE_APP_ID` Actions variable and the `RELEASE_PLEASE_APP_PRIVATE_KEY` secret; the default `GITHUB_TOKEN` is not sufficient because tags and releases created with it will not trigger `.github/workflows/publish.yml`.
- The repository includes a tag-validation workflow for release tags. It validates version alignment and runs the release-confidence checks, but it does not publish to npm or create a GitHub Release automatically.
- The repository also includes `.github/workflows/publish.yml` for npm Trusted Publishing. When npm Trusted Publishing is configured for this repository and workflow filename, a published GitHub Release can publish the tagged version to npm without an npm token.

## Local npm-to-Homebrew qualification

Run `npm run test:release-workflow` for the bounded release fixtures. This also
runs at the end of `npm run test:release`. It executes the current workflow's
named shell blocks with stubbed npm/curl and disposable local bare tap remotes.
It checks formula update/replay, validation failures, download attempts, npm
failure boundaries, denied/concurrent pushes and lost push acknowledgments.
The fixture scheduler and source-contract checks do not execute GitHub Actions
or prove App permissions, OIDC, tap protection or installed CLI/helper pairing.

The suite characterizes inherited risks rather than approving them: failed npm
lookups are treated as absence, and the rewriter can replace matching version
text outside its primary fields.
Green fixtures do not make those behaviors safe recovery policy. Consequential changes need an owner decision.

## npm tarball propagation

The Homebrew job waits for the version-specific npm tarball within a 600-second
network retry budget. Each curl request has a 10-second connection limit and a
30-second transfer limit, both reduced when less time remains. Failed requests
wait up to 10 seconds before retrying, also limited by the remaining budget.
This bounds network waiting, not the entire job or local gzip/hash processing.

All curl failures remain retryable within that budget. Exhaustion fails the
step with the URL, attempt count and last curl exit code; it emits no artifact
outputs and does not update Homebrew. A successful response must still pass the
existing gzip and checksum checks. Invalid gzip fails immediately. Temporary
download bytes are removed on success or failure.

The local shell fixtures simulate elapsed time and transport results to check
budget arithmetic, delayed availability and output boundaries. They do not prove
live registry propagation or GitHub Actions execution. If npm succeeded but the
download failed, inspect the registry and failed run before a separately approved
job-only retry. Retrying an old run uses its original workflow, not this change;
normal dispatch still does not update Homebrew. This change does not alter npm
lookup failure classification or republish from the Homebrew job.

## Homebrew version-order policy

Normal release retries compare stable `X.Y.Z` versions numerically, so `0.10.4`
advances `0.9.1`. Prerelease releases and tags are excluded from the tap job;
the formula helper also skips prerelease candidates. No npm `latest` lookup is
required for this rule.

An older candidate leaves the formula unchanged and succeeds with an explicit
job summary, for example `tap already at 0.10.5, skipped 0.10.4`. An equal version
is a no-op only when its registry URL and checksum identify the same artifact;
a conflicting checksum or inconsistent formula URL/version fails before writing.
A newer stable version updates normally. Exact repeated retries create no extra
formula commit or push. Intentional rollback has no bypass in this workflow.

Tap pushes remain ordinary non-force pushes. A concurrent remote update rejects
a stale push and fails the job; retry from a fresh checkout only after inspecting
the competing change. There is no automatic rebase or reconciliation. Historical
release reruns use their tagged workflow/helper and do not acquire this guard
from a later merge. These local fixtures do not establish live protection or
installed-binary qualification.

## Proposed recovery of an already published version

A failed Homebrew job after npm success does not undo npm publication. An old
Actions run reruns its original SHA/ref; the release event uses the tagged source.
Rerunning a historical release therefore cannot adopt a workflow fix merged
later. Normal Publish dispatch deliberately skips the Homebrew job.

For exact 0.10.4 recovery, the smallest proposed route is a separately reviewed,
one-time tap-only workflow on updated main. It requires an explicit owner
exception to the release-only tap policy before implementation and separate
approval before live execution. No recovery entrypoint is added by this change.

The proposed operation would pin 0.10.4, verify its existing release and published
npm artifact, hash the downloaded bytes, and use the existing tap-only App token
scope. It would read current tap main, reject a newer formula, treat equal bytes
as a no-op, preserve unrelated bytes, and use a normal non-force push of the
checked-out parent. Concurrent rejection requires a fresh read and separately
authorized retry; it must not silently force, roll back or republish npm.
Review the exact resulting formula and tap commit before claiming recovery.
Remove the one-time workflow after verified recovery if the owner selects it.

Do not move a shipped tag, recreate a release to pick up new workflow source,
change normal dispatch semantics, or infer live success from these fixtures.
A future approved release containing the updated workflow can advance the tap,
but does not establish recovery of exactly 0.10.4. Live recovery remains unproven.
