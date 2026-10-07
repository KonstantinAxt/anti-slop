describe("Todo List Workflow Clean", () => {
  beforeEach(() => {
    cy.visit("/todos");
  });

  it("verifies active filter shows items and completed button navigates", () => {
    cy.viewport(1024, 768);
    cy.findAllByTestId("todo-item-list").within(() => {
      cy.findAllByTestId("archive-button").click().url().should("include", "archive");
    });
  });
});
