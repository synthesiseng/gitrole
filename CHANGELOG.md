# Changelog

## Unreleased

### Breaking Changes

* **repo-policy:** `.gitrole` `defaultRole` and `allowedRoles` now use the same role-name rules as saved roles (`[a-z0-9_-]`: lowercase letters, numbers, `_`, and `-`) ([#55](https://github.com/synthesiseng/gitrole/issues/55)) ([c0e6f25](https://github.com/synthesiseng/gitrole/commit/c0e6f2575c64e04c0ddd580a30b5a4b6e040e458))
  * invalid policy names fail closed: `gitrole resolve`, `gitrole resolve --json`, `gitrole status`, `gitrole doctor`, and `gitrole doctor --json` exit `1`, write the error to stderr, and emit no stdout
  * a missing `.gitrole` file still leaves `status` and `doctor` usable; only an invalid policy hard-fails those commands
  * valid policy files and the `status --short` field contract are unchanged

### Bug Fixes

* **status:** HTTPS `auth=na` only when a repo pin allows the active role and that role has a `githubUser`; no pin or a github user mismatch is `auth=warn` and exit `2` (previously exit `0` on those HTTPS repos)

## [0.9.0](https://github.com/synthesiseng/gitrole/compare/v0.8.0...v0.9.0) (2026-09-27)


### Features

* add a shell prompt segment from status --short ([#66](https://github.com/synthesiseng/gitrole/issues/66)) ([804515b](https://github.com/synthesiseng/gitrole/commit/804515bb4b91229b8f9a22b55d02078104b7d3ed))

## [0.8.0](https://github.com/synthesiseng/gitrole/compare/v0.7.6...v0.8.0) (2026-09-27)


### Bug Fixes

* **status:** warn on unpinned and mismatched HTTPS auth ([#62](https://github.com/synthesiseng/gitrole/issues/62)) ([607d1cd](https://github.com/synthesiseng/gitrole/commit/607d1cdd4307f654cb198006e458cdfb2fabbcc2))
* **test:** keep npm pack from truncating dist during e2e ([#64](https://github.com/synthesiseng/gitrole/issues/64)) ([9f26dfe](https://github.com/synthesiseng/gitrole/commit/9f26dfe9f99f81e3ec45af3eaf21ec369b7cb236))

## [0.7.6](https://github.com/synthesiseng/gitrole/compare/v0.7.5...v0.7.6) (2026-09-26)


### Breaking Changes

* **status:** `gitrole status --short` grew from 7 fields to 8. `policy` is inserted before `overall`. Field order is `role scope override commit remote auth policy overall`. Parsers that treated the 7th field as `overall` must read fields by name, or use the 8th field ([#57](https://github.com/synthesiseng/gitrole/issues/57)) ([4b841e4](https://github.com/synthesiseng/gitrole/commit/4b841e4a4ca69cd208c31f459bd0871a392b8c1f))

### Bug Fixes

* **status:** let HTTPS setups align and expose policy on --short ([#57](https://github.com/synthesiseng/gitrole/issues/57)) ([4b841e4](https://github.com/synthesiseng/gitrole/commit/4b841e4a4ca69cd208c31f459bd0871a392b8c1f))

## [0.7.5](https://github.com/synthesiseng/gitrole/compare/v0.7.4...v0.7.5) (2026-04-15)


### Bug Fixes

* **store:** harden persisted saved-role loading ([#53](https://github.com/synthesiseng/gitrole/issues/53)) ([731d60f](https://github.com/synthesiseng/gitrole/commit/731d60fb4dad7864bfa582967171948401ffca34))

## [0.7.4](https://github.com/synthesiseng/gitrole/compare/v0.7.3...v0.7.4) (2026-04-15)


### Bug Fixes

* restore npm package metadata to org repository ([#49](https://github.com/synthesiseng/gitrole/issues/49)) ([9170aaf](https://github.com/synthesiseng/gitrole/commit/9170aaf2b1d53b6f70313101053038c7619e9248))

## [0.7.3](https://github.com/synthesiseng/gitrole/compare/v0.7.2...v0.7.3) (2026-04-15)


### Bug Fixes

* **publish:** align package metadata and harden npm publish flow ([#47](https://github.com/synthesiseng/gitrole/issues/47)) ([c03bbe7](https://github.com/synthesiseng/gitrole/commit/c03bbe72638d9c450bc15ebba60e833ebfc7beb1))

## [0.7.2](https://github.com/synthesiseng/gitrole/compare/v0.7.1...v0.7.2) (2026-04-15)


### Bug Fixes

* **docs:** restore machine-readable contracts page ([#45](https://github.com/synthesiseng/gitrole/issues/45)) ([2cbb4d5](https://github.com/synthesiseng/gitrole/commit/2cbb4d5631bc588f0b76d835c40417f53e2a2f1f))

## [0.7.1](https://github.com/synthesiseng/gitrole/compare/v0.7.0...v0.7.1) (2026-04-15)


### Bug Fixes

* **contract:** validate role names for stable machine output ([#42](https://github.com/synthesiseng/gitrole/issues/42)) ([4f503b7](https://github.com/synthesiseng/gitrole/commit/4f503b7dc34362fbbf3de439c10e4a5d66903b78))

## [0.7.0](https://github.com/synthesiseng/gitrole/compare/v0.6.0...v0.7.0) (2026-04-12)


### Features

* **cli:** add import current onboarding command ([#37](https://github.com/synthesiseng/gitrole/issues/37)) ([6dea02e](https://github.com/synthesiseng/gitrole/commit/6dea02eb639d2f3bf68d252e92a6512979609b4e))

## [0.6.0](https://github.com/synthesiseng/gitrole/compare/gitrole-v0.5.0...gitrole-v0.6.0) (2026-04-12)


### Features

* **repo-policy:** add pin and resolve --json ([#32](https://github.com/synthesiseng/gitrole/issues/32)) ([f3539e1](https://github.com/synthesiseng/gitrole/commit/f3539e177fa10abe2522e3fef72476bf71fc9858))

## [0.5.0](https://github.com/synthesiseng/gitrole/compare/gitrole-v0.4.1...gitrole-v0.5.0) (2026-04-12)


### Features

* **cli:** add doctor --json output ([f263db5](https://github.com/synthesiseng/gitrole/commit/f263db5d1cb0ce1f2c05510a1e76b17a9dec35e2))
* **cli:** add doctor --json output ([17b2412](https://github.com/synthesiseng/gitrole/commit/17b241276039c6f2f66e957b7f5f318ba928a26a))
* **cli:** add gitrole status command ([02a19eb](https://github.com/synthesiseng/gitrole/commit/02a19ebd5272c29661328ddeb0f71ad592884803))
* **cli:** add gitrole status command ([9fa86ef](https://github.com/synthesiseng/gitrole/commit/9fa86ef1ee3234e470cee4d790e0b240b22bf7e1))
* **cli:** add gitrole v0.2.0 repo and auth diagnostics ([4df14b5](https://github.com/synthesiseng/gitrole/commit/4df14b5df0d58cc7a6d60fdcf5c3e336023d5b4a))
* **cli:** add scoped role switching ([9e49233](https://github.com/synthesiseng/gitrole/commit/9e49233c29703a45eefd0750b8d5a69c4d4722ed))
* **cli:** add scoped role switching ([61b69ae](https://github.com/synthesiseng/gitrole/commit/61b69aec7e8a254e0ea464f6368709303cb422dc))
* **cli:** add v0.2 repo and auth diagnostics ([69d73f7](https://github.com/synthesiseng/gitrole/commit/69d73f71b5a56723861239f6650fdb12d4854a70))
* **cli:** add verify command and status history hint ([fc375d0](https://github.com/synthesiseng/gitrole/commit/fc375d02dc684736a9e9afffc2244617963d35a9))
* **cli:** add verify command and status history hint ([a6d3c2f](https://github.com/synthesiseng/gitrole/commit/a6d3c2f28d2f32bb0f43738dd1cf5c992f6566bb))
* **cli:** implement gitrole v0.1.0 ([6c99479](https://github.com/synthesiseng/gitrole/commit/6c99479058a37f1f48a6974d78b81f10825e7a6d))
* **cli:** simplify command surface for v0.3.0 ([3fd4aab](https://github.com/synthesiseng/gitrole/commit/3fd4aab0fb7301000673476987bb528042d57cf4))
* **cli:** simplify command surface for v0.3.0 ([08e3d2d](https://github.com/synthesiseng/gitrole/commit/08e3d2dd5e58c50bac820e13d863c8964626834a))
* implement gitrole v0.1.0 CLI ([946d29c](https://github.com/synthesiseng/gitrole/commit/946d29c736ca1d64ebc886bf2f48eea7efa613e2))
* **repo-policy:** add .gitrole support and resolve command ([337251b](https://github.com/synthesiseng/gitrole/commit/337251b42346591da47d0934166ae5ad3883ed7a))
* **repo-policy:** add .gitrole support and resolve command ([673e958](https://github.com/synthesiseng/gitrole/commit/673e9587f592262d2aa395b7ca8f1980e0c84d47))


### Bug Fixes

* **ci:** release please app id variable ([#30](https://github.com/synthesiseng/gitrole/issues/30)) ([ebd172d](https://github.com/synthesiseng/gitrole/commit/ebd172da9501c597b7e88af50e12097f088186c4))
* **diagnosis:** make diagnosis warnings expectation-based and add agent workflow docs ([0432538](https://github.com/synthesiseng/gitrole/commit/0432538be57ed6ff001763aa0b321b3a2caee96d))
* **diagnosis:** stop treating githubUser as remote owner expectation ([82b49d0](https://github.com/synthesiseng/gitrole/commit/82b49d022c60f6460e2893c987eeed6b940526c5))
* **diagnosis:** stop treating githubUser as remote owner expectation ([e469ee3](https://github.com/synthesiseng/gitrole/commit/e469ee3ceeff06d1edbc8093776c8ad9c524aa98))
* **diagnosis:** warn only on explicit expectations ([85d4bab](https://github.com/synthesiseng/gitrole/commit/85d4babb41b522e82e8ea2f43f889f0a6092e7d6))
* **docs:** aligned docs ([894f095](https://github.com/synthesiseng/gitrole/commit/894f0951bed1a840db3718f2d665239fa069cc2c))
* **docs:** aligned logo ([baa37ef](https://github.com/synthesiseng/gitrole/commit/baa37ef69b66e3c95441c047f6edd459cee6b220))
* **docs:** centered logo ([45272c8](https://github.com/synthesiseng/gitrole/commit/45272c8891767281b0e501b6339e4c4e44f08106))
* **docs:** remove non-ASCII CSS comment characters ([b14fc8d](https://github.com/synthesiseng/gitrole/commit/b14fc8db71823eba57ae6023c5be083ebfbc53e0))
* **docs:** restore Eleventy docs build scripts ([9b6bc97](https://github.com/synthesiseng/gitrole/commit/9b6bc977e97045c7c38d23aea5e35e73e29a9610))
* **docs:** restore Eleventy docs build scripts ([79237cc](https://github.com/synthesiseng/gitrole/commit/79237cc0801548d94f5827cdbdf64c22d198550d))
* **docs:** switch logo ([e5af66b](https://github.com/synthesiseng/gitrole/commit/e5af66b817d5ff315eeadf537f2f0a7e9a17e1e8))
* **status:** separate current identity from commit history ([e775bf2](https://github.com/synthesiseng/gitrole/commit/e775bf2c98ce8cec0c52848d1ec167a21063a5cf))
* **status:** separate current identity from commit history ([233334c](https://github.com/synthesiseng/gitrole/commit/233334ce212f8c4f020d407a4b28dbe9811cfe53))
