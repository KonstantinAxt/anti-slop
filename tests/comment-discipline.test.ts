import { describe, expect, it } from "bun:test";
import { checkWithEslint } from "../src/checks/eslint-runner.js";
import { checkHollowTests } from "../src/checks/hollow-tests.js";

describe("Comment Discipline and Hygiene", () => {
  describe("Anti-Inflation: Do not force JSDoc on clean TypeScript exports", () => {
    it("does NOT warn or error when an exported React component lacks JSDoc", async () => {
      const code = `
        import React from "react";
        interface EventCardProps {
          id: string;
          name: string;
        }

        export const EventCard: React.FC<EventCardProps> = ({ id, name }) => {
          return <div>{name} ({id})</div>;
        };
      `;

      const findings = await checkWithEslint("src/components/EventCard.tsx", code);
      const jsdocFindings = findings.filter((f) => f.rule === "jsdoc/require-jsdoc");

      expect(jsdocFindings).toHaveLength(0);
    });

    it("does NOT warn or error when an exported hook or helper lacks JSDoc", async () => {
      const code = `
        export function useActiveEventId(): string | undefined {
          return undefined;
        }
      `;

      const findings = await checkWithEslint("src/hooks/useActiveEventId.ts", code);
      const jsdocFindings = findings.filter((f) => f.rule === "jsdoc/require-jsdoc");

      expect(jsdocFindings).toHaveLength(0);
    });
  });

  describe("Trivial Syntax Restatements (comments that tell nothing the code does not)", () => {
    it("flags redundant JSDoc on EventCard that merely restates the component name and props", async () => {
      const code = `
        import React from "react";
        interface EventCardProps { item: unknown; }

        /**
         * Renders a single calendar event card with title and attendees.
         *
         * @param props - Component properties for EventCard.
         * @returns The rendered event card or null if required data is missing.
         */
        export const EventCard: React.FC<EventCardProps> = (props) => {
          return <div />;
        };
      `;

      const findings = await checkWithEslint("src/components/EventCard.tsx", code);
      const restatementFindings = findings.filter(
        (f) => f.rule === "comment-discipline/no-syntax-restatement"
      );

      expect(restatementFindings.length).toBeGreaterThan(0);
      expect(restatementFindings[0]?.message).toContain("restates");
    });

    it("flags redundant JSDoc on extractEventData that merely restates function name and return type", async () => {
      const code = `
        interface ItemFragment { id: string; }
        interface ExtractedData { id: string; }

        /**
         * Extracts normalized display and attendee data from an Event fragment.
         *
         * @param item - Event fragment payload.
         * @returns Extracted event properties and fragments.
         */
        export const extractEventData = (item: ItemFragment): ExtractedData => {
          return { id: item.id };
        };
      `;

      const findings = await checkWithEslint("src/utils/extractEventData.ts", code);
      const restatementFindings = findings.filter(
        (f) => f.rule === "comment-discipline/no-syntax-restatement"
      );

      expect(restatementFindings.length).toBeGreaterThan(0);
    });
  });

  describe("Comment-to-Code Ratio Inflation (comment longer than the code it describes)", () => {
    it("flags comments that are disproportionately longer than the attached short implementation", async () => {
      const code = `
        import { useAppSelector } from "./store";

        /**
         * Returns the selected event identifier while the detail panel is open.
         *
         * We read selectedEventId from Redux instead of getPanelRef().
         * The panel ref is mutable and does not notify React when the selected event changes in split view.
         * The Redux selector triggers a reactive re-render whenever the selected event changes.
         * We omit useMemo because useAppSelector already compares primitive values with strict equality.
         */
        export function useActiveEventId(): string | undefined {
          return useAppSelector((state) => state.selectedEventId);
        }
      `;

      const findings = await checkWithEslint("src/hooks/useActiveEventId.ts", code);
      const ratioFindings = findings.filter(
        (f) => f.rule === "comment-discipline/no-comment-ratio-inflation"
      );

      expect(ratioFindings.length).toBeGreaterThan(0);
      expect(ratioFindings[0]?.why).toContain("ratio");
    });
  });

  describe("Architectural Essays in Source Code (large design comments in source files)", () => {
    it("flags multi-paragraph design essays debating alternatives and benchmarks in source files", async () => {
      const code = `
        /**
         * Compares two rows by the only fields the virtualizer measures against: slot id and size.
         *
         * buildRowSlots reruns whenever any input changes, and several of those inputs are cosmetic
         * (accent colours, hover state, link target, typename), so a new array with byte-identical
         * geometry is the common case, and the point of this check is to skip the redundant measure().
         *
         * We compare instead of encoding the row into a string key or hash digest, because encoding is
         * strictly worse here on three counts:
         *
         * - Garbage: a key/digest has to materialise every id and size it folds in, roughly 1.6 KB of string
         *   per row, creating short-lived garbage per 300-row pass. Those allocations die
         *   immediately and buy nothing but GC pauses, which we cannot afford on low-end devices.
         *   Comparing reads the two arrays in place and allocates nothing.
         * - Exactness: a 32-bit digest is lossy. A collision means two different geometries look equal,
         *   we skip measure(), and rows keep stale widths, leading to a silent layout bug. Field comparison
         *   cannot produce a false match.
         * - Cost: encoding always walks every slot before it can answer. This exits on the first
         *   differing slot, and even in the all-equal worst case it measured ~40x faster than either a
         *   digest or JSON.stringify over the same 300 rows.
         */
        export const areSlotGeometriesEqual = (a: unknown[], b: unknown[]): boolean => {
          return a.length === b.length;
        };
      `;

      const findings = await checkWithEslint("src/utils/buildRowSlots.ts", code);
      const essayFindings = findings.filter(
        (f) => f.rule === "comment-discipline/no-essay-comments"
      );

      expect(essayFindings.length).toBeGreaterThan(0);
    });

    it("allows concise, actionable business logic and bug reference comments", async () => {
      const code = `
        // ABC-123: Clip overlapping events so the day view stays aligned
        export const getVisibleEndTime = (endTime: Date, nextStartTime: Date): Date => {
          return nextStartTime < endTime ? nextStartTime : endTime;
        };
      `;

      const findings = await checkWithEslint("src/utils/buildRowSlots.ts", code);
      const commentFindings = findings.filter((f) =>
        f.rule.startsWith("comment-discipline/")
      );

      expect(commentFindings).toHaveLength(0);
    });
  });

  describe("Test Fixture Scoping (large constants declared inside a test body)", () => {
    it("flags large static array fixtures declared directly inside test case bodies", async () => {
      const code = `
        import { describe, it, expect } from "vitest";

        describe("buildRowSlots", () => {
          it("calculates geometry across multiple boundary cases", () => {
            const geometryCases = [
              { description: "clipped before boundary (-30 min offset, 1 min duration)", duration: 1, offset: -30 },
              { description: "clipped spanning boundary (-30 min offset, 30 min duration)", duration: 30, offset: -30 },
              { description: "clipped extending past boundary (-30 min offset, 90 min duration)", duration: 90, offset: -30 },
              { description: "boundary-aligned minimum duration (0 min offset, 1 min duration)", duration: 1, offset: 0 },
              { description: "boundary-aligned standard duration (0 min offset, 30 min duration)", duration: 30, offset: 0 },
              { description: "boundary-aligned long duration (0 min offset, 90 min duration)", duration: 90, offset: 0 },
              { description: "future gutter with minimum duration (+20 min offset, 1 min duration)", duration: 1, offset: 20 },
              { description: "future gutter with standard duration (+20 min offset, 30 min duration)", duration: 30, offset: 20 },
            ];

            expect(geometryCases.length).toBe(8);
          });
        });
      `;

      const findings = checkHollowTests("src/utils/__tests__/buildRowSlots.test.ts", code);
      const fixtureFindings = findings.filter(
        (f) => f.rule === "test-fixture-scope" || f.rule === "hollow-tests/test-fixture-scope"
      );

      expect(fixtureFindings.length).toBeGreaterThan(0);
      expect(fixtureFindings[0]?.why).toContain("test scope");
    });

    it("allows small inline test data and module-level fixture declarations", async () => {
      const code = `
        import { describe, it, expect } from "vitest";

        const moduleFixtures = [
          { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }, { id: 6 }, { id: 7 }, { id: 8 }
        ];

        describe("buildRowSlots", () => {
          it("tests with small inline cases and module fixtures", () => {
            const inlineSmall = [1, 2, 3];
            expect(inlineSmall.length + moduleFixtures.length).toBe(11);
          });
        });
      `;

      const findings = checkHollowTests("src/utils/__tests__/buildRowSlots.test.ts", code);
      const fixtureFindings = findings.filter(
        (f) => f.rule === "test-fixture-scope" || f.rule === "hollow-tests/test-fixture-scope"
      );

      expect(fixtureFindings).toHaveLength(0);
    });
  });
  describe("Review Rules: Leaky conditional spread & Magic float assertions", () => {
    it("flags leaky conditional object spread checking !== undefined", async () => {
      const code = `
        export const extractData = (itemImage: string | null) => ({
          accentColor: "blue",
          ...(itemImage !== undefined ? { itemImage } : {}),
        });
      `;

      const findings = await checkWithEslint("src/utils/extractData.ts", code);
      const spreadFindings = findings.filter(
        (f) => f.rule === "code-smell/no-leaky-conditional-spread"
      );

      expect(spreadFindings.length).toBeGreaterThan(0);
      expect(spreadFindings[0]?.message).toContain("Leaky conditional object spread");
      expect(spreadFindings[0]?.why).toContain("Object spread hygiene");
    });

    it("does not flag conditional spread when variable cannot be null (clean omission of undefined)", async () => {
      const code = `
        export const buildTimeline = (selectedEnd?: string) => ({
          accentColor: "blue",
          ...(selectedEnd !== undefined ? { selectedEnd } : {}),
        });
      `;

      const findings = await checkWithEslint("src/utils/buildTimeline.ts", code);
      const spreadFindings = findings.filter(
        (f) => f.rule === "code-smell/no-leaky-conditional-spread"
      );

      expect(spreadFindings).toHaveLength(0);
    });

    it("does not flag conditional spread for explicit string | undefined type", async () => {
      const code = `
        export const buildTimeline = (selectedEnd: string | undefined) => ({
          accentColor: "blue",
          ...(selectedEnd !== undefined ? { selectedEnd } : {}),
        });
      `;

      const findings = await checkWithEslint("src/utils/buildTimeline.ts", code);
      const spreadFindings = findings.filter(
        (f) => f.rule === "code-smell/no-leaky-conditional-spread"
      );

      expect(spreadFindings).toHaveLength(0);
    });

    it("flags leaky conditional spread when variable type includes null in union", async () => {
      const code = `
        export const extractData = (itemImage: string | null | undefined) => ({
          accentColor: "blue",
          ...(itemImage !== undefined ? { itemImage } : {}),
        });
      `;

      const findings = await checkWithEslint("src/utils/extractData.ts", code);
      const spreadFindings = findings.filter(
        (f) => f.rule === "code-smell/no-leaky-conditional-spread"
      );

      expect(spreadFindings.length).toBeGreaterThan(0);
      expect(spreadFindings[0]?.message).toContain("Leaky conditional object spread");
    });

    it("flags magic float literals in test assertions", async () => {
      const code = `
        describe("EventRow", () => {
          it("calculates track width", () => {
            expect(parseFloat(track.style.width)).toBeCloseTo(658.8);
          });
        });
      `;

      const findings = await checkWithEslint("src/features/__tests__/item.test.tsx", code);
      const magicFloatFindings = findings.filter(
        (f) => f.rule === "test-hygiene/no-magic-float-assertions"
      );

      expect(magicFloatFindings.length).toBeGreaterThan(0);
      expect(magicFloatFindings[0]?.message).toContain("Magic float literal '658.8'");
      expect(magicFloatFindings[0]?.why).toContain("Test clarity");
    });

    it("flags test-title-contract-mismatch when title claims return value but only DOM or throws are checked", () => {
      const code = `
        describe("EventRow", () => {
          it("returns null if field is individually missing", () => {
            const { container } = render(<EventRow item={eventMock} />);
            expect(container.innerHTML).toBe("");
          });
        });
      `;

      const findings = checkHollowTests("src/features/__tests__/item.test.tsx", code);
      const mismatchFindings = findings.filter(
        (f) => f.rule === "test-title-contract-mismatch"
      );

      expect(mismatchFindings.length).toBeGreaterThan(0);
      expect(mismatchFindings[0]?.message).toContain("claims to verify returning 'null'");
    });

    it("flags redundant assertDefined calls immediately following getAllByTestId queries", () => {
      const code = `
        describe("EventRow", () => {
          it("applies slot wrapper positioning styles correctly across items", () => {
            render(<EventRow item={item} />);
            const slots = screen.getAllByTestId(/^event-slot-/);
            const firstSlot = slots[0];
            assertDefined(firstSlot);
            expect(firstSlot.style.left).toBe("0px");
          });
        });
      `;

      const findings = checkHollowTests("src/features/__tests__/item.test.tsx", code);
      const guardFindings = findings.filter(
        (f) => f.rule === "no-redundant-guard-assertion"
      );

      expect(guardFindings.length).toBeGreaterThan(0);
      expect(guardFindings[0]?.message).toContain("Redundant defensive guard assertion");
    });

    it("kills mutants for title-contract-mismatch with undefined, false, true and their valid assertions", () => {
      // Test when contract is satisfied for each type
      const okCode = `
        describe("contracts", () => {
          it("returns undefined when empty", () => {
            expect(fn()).toBeUndefined();
            expect(fn2()).toBe(undefined);
          });
          it("returns false on error", () => {
            expect(fn()).toBeFalsy();
            expect(fn2()).toBe(false);
          });
          it("returns true on success", () => {
            expect(fn()).toBeTruthy();
            expect(fn2()).toBe(true);
          });
          it("returns null on reset", () => {
            expect(fn()).toBeNull();
            expect(fn2()).toBe(null);
            expect(fn3()).toEqual(null);
          });
          it("regular test title without return contract", () => {
            expect(1).toBe(1);
          });
        });
      `;
      const okFindings = checkHollowTests("src/features/__tests__/ok.test.tsx", okCode);
      const mismatchOk = okFindings.filter((f) => f.rule === "test-title-contract-mismatch");
      expect(mismatchOk).toHaveLength(0);

      // Test when contract is broken for undefined, false, and true
      const brokenCode = `
        describe("broken", () => {
          test("returns undefined on error", () => {
            expect(container).toBeDefined();
          });
          it("return false on failure", () => {
            expect(container).toBeDefined();
          });
          it("returns true on valid input", () => {
            expect(container).toBeDefined();
          });
        });
      `;
      const brokenFindings = checkHollowTests("src/features/__tests__/broken.test.tsx", brokenCode);
      const brokenMismatches = brokenFindings.filter((f) => f.rule === "test-title-contract-mismatch");
      expect(brokenMismatches).toHaveLength(3);
      expect(brokenMismatches[0]?.message).toContain("claims to verify returning 'undefined'");
      expect(brokenMismatches[0]?.suggestion).toContain("toBeUndefined()");
      expect(brokenMismatches[1]?.message).toContain("claims to verify returning 'false'");
      expect(brokenMismatches[1]?.suggestion).toContain("toBe(false)");
      expect(brokenMismatches[2]?.message).toContain("claims to verify returning 'true'");
      expect(brokenMismatches[2]?.suggestion).toContain("toBe(true)");
    });

    it("kills mutants for redundant guard assertions with expect(x).toBeDefined() and queryAllBy", () => {
      const code = `
        describe("guards", () => {
          it("checks with toBeDefined and queryAllBy", () => {
            const items = queryAllByTestId("item");
            const target = items[1];
            expect(target).toBeDefined();
            expect(target.id).toBe("test");
          });
          it("handles guard on unrelated variable cleanly", () => {
            const items = getAllByTestId("item");
            const other = computeOther();
            assertDefined(other);
            expect(items.length).toBe(1);
          });
        });
      `;

      const findings = checkHollowTests("src/features/__tests__/guards.test.tsx", code);
      const guardFindings = findings.filter((f) => f.rule === "no-redundant-guard-assertion");
      expect(guardFindings).toHaveLength(1);
      expect(guardFindings[0]?.message).toContain("Redundant defensive guard assertion: 'target'");
      expect(guardFindings[0]?.message).toContain("items");
      expect(guardFindings[0]?.suggestion).toContain("assertDefined(target)");
    });
  });
});
