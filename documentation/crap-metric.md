# CRAP Metric (Change Risk Anti-Pattern) in anti-slop

The **CRAP (Change Risk Anti-Pattern)** metric evaluates how risky a function or method is to modify.
It combines **Cyclomatic Complexity (CC)** with **automated test coverage** into a single risk score.

anti-slop provides automated CRAP analysis via `pnpm run test:crap` or the `--crap` flag:
```bash
pnpm run test:crap src/checks/strict-ts.ts
# or against PR changes:
anti-slop --crap --since origin/main
```

---

## 1. Basic Knowledge and Mathematical Formula

### What is the CRAP Metric?

The CRAP metric was introduced in 2007 by **Alberto Savoia** and **Bob Evans**.
The underlying insight is straightforward:

- High complexity is acceptable **if** you have extensive test coverage to protect against regressions.
- Low test coverage is acceptable **if** the code is trivial and simple (e.g., accessors, simple wiring).
- **High complexity combined with low test coverage is an anti-pattern**: it creates fragile code that is hazardous to modify, debug, or refactor.

### The Mathematical Formula

The CRAP score for a function or method $m$ is calculated as:

$$\text{CRAP}(m) = \text{CC}(m)^2 \times (1 - \text{cov}(m))^3 + \text{CC}(m)$$

Where:
- $\text{CC}(m)$ is the **Cyclomatic Complexity** of the function.
- $\text{cov}(m)$ is the test coverage expressed as a fraction between $0.0$ and $1.0$ ($0\% = 0.0$, $100\% = 1.0$).
- $(1 - \text{cov}(m))$ is the uncovered fraction of the function.

```
       ┌────────────────────────────────────────────────────────┐
       │   CRAP(m) = CC(m)² × (1 - cov(m))³ + CC(m)             │
       └──────┬──────────────────────┬─────────────┬────────────┘
              │                      │             │
      Quadratic Penalty        Cubic Reward   Base Complexity
     for high complexity        for testing    Floor of function
```

### Why Quadratic ($CC^2$) and Cubic ($(1 - cov)^3$)?

The exponents in the formula reflect empirical software engineering dynamics:

1. **Quadratic Complexity ($CC^2$)**:
   Each additional branch, nested condition, or loop increases the number of potential execution paths exponentially. A function with $CC = 10$ is not twice as risky as $CC = 5$; it is significantly more dangerous to touch.

2. **Cubic Test Coverage ($(1 - cov)^3$)**:
   The cubic exponent means that **every percent of test coverage added yields diminishing risk rapidly**. Writing tests for a complex function rapidly drives the $(1 - cov)^3$ penalty toward zero.

### Boundary Cases

To understand how CRAP behaves, examine the two extreme boundaries:

| Scenario | Coverage | Formula Simplification | Result | Interpretation |
|---|---|---|---|---|
| **Fully Covered** | $100\%$ ($\text{cov} = 1.0$) | $\text{CC}^2 \times (1 - 1.0)^3 + \text{CC} = \text{CC}$ | $\text{CRAP} = \text{CC}$ | With 100% coverage, CRAP score equals the Cyclomatic Complexity. |
| **Completely Uncovered** | $0\%$ ($\text{cov} = 0.0$) | $\text{CC}^2 \times (1 - 0.0)^3 + \text{CC} = \text{CC}^2 + \text{CC}$ | $\text{CRAP} = \text{CC}^2 + \text{CC}$ | Without tests, risk explodes quadratically with complexity. |

#### Numerical Examples:

- **Function A (Simple, no tests)**:
  $CC = 2$, $\text{cov} = 0\%$
  $$\text{CRAP} = 2^2 \times (1 - 0)^3 + 2 = 4 + 2 = 6$$ (Safe / Low Risk)

- **Function B (Complex, no tests)**:
  $CC = 10$, $\text{cov} = 0\%$
  $$\text{CRAP} = 10^2 \times (1 - 0)^3 + 10 = 100 + 10 = 110$$ (CRAP Anti-Pattern! Extreme Risk)

- **Function B with 50% test coverage**:
  $CC = 10$, $\text{cov} = 50\%$ ($0.5$)
  $$\text{CRAP} = 100 \times (0.5)^3 + 10 = 100 \times 0.125 + 10 = 12.5 + 10 = 22.5$$ (Moderate Risk)

- **Function B with 80% test coverage**:
  $CC = 10$, $\text{cov} = 80\%$ ($0.8$)
  $$\text{CRAP} = 100 \times (0.2)^3 + 10 = 100 \times 0.008 + 10 = 0.8 + 10 = 10.8$$ (Moderate / Low Risk)

- **Function B with 100% test coverage**:
  $CC = 10$, $\text{cov} = 100\%$ ($1.0$)
  $$\text{CRAP} = 100 \times 0 + 10 = 10$$ (Low Risk)

---

## 2. Why We Add It and What We Expect to Catch

### Why We Add CRAP Analysis

Code review is often subjective. Reviewers debate formatting, style, or personal preferences while missing deeply entangled methods that lack test protection.

The CRAP metric provides an **objective, quantitative gate**:
1. **Focuses Testing Effort Where It Matters Most**: You do not need 100% coverage on every single line in a codebase. CRAP mathematically identifies the specific methods where lack of coverage is dangerous.
2. **Guides Refactoring Decisions**: When a function fails the CRAP check, the developer has a clear choice: simplify the function, write unit tests for its branches, or both.
3. **Prevents Ticking Time Bombs**: Complex functions modified without tests in PRs are the leading source of production incidents.

### What Do We Expect to Catch?

anti-slop flags functions that exhibit the Change Risk Anti-Pattern:

1. **Runaway "God Functions"**:
   Functions that span 80+ lines, perform multiple tasks, contain nested `switch` or `if/else` ladders, and have zero or partial test coverage.
2. **Untested Complex State Machines**:
   Parsing or state-transition methods with dozens of branching conditions that are only exercised by happy-path integration tests.
3. **High-Churn Risky Changes**:
   Complex files being edited in the current branch without corresponding updates to the unit tests.
4. **False Sense of Security**:
   A file showing 70% overall file coverage might hide a single critical method that has 0% coverage and a Cyclomatic Complexity of 12.

---

## 3. Metrics and Findings Explained

### How anti-slop Calculates CRAP

anti-slop performs structural AST analysis using TypeScript compiler APIs:

1. **Function Extraction**:
   Identifies all function declarations, function expressions, arrow functions, and class methods.
2. **Cyclomatic Complexity (CC)**:
   Starts with a base complexity of 1, and increments by 1 for each decision point:
   - Branching statements: `if`, `for`, `for..in`, `for..of`, `while`, `do..while`, `case`, `catch`
   - Short-circuit boolean operators: `&&`, `||`, `??`
   - Conditional (ternary) expressions: `? :`
   - Optional chaining operators: `?.`
3. **Line Coverage Extraction**:
   Maps the function's start and end line numbers against LCOV coverage data (e.g., `coverage/lcov.info`). If existing coverage is absent, anti-slop automatically triggers the workspace test runner (`bun test --coverage`, `vitest run --coverage`, or `jest --coverage`) to collect fresh line coverage data.
4. **Score Calculation & Ranking**:
   Applies the CRAP formula and formats the findings.

### Risk Tiers and Thresholds

| CRAP Score | Risk Level | Description | anti-slop Action |
|---|---|---|---|
| **$\le 5$** | **Low** | Simple function or well-tested code. | Clean pass. |
| **$5 < \text{CRAP} \le 30$** | **Moderate** | Moderate complexity or partial coverage. | Accepted, reported in CRAP table. |
| **$> 30$** | **High (CRAP Anti-Pattern)** | Complex and under-tested. Fragile change hazard. | **Error** (`crap-metric/high-crap-risk`). |

> **Note on the Threshold (30)**:
> A CRAP score of 30 was empirically established by the authors of the metric as the boundary above which code is considered "crappy" (unacceptably high change risk).
> In anti-slop, you can configure a custom threshold using `--crap-threshold <number>`.

### anti-slop Rules and Findings

#### 1. `crap-metric/high-crap-risk` (Severity: `error`)
- **What it means**: A function's CRAP score exceeds the configured risk threshold (default: 30).
- **Reported details**: Function name, file path, line number, CRAP score, CC score, and line coverage percentage.
- **Example output**:
  ```
  src/services/order-processor.ts
    54:1  error  CRAP score 42.8 exceeds threshold 30 in 'processOrder' (CC: 8, Coverage: 35.0%)  (crap-metric/high-crap-risk)
      │      function processOrder(order: Order, options: ProcessOptions) {
      ↳ fix: Add unit tests to cover missing execution paths or refactor to reduce cyclomatic complexity.
  ```

#### 2. `crap-metric/crap-coverage-missing` (Severity: `warning`)
- **What it means**: No LCOV coverage file was found, and the test runner could not produce one automatically. anti-slop assumes 0% coverage to provide worst-case risk estimates.
- **Example output**:
  ```
  package.json
    1:1  warn  No test coverage report found; assuming 0% coverage for CRAP scoring.  (crap-metric/crap-coverage-missing)
  ```

### The Tabular CRAP Report

When running anti-slop with `--crap`, a summary table is generated:

```
## CRAP (Change Risk Anti-Pattern) Report

| Function | File | CC | Cov% | CRAP | Risk |
|---|---|---|---|---|---|
| `processOrder` | `src/services/order.ts` | 8 | 35.0% | 42.8 | **High** |
| `calculateTax` | `src/services/order.ts` | 5 | 80.0% | 5.2 | Moderate |
| `formatReceipt` | `src/services/receipt.ts` | 2 | 100.0% | 2.0 | Low |
```

---

## 4. What is Important to Check and Next Steps

When a function triggers a `crap-metric/high-crap-risk` error, you have two strategic levers to resolve it:

```
                      High CRAP Score
                      (CC high, Cov low)
                              │
             ┌────────────────┴────────────────┐
             ▼                                 ▼
         Lever 1:                          Lever 2:
     Increase Coverage                Reduce Complexity
  (Write targeted tests)           (Refactor function design)
```

### Remediation Strategies

#### Lever 1: Increase Test Coverage
If the function's complexity is necessary and cannot be easily reduced, write unit tests covering the missing execution branches:
- Review the LCOV or HTML coverage report to find uncovered lines.
- Write test cases targeting specific conditional branches (`if`, `switch` cases, exception paths).
- **Impact**: Because the formula cubes the uncovered fraction $(1 - cov)^3$, raising coverage from 30% to 80% reduces the risk factor by over 97%!

#### Lever 2: Reduce Cyclomatic Complexity (CC)
If writing tests for the function is painful, that is a symptom of excessive complexity. Refactor the code:
1. **Extract Smaller Functions**:
   Break the function into small, single-responsibility helper functions.
   *Example*: If a function with $CC = 12$ ($0\%$ coverage, $\text{CRAP} = 156$) is split into three functions each with $CC = 4$, their individual uncovered CRAP scores will be $4^2 + 4 = 20$, immediately dropping below the threshold of 30!
2. **Replace Nested Conditionals with Guard Clauses / Early Returns**:
   Flatten deep indentation.
3. **Replace Complex Conditionals with Polymorphism or Table Lookups**:
   Use a `Map` or record lookup instead of a massive `switch` statement.
4. **Eliminate Redundant Null Checks and Logic**:
   Take advantage of TypeScript's strict null checking rather than defensive branching.

### Concrete Next Steps for Engineers

1. **Run the CRAP check locally**:
   ```bash
   anti-slop --crap --since origin/main
   ```
2. **Inspect the failing function**:
   Note its Cyclomatic Complexity (CC) and Line Coverage (Cov%).
3. **Decide the remediation path**:
   - If $CC > 15$: Prioritize refactoring. High complexity is inherently bug-prone even if 100% tested.
   - If $CC \le 15$ and Cov% is low: Write unit tests covering the missing branches.
4. **Re-evaluate**:
   Run anti-slop again and confirm the CRAP score drops below 30.

---

## 5. Usage in anti-slop

Run CRAP analysis against changes compared to `origin/main`:
```bash
anti-slop --crap --since origin/main
```

Run CRAP analysis with a custom risk threshold (e.g., 25):
```bash
anti-slop --crap --crap-threshold 25 --since origin/main
```

Run CRAP analysis alongside mutation testing:
```bash
anti-slop --crap --mutation --since origin/main
```

Output machine-readable JSON including CRAP entries:
```bash
anti-slop --crap --json > audit.json
```

---

## 6. Further Readings

- **Alberto Savoia & Bob Evans (2007)**: *The CRAP Metric: Using Cyclomatic Complexity and Code Coverage to Predict Change Risk*. Original announcement and methodology.
- **Alberto Savoia's Blog Post**: [CRAP4J: A Change Risk Analysis and Predictions Tool for Java](http://www.artima.com/weblogs/viewpost.jsp?thread=210575)
- **Thomas J. McCabe (1976)**: *A Complexity Measure*. IEEE Transactions on Software Engineering, Vol. SE-2, No. 4. (The seminal paper establishing Cyclomatic Complexity).
- **Martin Fowler**: *Refactoring: Improving the Design of Existing Code* (2nd Edition, 2018). Practical strategies for reducing cyclomatic complexity in JavaScript/TypeScript.
- **Michael Feathers**: *Working Effectively with Legacy Code* (Prentice Hall). Techniques for adding test harnesses to untested complex code.
- **Robert C. Martin (Uncle Bob)**: *Clean Code: A Handbook of Agile Software Craftsmanship*. Discusses small functions, single responsibility, and test veracity.
