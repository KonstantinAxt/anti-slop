# anti-slop

anti-slop is a command-line tool that finds defects in source code before code review.
The tool runs on top of your existing linters.
The tool does not change the dependencies or the scripts of the target repository.

## Installation

### One-line installer

```bash
curl -fsSL https://raw.githubusercontent.com/KonstantinAxt/anti-slop/main/install.sh | bash
```

### From source

Requirements: **Node.js $\ge$ 24.21.0** and **pnpm $\ge$ 10.34.5**.

```bash
pnpm install
pnpm run build
pnpm link --global
```

Now you can run `anti-slop` from any directory on your computer.

## Usage

If you want to review changes before a commit, run this command:

```bash
anti-slop --staged
```

If you want to review a branch difference against main, run this command:

```bash
anti-slop --since origin/main
```

If you want to review a specific folder, provide the folder path:

```bash
anti-slop src/services/
```

If the repository tsconfig file is loose, add this flag:

```bash
anti-slop --allow-loose-tsconfig
```

This skips the repository tsconfig strictness audit while continuing virtual strict TypeScript analysis on scanned files. Under loose tsconfig mode, `strict-ts/no-implicit-any` diagnostics default to `warning` rather than `error`, allowing incremental adoption while still alerting to untyped boundaries. Explicit repository configuration overrides (`"error"` or `"off"`) remain authoritative.

If you want output for a large language model, use the llm flag:

```bash
anti-slop --since origin/main --llm
```

If you want machine-readable output, redirect the json output to a file:

```bash
anti-slop --since origin/main --json > audit.json
```

If you want mutation testing on changed files, add the mutation flag:

```bash
anti-slop --mutation --since origin/main
```

If you want to run mutation testing on a specific check or file, provide the file path:

```bash
node bin/anti-slop --mutation src/checks/strict-ts.ts
```

You can also run mutation testing with the test script:

```bash
pnpm run test:mutation src/checks/strict-ts.ts
```

If you want to estimate mutant volume, cache reuse, run time, and safe local concurrency without risk of freezing VSCode or crashing your workstation:

```bash
pnpm run test:mutation:preflight --since origin/main
# or with the CLI flag
anti-slop --preflight --since origin/main
```

For detailed guidance, see the [Mutation Testing Guide](documentation/mutation-testing.md).

If you want CRAP (Change Risk Anti-Pattern) analysis next to mutation testing, run `test:crap`:

```bash
pnpm run test:crap src/checks/strict-ts.ts
```

Or invoke the CLI directly:

```bash
anti-slop --crap --since origin/main
```

You can also configure a custom CRAP risk threshold (default is 30):

```bash
anti-slop --crap --crap-threshold 25
```

For detailed guidance, see the [CRAP Metric Guide](documentation/crap-metric.md).

If you want to run specific verification checks instead of the full suite, use the checks option:

```bash
anti-slop --since origin/main --checks mutation,crap
```

## Documentation

For comprehensive technical guides on anti-slop verification checks, see the [documentation](documentation/README.md) directory:

- [Mutation Testing](documentation/mutation-testing.md): Core concepts, mutant lifecycle, why mutation testing eliminates hollow tests, metric explanations, and next steps for killing surviving mutants.
- [CRAP Metric](documentation/crap-metric.md): Change Risk Anti-Pattern formula, cyclomatic complexity calculations, risk tiers, and remediation strategies for high-risk functions.

Issue numbers (such as #55 or #87) and commit hashes in the docs, test names and code comments refer to the earlier private repository this project was developed in. They do not match issues or commits here.

## Architecture & Verification Design

### Why `src/checks/` vs. `tests/`?

`anti-slop` maintains a strict separation between the rules it executes and the tests that verify those rules:

- **`src/checks/` (The Production Engine)**: The actual static analysis code executed when a developer runs `anti-slop`. Each check parses target code into a TypeScript AST, analyzes import/export graphs, or inspects statements, producing diagnostic warnings and errors.
- **`tests/` (Quality Assurance for the Engine)**: Automated suites executed when a tool developer runs `pnpm test`. These tests feed known valid and invalid code snippets to `src/checks/` to ensure rules trigger on real defects and never produce false positives on clean code.

```
                    ┌────────────────────────┐
                    │    node bin/anti-slop  │
                    │   (Scans user repos)   │
                    └───────────┬────────────┘
                                │ executes
                                ▼
                ┌─────────────────────────────────┐
                │          src/checks/            │  <-- Production Linters
                │  • hollow-tests.ts              │      (AST visitors, rule logic,
                │  • dead-code.ts                 │       finding collectors)
                │  • strict-ts.ts                 │
                └───────────────▲─────────────────┘
                                │ tested by
                                │
                ┌───────────────┴─────────────────┐
                │             tests/              │  <-- Test Suite
                │  • hollow-tests.test.ts         │      (Verifies edge cases,
                │  • dead-code.test.ts            │       avoids false positives,
                │  • rule-regressions.test.ts     │       guards against regressions)
                └─────────────────────────────────┘
                                ▲
                                │ executes
                    ┌───────────┴────────────┐
                    │       pnpm test        │
                    │  (For tool developers) │
                    └────────────────────────┘
```

## Repository Rule Priority Guard

When a repository defines its own rules, the repository configuration will take higher priority over anti-slop rules.

The tool reads rule configuration from these files in the target workspace:
- Flat ESLint configuration files like eslint.config.js, eslint.config.mjs, and eslint.config.ts
- Legacy ESLint configuration files like .eslintrc.json, .eslintrc.js, and .eslintrc
- Package configuration in package.json under the eslintConfig or anti-slop properties
- Dedicated anti-slop configuration files named anti-slop.json or .anti-slop.json

When a repository rule intersects with an anti-slop check:
- If the repository disables the rule with off or 0, the tool will suppress the finding.
- If the repository sets the rule to warn or 1, the tool will report the finding as a warning.
- If the repository sets the rule to error or 2, the tool will report the finding as an error.
- If the repository sets custom threshold options, the tool will evaluate findings against the repository threshold.
- If the repository defines file pattern overrides, the tool will apply the overrides to matching files only.

## Exit Codes

The tool returns one of three exit codes:

- 0: All checks passed.
- 1: The tool found code defects or boundary errors.
- 2: The tool met a system error or read failure.

## Rules

### Strict TypeScript

The strict-ts check enforces strict type safety in code and compiler options:

- strict-mode: The tsconfig compilerOptions must set strict to true.
- no-unchecked-indexed-access: The tsconfig compilerOptions must set noUncheckedIndexedAccess to true.
- exact-optional-property-types: The tsconfig compilerOptions must set exactOptionalPropertyTypes to true.
- no-non-null-assertion: You must not use the non-null assertion operator.
- no-explicit-any: You must not write the any type keyword.
- strict-null-checks: You must handle null and undefined before you access a property.
- strict-property-initialization: You must initialize class properties in the declaration or in the constructor.
- no-implicit-this: You must provide an explicit type annotation for this when the compiler cannot infer it.
- no-unused-locals: You must remove declarations and imports that you do not read.

### Behavior and Code Quality

The eslint check identifies logic errors, complexity, and common shortcuts:

- sonarjs/cognitive-complexity: Functions must not exceed a cognitive complexity score of 15.
- sonarjs/no-identical-conditions: You must not repeat identical conditions in an if and else if chain.
- sonarjs/no-duplicated-branches: You must not duplicate identical code blocks across branches.
- sonarjs/no-identical-expressions: You must not compare an expression to the same expression.
- sonarjs/no-duplicate-string: You must not repeat a string literal four or more times (suppressed in test/spec files).
- @typescript-eslint/consistent-type-assertions: You must not cast values with as Type syntax.
- @typescript-eslint/explicit-function-return-type: Top-level functions and methods must have explicit return type annotations (suppressed in test/spec files).
- @typescript-eslint/no-magic-numbers: You must declare named constants before you use literal numbers in business logic. Numbers that build a module-level SCREAMING_CASE `const` (for example `const TIMEOUT_MS = 10 * 60 * 1000`) and the indentation argument of `JSON.stringify` are allowed.
- @typescript-eslint/no-unused-vars: You must remove declared variables, imports, and parameters that are never read.
- slop/no-chained-type-assertions: You must not chain multiple type assertions together.
- slop/no-static-only-class: You must use standalone functions instead of a class that contains only static members.
- slop/no-trivial-functions: You must not create wrapper functions that only forward arguments without logic.
- slop/no-trivial-type-aliases: You must not create type aliases that rename a single primitive without union or constraint.
- slop/no-jargon: Comments must not use filler words like straightforward or detailed.
- slop/no-env-shell-command: You must not construct child process execution commands from environment variables without allowlisting or validation.
- slop/no-redundant-presence-check: You must not check Map#has before Map#get with redundant lookups or unreachable guards; look up the key once and narrow the result.
- no-warning-comments: Code must not contain leftover scratchpad notes or prompt markers.
- no-nested-ternary: You must not nest ternary expressions; use if/else chains or switch statements instead.
- array-callback-return: Callbacks of array methods (such as find, filter, map, some, every, reduce, and sort) must return a value.
- id-length: Variables and parameters must use descriptive names of at least 2 characters (except standard loop indices, coordinates, and discard variables).
- unicorn/no-await-in-promise-methods: You must not use await inside Promise.all or related methods.
- unicorn/no-useless-promise-resolve-reject: You must not wrap return values with Promise.resolve in an async function.
- unicorn/no-single-promise-in-promise-methods: You must not pass a single promise to Promise.all or Promise.race.
- unicorn/no-useless-fallback-in-spread: You must not add empty object fallbacks inside object spread operations.
- unicorn/no-useless-length-check: You must not check array length before an array method that handles empty arrays.
- unicorn/no-negation-in-equality-check: You must not negate the left side of an equality comparison.
- unicorn/no-invalid-fetch-options: You must not pass unsupported configuration properties to fetch.
- unicorn/prefer-logical-operator-over-ternary: You must use logical operators instead of ternary expressions for simple fallback values.
- unicorn/prefer-node-protocol: Node built-in imports should be prefixed with the node: protocol (warning).
- unicorn/prefer-structured-clone: You must use structuredClone instead of JSON serialization or manual cloning helpers.
- unicorn/prefer-at: You must use the .at() method for relative indexing instead of length arithmetic.
- unicorn/prefer-string-replace-all: You must use replaceAll instead of replace with a global regular expression.
- unicorn/prefer-date-now: You must use Date.now() instead of new Date().getTime().
- de-morgan/no-negated-conjunction: You must simplify negated conjunctions !(A && B) to !A || !B using De Morgan's laws.
- de-morgan/no-negated-disjunction: You must simplify negated disjunctions !(A || B) to !A && !B using De Morgan's laws.
- barrel-files/avoid-re-export-all: You must not export wildcards like export * from.
- barrel-files/avoid-barrel-files: You must avoid barrel files with multiple re-exports (threshold: >1 export).
- react-you-might-not-need-an-effect/no-derived-state: You must calculate derived state during render instead of inside an effect.
- react-you-might-not-need-an-effect/no-chain-state-updates: You must not chain state updates across multiple effects.
- react-you-might-not-need-an-effect/no-adjust-state-on-prop-change: You must not reset state inside an effect when props change.
- react/jsx-key: When you render items in an array, you must assign a unique key prop to each element.
- react/no-array-index-key: When you render items in an array, you must not use array index numbers as keys.
- react/no-unstable-nested-components: You must not define component functions inside other component render functions.
- react/jsx-no-constructed-context-values: You must not pass newly constructed object or array literals to context value props without memoization.
- react/no-danger-with-children: You must not supply children when you set dangerouslySetInnerHTML.
- react/void-dom-elements-no-children: You must not pass children to void DOM tags such as input or image tags.
- react/no-direct-mutation-state: You must not mutate component state directly.
- react/jsx-no-useless-fragment: You must not wrap single children in redundant JSX fragments.
- react-hooks/rules-of-hooks: You must call React hooks only at the top level of component functions without conditional branches.
- react-hooks/exhaustive-deps: You must declare all referenced reactive values in hook dependency arrays.
- react-hooks/immutability: You must not mutate objects or arrays stored in component state or props.
- react-hooks/purity: Component render functions must not trigger side effects or change external variables during render.
- react-hooks/set-state-in-render: You must not call state setter functions during component render execution.
- react-perf/jsx-no-new-object-as-prop: You must not pass inline object literals into JSX attributes (native HTML style attributes and simple flat parameter wrappers inside useMemo/useCallback are permitted; complicated objects with calculations, template strings, nesting, or > 4 properties must be extracted).
- react-perf/jsx-no-new-array-as-prop: You must not pass inline array literals into JSX attributes.
- react-perf/jsx-no-new-function-as-prop: You must not pass inline arrow functions into JSX attributes.
- react-refresh/only-export-components: In component files, you must only export React components and constants.
- @eslint-react/web-api-no-leaked-timeout: When you create a timer in an effect, you must clear the timer in the effect cleanup function.
- @eslint-react/web-api-no-leaked-interval: When you create a recurring interval in an effect, you must clear the interval in the effect cleanup function.
- @eslint-react/web-api-no-leaked-event-listener: When you register a DOM event listener in an effect, you must remove the listener in the effect cleanup function.
- @eslint-react/dom-no-dangerously-set-innerhtml-with-children: You must not combine dangerouslySetInnerHTML with element children.
- @eslint-react/dom-no-void-elements-with-children: Void DOM elements must not contain children.
- jsx-a11y/alt-text: Elements that render images must provide alternative text.
- jsx-a11y/aria-role: ARIA roles on JSX elements must be valid.
- vitest/no-conditional-in-test: Tests must not contain conditional control flow statements.
- vitest/no-conditional-expect: Tests must not execute expect statements inside conditional branches or switch statements.
- vitest/no-identical-title: Test cases must not share identical titles.
- vitest/no-standalone-expect: Assertions must reside inside a test block.
- vitest/valid-expect: Test assertions must call valid matchers.
- vitest/valid-title: Test cases and suites must declare valid, non-empty, and properly formatted titles.
- vitest/prefer-called-with: Mock call assertions must assert the arguments that the mock received.
- vitest/prefer-to-have-length: Assertions must test array length with toHaveLength.
- @stylistic/padding-line-between-statements: You must separate return statements from preceding statements with an empty line.
- vitest/padding-around-all: You must place blank lines around test blocks, suites, hooks, and assertion groups.
- testing-library/no-node-access: Tests must not traverse the DOM tree directly with node properties.
- testing-library/no-container: Tests must not query elements directly through the container element.
- testing-library/prefer-screen-queries: Tests must query elements through screen instead of destructured container methods.
- testing-library/prefer-presence-queries: Tests must use presence queries to verify element existence.
- testing-library/await-async-queries: You must await asynchronous queries such as findBy.
- testing-library/await-async-utils: You must await asynchronous utilities such as waitFor.
- testing-library/no-await-sync-queries: You must not await synchronous queries such as getBy.
- testing-library/no-unnecessary-act: Tests must not wrap operations in redundant act calls.
- test-smells/redundant-print: Tests must not contain console print statements.
- test-smells/sleepy-test: Tests must not use setTimeout to delay test execution.
- jsdoc/check-alignment: Asterisks in JSDoc comment blocks must align properly.
- jsdoc/check-param-names: Parameter names in @param tags must match function arguments.
- jsdoc/check-property-names: Property names in @property tags must be valid.
- jsdoc/check-tag-names: JSDoc tags must use valid tag names.
- jsdoc/no-bad-blocks: Multi-line block comments with tags must begin with two asterisks.
- jsdoc/require-asterisk-prefix: Each line in a JSDoc comment block must begin with an asterisk.
- comment-discipline/no-syntax-restatement: Comments must not merely restate function/component names, parameter names, or type signatures without domain context.
- comment-discipline/no-comment-ratio-inflation: Comments must not be disproportionately longer than the attached short implementation function.
- comment-discipline/no-essay-comments: Code comments must not contain multi-paragraph architectural essays, benchmark debates, or alternative implementation justifications; move these to PR descriptions or ADRs.

### Layer Boundaries

The boundaries check prevents architectural leaks between code layers:

- boundaries/layer-boundary-violation: Services and stores must not import components, pages, or hooks.
- boundaries/util-boundary-violation: Utilities must not import services or stores.
- boundaries/mock-leakage: Production source files must not import test mocks or mock libraries.


### Fractal Architecture

The fractal check enforces Fractal Architecture Framework (FAF) and Domain-Fractal React Architecture (DFRA) invariants to ensure component encapsulation, repeatable self-similarity, and clean dependency flow:

- fractal/no-direct-fragment-import: External modules must import from a fragment's public access node (index or root barrel) rather than reaching into its private internal implementation files (components, hooks, models, styles, slices).
- fractal/no-private-leak: Private fractal sub-domains and branches (directories prefixed with `@` or `__`) are encapsulated and strictly private to their owning parent component; external files outside the parent scope must not import from them.
- fractal/no-upward-dependency: Sub-components inside private fractal branches must not import from their parent container or ancestor components; dependencies must flow strictly downward.
- fractal/peer-isolation: Sibling sub-components within the same private fractal branch must remain isolated from each other rather than establishing lateral cross-dependencies.

For architectural concepts, invariants, and remediation patterns, see the [Fractal Architecture Guide](documentation/fractal-architecture.md).
### Codebase Scars

The scars check catches recurring arithmetic bugs:

- scars/double-rounding: Services and computation layers must not combine Math.round or toFixed across sequential operations.
- scars/no-trivial-object-wrapper: You must not extract functions whose sole purpose is packing parameters into an object literal without logic or computation.
- scars/no-async-array-callback: You must not pass async callbacks to forEach or filter, or unhandled to map/reduce without Promise.all.
- scars/no-pass-through-class: You must not define middleman classes that merely delegate all methods to an injected dependency without business logic.
- scars/no-single-impl-interface: You must not declare speculative non-exported interfaces implemented by only a single local class.

### Hollow and Slop Tests

The hollow-tests check detects tests that execute without asserting behavior:

- hollow-tests/hollow-assertion: Tests must not call toHaveBeenCalled without arguments, and must not assert bare existence through toBeDefined or toBeTruthy.
- hollow-tests/tautological-assertion: Tests must not compare an expression to itself like expect(x).toBe(x).
- hollow-tests/no-logic-in-test: Tests must not wrap assertions in loops, switch statements, or conditional branches.
- hollow-tests/no-loop-in-test: You must not use loops in test bodies, even for test setup. Tests should be straight-line and declarative.
- hollow-tests/no-assertion-calculation: Test assertions must not contain inline arithmetic calculations.
- hollow-tests/static-sleep: Tests must not call fixed timers like sleep, waitForTimeout, or wait.
- hollow-tests/focused-test: Tests must not commit focused runs like it.only or describe.only (enforced across unit, integration, and Cypress/E2E spec files).
- hollow-tests/empty-test: Tests must contain executable assertion statements (supports expect, assert, and Cypress .should()/.and() assertion chains).
- hollow-tests/duplicate-each-case: Parameterized test tables must not contain duplicate test cases or identical data rows.
- hollow-tests/dead-each-parameter: Parameterized test callbacks must reference all declared parameters in the test body.
- hollow-tests/over-parameterized-test: Parameterized test tables must not exceed 15 cases; use equivalence class boundary partitioning or property-based testing (fast-check) instead.
- hollow-tests/test-fixture-scope: Large static test fixtures (>5 array items or >7 object properties) must be declared outside the test scope (module-level or dedicated mock/fixture files) to prevent test body clutter.
- hollow-tests/duplicate-test-body: Test cases in the same suite or scope must not duplicate another test body with identical assertions and logic under a different title.

### Test Hygiene

The test-hygiene check ensures test suites remain maintainable and free of ambiguous literals:

- test-hygiene/no-magic-float-assertions: Tests must not use raw unassigned floating-point literals in assertions; assign to named constants or compute from test parameters.
- test-hygiene/no-raw-timer-literals: Tests must not pass raw numeric millisecond literals to timer controls like vi.advanceTimersByTime, setTimeout, or waitFor; assign wait durations to descriptive constants (e.g. SCROLL_DEBOUNCE_WAIT_MS).
- test-hygiene/no-raw-coordinate-literals: Tests must not use raw unassigned integers (> 1000) for coordinates, scroll offsets, or element dimensions; assign to descriptive constants (e.g. NEXT_DAY_SCROLL_OFFSET_PX).

### Stale Mocks

The stale-mocks check prevents test doubles from diverging from production contracts:

- stale-mocks/stale-mock-export: Mock declarations created with vi.mock must match actual exported symbols of the mocked module.

### Code Duplication

The jscpd check prevents duplicate business logic:

- jscpd/duplicate-code: Source files must not repeat identical code blocks across files.

### Dead Code

The dead-code check prevents unused files and dead exports from accumulating:

- dead-code/unused-export: Files in the target set must not export values that no other file imports.
- dead-code/unused-file: Source files in the target set must be imported by at least one other file.

### Mutation Testing

The mutation-test check evaluates test veracity by introducing synthetic faults into code:

- mutation-test/survived-mutant: Tests must fail when Stryker introduces a bug into production code.
- mutation-test/no-coverage: Production code must have test coverage so mutants cannot escape execution.
- mutation-test/stryker-scope-too-broad: Mutation runs abort when target files exceed the safety guard (`MAX_MUTATION_FILES = 8`) to prevent accidental unbounded workspace mutation runs.

#### Vitest Mutation Runner Optimization

anti-slop uses `@stryker-mutator/vitest-runner` with `coverageAnalysis: "perTest"`:
- Automated mutant-to-test mapping: Executes only the specific tests that cover each mutated statement.
- Incremental caching: Stores evaluated mutants in `reports/mutation/stryker-incremental.json`.
- Configurable file limits: `--max-mutation-files <n>` (default: 8) protects against CPU starvation on broad PR diffs.
#### Scope Safety Guard

Mutation testing is computationally intensive. To prevent accidental unbounded workspace runs, anti-slop enforces a scope guard:
- The runner limits mutation analysis to a maximum of 8 files (`MAX_MUTATION_FILES = 8`).
- If target files exceed 8, the check aborts with `mutation-test/stryker-scope-too-broad`.
- Scope your runs with explicit file paths or revision ranges like `--since origin/main`.

#### Quality Baseline

Deterministic AST checks in anti-slop must maintain a minimum 80% mutation score baseline. Test suites must kill at least 80% of generated mutants to eliminate hollow tests and protect against logic regressions.

For detailed concepts, metrics, and remediation workflows, see the [Mutation Testing Guide](documentation/mutation-testing.md).

### CRAP Metric (Change Risk Anti-Pattern)

The crap-metric check evaluates change risk by combining cyclomatic complexity with test coverage:

$$\text{CRAP}(m) = \text{CC}(m)^2 \times (1 - \text{cov}(m))^3 + \text{CC}(m)$$

- crap-metric/high-crap-risk: Functions must not exceed the CRAP risk threshold (default: 30). Code that is both complex and under-tested represents a high-risk change anti-pattern.
- crap-metric/crap-coverage-missing: Test coverage data should be available for accurate risk scoring.

For the mathematical breakdown, risk thresholds, and remediation strategies, see the [CRAP Metric Guide](documentation/crap-metric.md).

### PR Size Review Gate

The pr-size check inspects git diffs against a base branch to enforce manageable code review sizes based on empirical research (SmartBear/Cisco, Google Small CLs):

- max-pr-size: Pull requests must not exceed review size thresholds (warning: > 200 review lines or > 10 files; error: > 500 review lines or > 25 files).

Review burden lines are calculated as:

$$\text{Review Lines} = \text{Additions} + \min(\text{Deletions}, \text{Additions})$$

Pure deletions of dead code do not inflate the review burden score. Lockfiles, snapshots, minified bundles, test fixtures, and generated artifacts are excluded by default.

### LLM Judge (Experimental, Library Only)

anti-slop provides an optional, blinded semantic judge via `reviewWithJudge(...)` in the TypeScript API. This check is strictly opt-in and off by default. It is not exposed through CLI flags or automated CI runs.

#### Purpose and Rubric

The judge targets a single semantic failure mode: `unnecessary_under_invariant`. This flags newly added defensive checks, fallbacks, or redundant guards that visible type contracts, callers, or earlier guards in the changed files already rule out.

- **FLAG**: The code is redundant under an invariant visible in the diff or provided files.
- **ALLOW**: The check occurs at a real trust boundary (for example, parsing external input, untyped JavaScript, or unknown data).
- **ABSTAIN (NEEDS_HUMAN_ATTENTION)**: The invariant would live only outside the provided files. The judge never guesses unseen code.

Judge findings are opinions and never alter deterministic `runAntiSlop` results.

#### Data Sent to the Remote Provider

The caller explicitly provides the base URL, API key, and model name. The library reads no environment variables and stores no network endpoints.

Before transmitting prompts to the remote provider:
- **Sensitive Files Dropped**: Files matching `.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, and SSH keys (`id_rsa*`) are completely dropped.
- **Secret Redaction**: Common secret token formats (AWS keys, GitHub tokens, API keys starting with `sk-`, JWTs, Bearer headers, PEM blocks) and high-entropy string assignments to variables containing key, secret, token, or password are masked with `[REDACTED]`.
- **Blinded Evaluation**: Only the redacted git diff and redacted file contents are sent. Deterministic findings, labels, and rule results are never included in the prompt.

#### Abstain Reasons

The judge never throws for network or model failures. Instead, it returns an `ABSTAIN` disposition with one of the following reasons:
- `NEEDS_HUMAN_ATTENTION`: The changed code cannot be verified with the provided files alone.
- `TOKEN_CEILING`: The input prompt exceeds the configured token ceiling (default: 12000 estimated tokens). The remote provider is not called.
- `TIMEOUT`: The provider failed to respond within the configured timeout (default: 25000 ms).
- `NETWORK_ERROR`: Network connectivity failed or connection was refused.
- `PROVIDER_ERROR`: The provider returned an HTTP error status (such as 5xx) or an invalid response payload.
- `MALFORMED_OUTPUT`: The model response violated the required JSON schema, reported findings for files not in the input, or reported inconsistent dispositions.

## Continuous Integration & Merge Queue

anti-slop uses GitHub Actions to enforce strict quality gates on pull requests and automated releases. To prevent race conditions, broken `main` commits, and parallel release conflicts, the repository supports **GitHub Merge Queue** via the `merge_group` workflow trigger.

### Enabling GitHub Merge Queue

1. In repository settings, navigate to **Settings $\rightarrow$ Rules $\rightarrow$ Rulesets** (or **Branches $\rightarrow$ Branch protection rules**) for `main`.
2. Check **Require merge queue**.
3. Select **Squash and merge** as the merge method.
4. Add **`Gates Pass`** to the required status checks list.
5. Set build concurrency (1–2 concurrent batches) and a status check timeout (30 minutes).
6. Once approved, pull requests are enqueued and tested against speculative queue branches (`gh-readonly-queue/main/pr-...`) before landing on `main`.

For detailed architecture, gate topology, and release automation, see the [CI/CD Guide](documentation/ci-cd.md).
