# Mutation Testing in anti-slop

Mutation testing is a fault-injection technique that measures the quality and veracity of your test suite.
Rather than asking "Did the tests execute this line of code?" (traditional code coverage), mutation testing asks: **"If a bug is introduced into this line of code, will any test fail?"**

anti-slop integrates [Stryker Mutator](https://stryker-mutator.io/) through the `--mutation` flag to run mutation testing automatically against changed files.

---

## 1. Basic Knowledge and Concepts

### What is Mutation Testing?

Mutation testing introduces deliberate synthetic defects—called **mutants**—into your production code.
After creating a mutant in an Abstract Syntax Tree (AST), the runner executes your test suite against the modified code.

- If at least one test **fails**, the mutant is **killed**. This is the desired outcome: your test suite detected the defect.
- If all tests **pass**, the mutant **survived**. This indicates a test deficiency: your production code changed, but no assertion noticed the regression.

```
                  ┌──────────────────────┐
                  │   Production Code    │
                  └──────────┬───────────┘
                             │
                      Mutate AST Node
                   (e.g., '>' to '>=')
                             │
                             ▼
                  ┌──────────────────────┐
                  │    Mutant Created    │
                  └──────────┬───────────┘
                             │
                     Run Test Suite
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
   Test fails (Red)                  All tests pass (Green)
            │                                 │
     Mutant Killed                    Mutant Survived
  (Test verified code)              (Gap in assertions)
```

### Mutation Testing vs. Traditional Code Coverage

Standard line or branch coverage is an execution metric, not a quality metric:
- **Code Coverage**: Proves that a test ran through a specific line or branch. A test with zero assertions can achieve 100% line coverage.
- **Mutation Testing**: Proves that your assertions actively verify the behavior and invariants of that line. If modifying the logic does not cause a failure, the test is hollow.

### The Mutant Lifecycle

When Stryker executes in anti-slop, each mutant lands in one of several states:

| Status | Meaning | anti-slop Impact |
|---|---|---|
| **Killed** | A test failed when the mutant was active. The test verified the behavior. | Passes cleanly. |
| **Survived** | All tests passed despite the deliberate defect. | Emitted as an **error** (`mutation-test/surviving-mutant`). |
| **No Coverage** | No test executed the mutated line during test runs. | Emitted as a **warning** (`mutation-test/uncovered-mutant`). |
| **Timeout** | The mutant triggered an infinite loop or stalled execution. | Counted as caught / killed. |
| **Compile Error** | The mutant resulted in invalid TypeScript / syntax. | Discarded automatically by Stryker. |

---

## 2. Why We Add It and What We Expect to Catch

### Why We Add Mutation Testing

Modern codebases often suffer from **test slop** and **coverage theater**:
1. **Hollow Tests**: Tests that invoke functions, mock away dependencies, and assert only `expect(result).toBeDefined()` or `expect(service).toHaveBeenCalled()`.
2. **AI-Generated Test Hallucinations**: Automated agents and developers frequently write tests designed to turn CI green without asserting true invariants.
3. **Silent Regressions**: Refactorings that flip boundary comparisons or drop validation logic without breaking existing naive tests.

By adding mutation testing directly to the pre-review gate (`anti-slop --mutation --since origin/main`), anti-slop verifies that new and modified tests actually assert what they claim to test.

### What Benefits Are We Getting?

- **Verifiable Test Trustworthiness**: High confidence that passing tests reflect working software.
- **Focused Scope**: anti-slop filters changed production files from `git diff`, keeping mutation analysis fast and relevant to the PR.
- **Less Dead Code**: Code that can be mutated in every possible way without failing any test is often dead or redundant code that should be deleted.
- **Assertion Completeness**: Forces tests to assert exact outputs, error messages, and state transitions.

### What Do We Expect to Catch?

anti-slop catches specific classes of bugs that slip past linting and traditional test coverage:

1. **Off-by-One and Boundary Defects**:
   ```ts
   // Original
   if (age >= 18) { grantAccess(); }
   // Mutant
   if (age > 18) { grantAccess(); }
   ```
   If no test checks `age === 18`, this mutant survives.

2. **Inverted Conditional Logic**:
   ```ts
   // Original
   if (user.isActive && !user.isBanned)
   // Mutant
   if (user.isActive && user.isBanned)
   ```
   If tests only cover the happy path (`isActive: true, isBanned: false`), the mutant survives.

3. **Fallback and Default Value Corruption**:
   ```ts
   // Original
   const timeout = options.timeout ?? 5000;
   // Mutant
   const timeout = options.timeout && 5000;
   ```
   If tests always supply `options.timeout`, the default value path is never verified.

4. **Empty Return / Missing Return Checks**:
   ```ts
   // Original
   return calculateTotal(items);
   // Mutant
   calculateTotal(items); return undefined;
   ```
   If the caller test only verifies that the function ran without throwing, the dropped return value goes undetected.

5. **Arithmetic Inversions**:
   ```ts
   // Original
   const balance = previousBalance - fee;
   // Mutant
   const balance = previousBalance + fee;
   ```

---

## 3. Metrics and Findings Explained

### The Mutation Score

The primary metric of mutation testing is the **Mutation Score Indicator (MSI)**:

$$\text{Mutation Score} = \frac{\text{Killed Mutants} + \text{Timed Out Mutants}}{\text{Total Mutants}} \times 100\%$$

- **80% - 100%**: High veracity. The test suite strictly validates business logic.
- **60% - 80%**: Moderate veracity. Some edge cases and fallback branches are unasserted.
- **< 60%**: Low veracity. High risk of false confidence and undetected regressions.

### anti-slop Rules and Findings

anti-slop reports two distinct findings for mutation testing:

#### 1. `mutation-test/surviving-mutant` (Severity: `error`)
- **What it means**: Stryker modified a line of code, ran the test suite, and all tests passed.
- **Reported details**: File name, line, column, mutator name, and the replacement code.
- **Example output**:
  ```
  src/services/billing.ts
    42:15  error  Surviving mutant: EqualityOperator mutant survived ('!==')  (mutation-test/surviving-mutant)
      │        if (account.status === "ACTIVE") {
      ↳ fix: Add an assertion in your test suite that verifies this specific behavior or invariant.
  ```

#### 2. `mutation-test/uncovered-mutant` (Severity: `warning`)
- **What it means**: Stryker introduced a mutant in a line that was never reached by any test in the test suite.
- **Reported details**: File name, line, column, and mutator name.
- **Example output**:
  ```
  src/services/billing.ts
    88:5  warn  Uncovered mutant: BlockStatement has zero test coverage  (mutation-test/uncovered-mutant)
      │        handleSuspensionNotice(account);
      ↳ fix: Write tests covering this execution path.
  ```

### Common Mutators in Stryker

Stryker applies a standard set of mutation operators to TypeScript/JavaScript ASTs:

| Mutator | Description | Example Transformation |
|---|---|---|
| **EqualityOperator** | Inverts comparison operators | `===` $\to$ `!==`, `<` $\to$ `<=`, `>` $\to$ `>=` |
| **ArithmeticOperator** | Inverts arithmetic operators | `+` $\to$ `-`, `*` $\to$ `/`, `%` $\to$ `*` |
| **BooleanLiteral** | Inverts boolean values | `true` $\to$ `false`, `false` $\to$ `true` |
| **ConditionalExpression** | Replaces condition with boolean | `condition ? a : b` $\to$ `true ? a : b` |
| **LogicalOperator** | Inverts boolean logical operators | `&&` $\to$ `\|\|`, `\|\|` $\to$ `&&` |
| **BlockStatement** | Clears the body of a block | `{ doWork(); return true; }` $\to$ `{}` |
| **StringLiteral** | Empties or alters string literals | `"user"` $\to$ `""` |
| **ArrayDeclaration** | Empties array literals | `[1, 2, 3]` $\to$ `[]` |
| **UnaryOperator** | Inverts sign or negation | `!isValid` $\to$ `isValid`, `-x` $\to$ `+x` |
| **OptionalChaining** | Replaces optional chain with direct access | `a?.b` $\to$ `a.b` |

---

## 4. What is Important to Check and Next Steps

When anti-slop reports a surviving mutant, follow these concrete investigation steps:

### Step 1: Inspect the Mutated Code and Replacement
Look at the finding in the report:
- What was the original operator or expression?
- What was the replacement?
- Which file and line number were affected?

### Step 2: Check Existing Tests for the Function
Determine which test executes this code:
- Is there an existing test that executes the function?
- Does the test assert the output or side effects of this line? Or does it merely call the method and assert that nothing threw?

### Step 3: Differentiate Real Defects from Equivalent Mutants
In rare circumstances, a mutant produces code that is semantically identical to the original code despite having a different AST representation. This is called an **equivalent mutant**:
```ts
// Original
for (let i = 0; i < items.length; i++) { ... }
// Mutant
for (let i = 0; i != items.length; i++) { ... }
```
Because `i` increments by 1, `i < items.length` and `i != items.length` behave identically for non-empty arrays.
- If it is an equivalent mutant: Document why or rewrite the code to be clearer and less ambiguous.
- If it is not equivalent (95%+ of cases): Your test suite has a genuine blind spot.

### Step 4: Write the Missing Assertion
Add a targeted test or assertion that specifically differentiates the correct behavior from the mutated behavior:
- For boundary mutants (`<` vs `<=`), add a test case on the exact boundary value.
- For boolean/logical mutants, add a test case where the second condition alters the result.
- For return value mutants, assert the specific returned value, payload, or error.

### Step 5: Verify the Fix
Re-run anti-slop to verify that the mutant is killed:
```bash
anti-slop --mutation --since origin/main
```

---

## 5. Usage in anti-slop

Run mutation testing on files changed against `origin/main`:
```bash
anti-slop --mutation --since origin/main
```

Run mutation testing on staged files:
```bash
anti-slop --mutation --staged
```

Run mutation testing on a specific directory:
```bash
anti-slop --mutation src/services/
```

Combine mutation testing with CRAP metric analysis:
```bash
anti-slop --mutation --crap --since origin/main
```

Configure maximum mutable files threshold (default: 8):
```bash
anti-slop --mutation --max-mutation-files 8
```

### 5.0 Preflight Calculation & Capacity Estimator

Before launching heavy mutation runs, you can execute a preflight capacity calculation:

```bash
# Check diff scope, mutant volume, incremental cache status, and safe concurrency
pnpm run test:mutation:preflight --since origin/main

# Or via CLI flag
anti-slop --preflight --since origin/main
```

The preflight tool:
1. **Calculates mutant volume**: In-memory AST instrumentation counts exact mutants per file in milliseconds.
2. **Checks incremental cache**: Reuses `reports/mutation/stryker-incremental.json` to show how many mutants are cached vs pending.
3. **Calculates host safety & VSCode headroom**: Bounds concurrency to leave at least 2 CPU cores and 3.0 GB RAM unconsumed, preventing VSCode freezes or system lockups.
4. **Provides cold vs incremental runtime estimates**: Uses calibrated per-worker throughput to estimate execution time.
5. **Enforces scope guards**: Warns or fails (`--fail-on-broad`) when mutable files exceed limit.
### 5.1 Performance Optimization & Test Pruning

Following the engineering principles in *Stop Making Stryker Run Tests It Never Needed* (Arabuli, 2026), `anti-slop` implements practical performance guardrails to prevent mutation testing from becoming needlessly slow:

1. **Vitest Runner with Per-Test Coverage**: Uses `@stryker-mutator/vitest-runner` with `coverageAnalysis: "perTest"` to automatically execute only the specific unit tests that exercise each mutated statement. Slow E2E subprocess tests (`tests/e2e-*.test.ts`) are excluded from mutation analysis.
2. **Scope Safety Guard (`--max-mutation-files`)**: Protects against CPU starvation by bounding mutable production files to a sensible limit (default: 8).
3. **Incremental Execution (`incremental: true`)**: Prior mutant evaluation results are stored in `reports/mutation/stryker-incremental.json`. On subsequent runs, Stryker uses git-level diffing to rerun only mutants affected by changed source or test lines.
4. **Lean Sandbox Overhead (`ignorePatterns`)**: Directories such as `coverage/**`, `reports/**`, `documentation/**`, and `.git/**` are excluded during sandbox staging, eliminating heavy file-copy I/O.
5. **Command Runner Compatibility**: Command-based test runners use `coverageAnalysis: "off"` with static mutator support validated against Stryker's configuration rules, focusing execution speed on targeted unit test discovery.
6. **Calibrated Concurrency (`--mutation-concurrency`)**: Worker concurrency is dynamically bounded by available CPU cores and physical RAM (`1.5 GB` per worker), preventing process thrashing on resource-constrained CI agents.

---

## 6. Further Readings

- **Stryker Mutator Documentation**: [stryker-mutator.io/docs](https://stryker-mutator.io/docs/) — Comprehensive guide to configuration, supported mutators, and runner plugins.
- **Martin Fowler on Test Coverage**: [martinfowler.com/bliki/TestCoverage.html](https://martinfowler.com/bliki/TestCoverage.html) — Why coverage is useful to find untested code, but useless as a quality target without mutation analysis.
- **Mutation Testing Foundations**: DeMillo, R. A., Lipton, R. J., & Sayward, F. G. (1978). *Hints on Test Data Selection: Using the Fault History of Software*. IEEE Computer, 11(4), 34-41. (Introduced the "Coupling Effect" and "Competent Programmer Hypothesis").
- **Google Testing Blog**: [Mutation Testing](https://testing.googleblog.com/2021/05/mutation-testing.html) — How Google uses mutation testing at scale to evaluate test quality.
- **State of Mutation Testing**: Jia, Y., & Harman, M. (2011). *An Analysis and Survey of the Development of Mutation Testing*. IEEE Transactions on Software Engineering, 37(5), 649-678.
