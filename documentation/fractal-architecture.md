# Fractal Architecture in anti-slop

Fractal Architecture enforces strict structural boundaries, self-similarity, and encapsulation across nested modules.
Inspired by the **Fractal Architecture Framework (FAF)** and **Domain-Fractal React Architecture (DFRA)**, this check guarantees that components remain cleanly decoupled, self-contained, and composed hierarchically without hidden lateral or upward dependencies.

anti-slop executes fractal architectural validation as part of its core check pipeline:
```bash
anti-slop --since origin/main
```

---

## 1. Basic Knowledge and Invariants

### What is Fractal Architecture?

In conventional flat or layer-based architectures, modules at deep nesting levels frequently reach across arbitrary boundaries, creating tight coupling, circular imports, and brittle refactoring boundaries.

**Fractal Architecture** solves this by applying recursive self-similarity:
1. Every component or domain boundary behaves like a miniature system with its own public interface and private internal structure.
2. The rules governing how top-level modules interact apply identically at every sub-level of nesting.
3. Complex components decompose into scoped private sub-domains without exposing internal implementation details to the outside world.

```
src/widgets/sidebar/
├── index.ts                     <-- Public Access Node (exported interface)
├── sidebar.component.tsx        <-- Main Container
├── @Sidebar/                    <-- Private Fractal Branch (encapsulated)
│   ├── nav-item/                <-- Sub-component A
│   │   ├── nav-item.component.tsx
│   │   └── nav-item.style.ts
│   └── user-profile/            <-- Sub-component B (Peer to A)
│       ├── user-profile.component.tsx
│       └── user-profile.hook.ts
└── __shared/                    <-- Shared Branch (for sibling reuse)
    └── sidebar.types.ts
```

### The Four Architectural Invariants

Fractal Architecture establishes four fundamental invariants:

```
                     ┌─────────────────────────────────────────┐
                     │          Parent / Outside World         │
                     └──────┬───────────────────────────▲──────┘
                            │                           │
                   Access Node │ (Rule 1)         Upward Dep │ (Rule 3)
                   Encapsulation│                  Forbidden   │
                            ▼                           │
                     ┌──────────────────────────────────┴──────┐
                     │      Owning Component (Container)       │
                     ├─────────────────────────────────────────┤
                     │  Private Branch (@Scope or __scope)     │
                     │                                         │
                     │   ┌─────────────┐     Peer     ┌──────┐ │
                     │   │   Sub-A     │ ◄-- - - - -► │Sub-B │ │
                     │   └─────────────┘  Isolation   └──────┘ │
                     │                      (Rule 4)           │
                     └─────────────────────────────────────────┘
                                       ▲
                                       │ Private Leak Forbidden (Rule 2)
                                       │
                              [External Component]
```

1. **Access Node Encapsulation**:
   External modules may only consume a fragment through its public access node (`index.ts` or root barrel). They must never bypass this barrier to import internal implementation files directly.

2. **Private Branch Encapsulation**:
   Directories designated as private branches (prefixed with `@` or `__`, e.g., `@Sidebar` or `__scope`) belong exclusively to their owning parent component. External components outside that parent scope must not reach inside.

3. **Unidirectional Dependency Flow**:
   Dependencies must flow strictly downward. Sub-components residing inside private branches compose into the parent container; they must never import their parent or ancestor containers.

4. **Law of Separation Between Peers**:
   Sibling sub-components within the same private branch must remain isolated from each other. Lateral dependencies between peers are forbidden. Shared logic must be hoisted to a shared branch (e.g., `__shared`) or passed through parent props/context.

---

## 2. Why We Add It and What We Expect to Catch

### Why We Add Fractal Architecture Checks

As React and TypeScript codebases scale, architectural erosion occurs gradually:
- **Refactoring Paralysis**: Changing an internal helper or component style unexpectedly breaks an unrelated feature because an external file deep-imported an internal file.
- **Circular Dependency Spaghetti**: When sub-components import their parent containers, circular references and runtime `undefined` import errors inevitably follow.
- **Tangled Peer Coupling**: Sibling sub-components start sharing internal state or hooks laterally, preventing either from being reused, tested, or deleted in isolation.

The fractal architecture check provides an **automated, deterministic boundary gate**:
1. **Guarantees Safe Refactoring**: Developers can freely rename or redesign internal fragment files knowing external consumers only depend on `index.ts`.
2. **Enforces Composition over Spaghetti**: Forces parent components to orchestrate children rather than allowing children to tightly bind to parents.
3. **Preserves Modular Deletion**: Encapsulated sub-domains can be removed or moved cleanly without hunting for phantom cross-imports across the codebase.

### What Do We Expect to Catch?

anti-slop catches four distinct architectural violations:

1. **Deep Fragment Ingestion**:
   Importing internal hooks (`useAuth.hook.ts`), models (`user.model.ts`), or styles (`button.style.ts`) directly from outside a feature module.
2. **Private Branch Leaks**:
   An external page or widget importing from another widget's private `@Scope` or `__scope` folder.
3. **Upward Ancestor Coupling**:
   A nested list item component importing the container list component or its root file.
4. **Lateral Peer Dependencies**:
   A modal header component directly importing from a sibling modal footer component inside the same private modal branch.

---

## 3. Rules and Findings Explained

### 1. `fractal/no-direct-fragment-import` (Severity: `error`)
- **What it means**: An external module imported an internal file of a fragment rather than importing through the fragment's public access node (`index.ts`).
- **Internal file indicators**:
  - Role suffixes: `.component`, `.hook`, `.model`, `.style`, `.util`, `.view`, `.controller`, `.presenter`, `.slice`, `.service`, `.store`, `.type`, `.schema`, `.boundary`, `.recipe`, `.instance`, `.factory`.
  - Internal directory paths: `components/`, `widgets/`, `pages/`, `features/`, `domains/`, or `modules/` followed by subfolders such as `model/`, `hooks/`, `components/`, `internal/`, `utils/`, `views/`, `styles/`, `slices/`, `stores/`, or `state/`.
- **Invariant**: *Access Node Encapsulation*.
- **Example finding**:
  ```
  src/pages/dashboard/dashboard.component.tsx
    12:1  error  External module (src/pages/dashboard/dashboard.component.tsx) imports internal fragment file '../user-profile/user-profile.hook.js'. Cross-fragment imports must consume through the public access node (index).  (fractal/no-direct-fragment-import)
      │      import { useUserProfile } from "../user-profile/user-profile.hook.js";
      ↳ fix: Import through the Fragment's root access node (e.g. 'src/pages/user-profile') instead of referencing internal files directly.
  ```

### 2. `fractal/no-private-leak` (Severity: `error`)
- **What it means**: A file outside the owning scope imported a file located in a private fractal branch (prefixed with `@` or `__`).
- **Invariant**: *Private Branch Encapsulation*.
- **Example finding**:
  ```
  src/pages/settings/settings.component.tsx
    8:1  error  File (src/pages/settings/settings.component.tsx) leaks private fractal branch '@DesktopSidebar' from '../../widgets/desktop-sidebar/@DesktopSidebar/nav-item.js'. Private branches are encapsulated within their parent scope.  (fractal/no-private-leak)
      │      import { NavItem } from "../../widgets/desktop-sidebar/@DesktopSidebar/nav-item.js";
      ↳ fix: Promote shared functionality to an ancestor shared branch (e.g. __shared) or import through the parent component's public interface.
  ```

### 3. `fractal/no-upward-dependency` (Severity: `error`)
- **What it means**: A nested sub-component inside a private branch (`@Scope` or `__scope`) imported its parent container or ancestor module.
- **Invariant**: *Unidirectional Dependency Flow*.
- **Example finding**:
  ```
  src/widgets/sidebar/@Sidebar/nav-item/nav-item.component.tsx
    5:1  error  Sub-component (src/widgets/sidebar/@Sidebar/nav-item/nav-item.component.tsx) imports ancestor component '../../sidebar.component.js'. Dependencies in fractal architecture must flow downward.  (fractal/no-upward-dependency)
      │      import { SidebarContext } from "../../sidebar.component.js";
      ↳ fix: Pass required data down via props, context, or hoist common state to a shared model/store.
  ```

### 4. `fractal/peer-isolation` (Severity: `error`)
- **What it means**: Sibling sub-components within the same private branch imported from each other laterally.
- **Invariant**: *Law of Separation Between Peers*.
- **Example finding**:
  ```
  src/widgets/sidebar/@Sidebar/header/header.component.tsx
    6:1  error  Peer sub-component (src/widgets/sidebar/@Sidebar/header/header.component.tsx) directly imports sibling peer '../footer/footer.component.js'. Sibling sub-components must remain isolated.  (fractal/peer-isolation)
      │      import { FooterButton } from "../footer/footer.component.js";
      ↳ fix: Extract shared logic into a shared module under '__shared' or pass it through the parent component.
  ```

---

## 4. What is Important to Check and Next Steps

When anti-slop reports a fractal architecture error, apply the corresponding architectural refactoring pattern:

```
                            Fractal Violation
                                    │
       ┌────────────────────────────┼────────────────────────────┐
       ▼                            ▼                            ▼
Direct Fragment Import         Upward Dependency           Peer Coupling
       │                            │                            │
Export through index.ts     Invert Control via Props    Extract to __shared/
(Public API Barrel)         or Hoist to Root State       or pass via Parent
```

### Remediation Strategies

#### 1. Fixing Direct Fragment Imports (`no-direct-fragment-import`)
- Check whether the imported symbol is meant to be part of the fragment's public contract.
- If **yes**: Re-export the symbol from the fragment's `index.ts` file and change the consumer import to reference the fragment root.
- If **no**: The consumer is improperly relying on internal details. Move the consumer inside the fragment, or extract common abstractions to a shared domain.

#### 2. Fixing Private Branch Leaks (`no-private-leak`)
- If an external component needs a piece of a private branch (`@Scope` or `__scope`), that piece is no longer private.
- **Promote**: Move the sub-component up into a shared component directory (e.g. `src/components/` or `__shared/`).
- **Or Export**: Expose a clean, public wrapper component or prop from the parent's `index.ts`.

#### 3. Fixing Upward Dependencies (`no-upward-dependency`)
- If a child needs state or handlers from the parent container:
  - **Props & Callbacks**: Pass values and callbacks (`onClick`, `isOpen`) down explicitly.
  - **Inverted State**: Hoist shared state to a separate store or slice under `model/` or `__shared/`.
  - **Context**: Create a scoped context provider defined in a separate file (e.g. `sidebar.context.ts`) that does not import the container component.

#### 4. Fixing Peer Isolation Violations (`peer-isolation`)
- When sibling `A` and sibling `B` need each other:
  - **Hoist Common Logic**: Move shared utilities, types, or sub-primitives into a sibling `__shared/` or `shared/` directory within the branch.
  - **Orchestrate in Parent**: Have the parent component compose both siblings and manage communication between them.

---

## 5. Usage in anti-slop

Run fractal architecture checks locally against changed files:
```bash
anti-slop --since origin/main
```

Run against a specific directory or fixture:
```bash
anti-slop src/components/
```

Output machine-readable JSON for CI/CD pipelines:
```bash
anti-slop --json > audit.json
```

Exempt test files:
Test files (`*.test.ts`, `*.spec.tsx`, `*.stories.tsx`, `__tests__`, etc.) are automatically exempt from architectural checks so tests can inspect and exercise private internals directly.

---

## 6. Further Readings

- **Fractal Architecture Framework (FAF)**: Formal specifications and principles for self-similar UI engineering.
- **Domain-Fractal React Architecture (DFRA)**: Component encapsulation, role suffixes, and unidirectional state patterns.
- **Martin Fowler**: *Bounded Context* and *Package Principles*. Principles of component cohesion and coupling metrics (Acyclic Dependencies Principle, Stable Abstractions Principle).
- **Uncle Bob (Robert C. Martin)**: *Clean Architecture: A Craftsman's Guide to Software Structure and Design*. Chapter on component encapsulation and dependency inversion.
