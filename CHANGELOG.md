# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.59](https://github.com/KonstantinAxt/anti-slop/compare/anti-slop-v0.1.58...anti-slop-v0.1.59) (2026-10-15)


### Features

* **review:** keep the judge's confidence on llm-review findings ([#75](https://github.com/KonstantinAxt/anti-slop/issues/75)) ([994bf93](https://github.com/KonstantinAxt/anti-slop/commit/994bf930d479c1eac514450ec1a8a0f0a5d0a820))

## [0.1.58](https://github.com/KonstantinAxt/anti-slop/compare/anti-slop-v0.1.57...anti-slop-v0.1.58) (2026-10-15)


### Bug Fixes

* **review:** send --llm-review the file from the same version as the diff ([#76](https://github.com/KonstantinAxt/anti-slop/issues/76)) ([5bd5fb8](https://github.com/KonstantinAxt/anti-slop/commit/5bd5fb88b4c1b9f6eb23206fbc7d776c02839119))

## [0.1.57](https://github.com/KonstantinAxt/anti-slop/compare/anti-slop-v0.1.56...anti-slop-v0.1.57) (2026-10-14)


### Miscellaneous Chores

* release 0.1.57 ([#66](https://github.com/KonstantinAxt/anti-slop/issues/66)) ([5a4203a](https://github.com/KonstantinAxt/anti-slop/commit/5a4203a722e6dfeabe3964bfb61b350a79515cbc))

## [0.1.56](https://github.com/KonstantinAxt/anti-slop/compare/anti-slop-v0.1.55...anti-slop-v0.1.56) (2026-10-14)


### Bug Fixes

* **mutation:** treat files in tests/ and test/ folders as test code ([#60](https://github.com/KonstantinAxt/anti-slop/issues/60)) ([c26b2de](https://github.com/KonstantinAxt/anti-slop/commit/c26b2dedc2bcc0ed1836a73ba6854de653e312bf))

## [0.1.55](https://github.com/KonstantinAxt/anti-slop/compare/anti-slop-v0.1.54...anti-slop-v0.1.55) (2026-10-13)


### Bug Fixes

* **rules:** let SAFETY justifications silence consistent-type-assertions ([#55](https://github.com/KonstantinAxt/anti-slop/issues/55)) ([7792069](https://github.com/KonstantinAxt/anti-slop/commit/7792069b5c7c12ebbe47ff8a6efe40f086def9de)), closes [#47](https://github.com/KonstantinAxt/anti-slop/issues/47)

## [0.1.54](https://github.com/KonstantinAxt/anti-slop/compare/anti-slop-v0.1.53...anti-slop-v0.1.54) (2026-10-13)


### Bug Fixes

* **rules:** follow same-file helpers in no-env-shell-command ([#54](https://github.com/KonstantinAxt/anti-slop/issues/54)) ([f4dbbda](https://github.com/KonstantinAxt/anti-slop/commit/f4dbbda9d324ab2b3e4b8e039f580adf7a2444a5)), closes [#46](https://github.com/KonstantinAxt/anti-slop/issues/46)

## [0.1.53](https://github.com/KonstantinAxt/anti-slop/compare/anti-slop-v0.1.52...anti-slop-v0.1.53) (2026-10-12)


### Bug Fixes

* **rules:** avoid duplicate dictionary any findings ([#52](https://github.com/KonstantinAxt/anti-slop/issues/52)) ([8ad133e](https://github.com/KonstantinAxt/anti-slop/commit/8ad133e9c3959afba259d631eb032f73259a55c7))

## [0.1.52](https://github.com/KonstantinAxt/anti-slop/compare/anti-slop-v0.1.51...anti-slop-v0.1.52) (2026-10-12)


### Features

* **rules:** add opt-in no-unknown-parameters and no-unknown-dictionary-values rules ([#44](https://github.com/KonstantinAxt/anti-slop/issues/44)) ([3360eba](https://github.com/KonstantinAxt/anti-slop/commit/3360eba589dad9d4d2817f7ad51ef67d36dd54ae))

## [0.1.51](https://github.com/KonstantinAxt/anti-slop/compare/anti-slop-v0.1.50...anti-slop-v0.1.51) (2026-10-12)


### Features

* **rules:** add opt-in no-reflect-escape rule ([#30](https://github.com/KonstantinAxt/anti-slop/issues/30)) ([d084785](https://github.com/KonstantinAxt/anti-slop/commit/d08478542e5af9ee864d5f3a9fc75688fb2d1f22))

## [0.1.50](https://github.com/KonstantinAxt/anti-slop/compare/anti-slop-v0.1.49...anti-slop-v0.1.50) (2026-10-12)


### Features

* **rules:** add opt-in no-unknown-returns rule ([#32](https://github.com/KonstantinAxt/anti-slop/issues/32)) ([40f9574](https://github.com/KonstantinAxt/anti-slop/commit/40f9574df72bdcaeca74b14a056ad411e2687d81))

## [0.1.49](https://github.com/KonstantinAxt/anti-slop/compare/anti-slop-v0.1.48...anti-slop-v0.1.49) (2026-10-12)


### Bug Fixes

* **strict-ts:** stop recommending unknown as an any replacement ([#38](https://github.com/KonstantinAxt/anti-slop/issues/38)) ([1cc7285](https://github.com/KonstantinAxt/anti-slop/commit/1cc728570b1dcadcf79689cefde5371682a7ba97))

## [0.1.48](https://github.com/KonstantinAxt/anti-slop/compare/anti-slop-v0.1.47...anti-slop-v0.1.48) (2026-10-12)


### Features

* **rules:** require a justification comment on type assertions ([#31](https://github.com/KonstantinAxt/anti-slop/issues/31)) ([72290d6](https://github.com/KonstantinAxt/anti-slop/commit/72290d65186ec07c0e242a9f77fe61c3d08b061c))

## [0.1.47](https://github.com/KonstantinAxt/anti-slop/compare/anti-slop-v0.1.46...anti-slop-v0.1.47) (2026-10-12)


### Bug Fixes

* **preflight:** do not treat Stryker fallback globs as changed files ([#29](https://github.com/KonstantinAxt/anti-slop/issues/29)) ([0c24519](https://github.com/KonstantinAxt/anti-slop/commit/0c2451968aeebc69fc847adcffb5a2ac8e49ea97))

## [0.1.46](https://github.com/KonstantinAxt/anti-slop/compare/anti-slop-v0.1.45...anti-slop-v0.1.46) (2026-10-12)


### Features

* **mutation:** with --since, only mutate changed lines ([#34](https://github.com/KonstantinAxt/anti-slop/issues/34)) ([b6a0630](https://github.com/KonstantinAxt/anti-slop/commit/b6a06304d97c96dd316ffd568cde5df124bbc90b))

## [0.1.45](https://github.com/KonstantinAxt/anti-slop/compare/anti-slop-v0.1.44...anti-slop-v0.1.45) (2026-10-09)


### Bug Fixes

* **scan:** walk explicitly targeted directories that git ignores ([#24](https://github.com/KonstantinAxt/anti-slop/issues/24)) ([1eded27](https://github.com/KonstantinAxt/anti-slop/commit/1eded27e89c4ff0c65f4aca22b2613028c675f8e))

## [0.1.44](https://github.com/KonstantinAxt/anti-slop/compare/anti-slop-v0.1.43...anti-slop-v0.1.44) (2026-10-09)


### Features

* **judge:** opt-in advisory --llm-review CLI flag ([#22](https://github.com/KonstantinAxt/anti-slop/issues/22)) ([7d19e8f](https://github.com/KonstantinAxt/anti-slop/commit/7d19e8fae820edf7e583f2ff62d71cb3f2b1c056))

## [0.1.43](https://github.com/KonstantinAxt/anti-slop/compare/anti-slop-v0.1.42...anti-slop-v0.1.43) (2026-10-08)


### Bug Fixes

* **judge:** accept one fenced JSON block after prose ([#19](https://github.com/KonstantinAxt/anti-slop/issues/19)) ([4fde4d6](https://github.com/KonstantinAxt/anti-slop/commit/4fde4d649e28454793e277b0bb699df93c104cdc))

## [0.1.42](https://github.com/KonstantinAxt/anti-slop/compare/anti-slop-v0.1.41...anti-slop-v0.1.42) (2026-10-08)


### Features

* **judge:** optional reasoningEffort option for the judge provider ([#17](https://github.com/KonstantinAxt/anti-slop/issues/17)) ([f55ec75](https://github.com/KonstantinAxt/anti-slop/commit/f55ec7549a649e760f0ae4a175327afde896f7dc))

## [0.1.41](https://github.com/KonstantinAxt/anti-slop/compare/anti-slop-v0.1.40...anti-slop-v0.1.41) (2026-10-07)


### Features

* **judge:** evidence location checks and token ceiling ([#11](https://github.com/KonstantinAxt/anti-slop/issues/11)) ([1bbacbe](https://github.com/KonstantinAxt/anti-slop/commit/1bbacbe6cb6d33c0f538c2c1390e0429564240ac))
* **judge:** offline judge with schema validation ([#10](https://github.com/KonstantinAxt/anti-slop/issues/10)) ([81ba341](https://github.com/KonstantinAxt/anti-slop/commit/81ba3417dfc7b2ddc203b9b30c745ed04e2c83da))
* **judge:** OpenAI-compatible provider ([#14](https://github.com/KonstantinAxt/anti-slop/issues/14)) ([f19d89d](https://github.com/KonstantinAxt/anti-slop/commit/f19d89d848ec240a9b9f3ca7f03f4628c5c225c0))
* **judge:** redact secrets before sending ([#13](https://github.com/KonstantinAxt/anti-slop/issues/13)) ([60fe30a](https://github.com/KonstantinAxt/anti-slop/commit/60fe30aec9c5a53ab9a0cd2e95980c62b410f5da))
* **rules:** add doubleLookup message to slop/no-redundant-presence-check rule ([#12](https://github.com/KonstantinAxt/anti-slop/issues/12)) ([1d799ac](https://github.com/KonstantinAxt/anti-slop/commit/1d799ac2ff0c2cbcaaee4bf236b41354986b22e9)), closes [#4](https://github.com/KonstantinAxt/anti-slop/issues/4)
* **rules:** add slop/no-redundant-presence-check rule (unreachableGuard) ([#8](https://github.com/KonstantinAxt/anti-slop/issues/8)) ([4729182](https://github.com/KonstantinAxt/anti-slop/commit/472918276e23af77605b1a061ae22b0c8f30c529)), closes [#4](https://github.com/KonstantinAxt/anti-slop/issues/4)
* **skills:** add anti-slop agent skill ([#7](https://github.com/KonstantinAxt/anti-slop/issues/7)) ([8c20eea](https://github.com/KonstantinAxt/anti-slop/commit/8c20eeadea83144247d85e883b05541582b44e8f)), closes [#6](https://github.com/KonstantinAxt/anti-slop/issues/6)

## 0.1.40 (2026-10-06)

First public release. Earlier versions were developed in a private repository.
