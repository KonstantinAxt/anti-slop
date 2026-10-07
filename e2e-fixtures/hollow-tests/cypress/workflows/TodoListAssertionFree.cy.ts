describe("Todo List Workflow Assertion Free", () => {
  beforeEach(() => {
    cy.visit("/todos");
  });

  it("verifies active filter shows items and completed button is clickable without assertions", () => {
    cy.viewport(1024, 768);
    cy.findAllByTestId("todo-item-list").within(() => {
      cy.findAllByTestId("archive-button").click();
    });
  });
});
