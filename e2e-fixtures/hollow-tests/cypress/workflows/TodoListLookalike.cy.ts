describe("Todo List Workflow Lookalike", () => {
  it("verifies filters with only flag", () => {
    const config = { only: true };
    cy.wrap(config).should("deep.equal", { only: true });
  });
});
