import { render, screen, waitFor, act } from "@testing-library/react";
import React from "react";
import { expect, it } from "vitest";

it("testing library anti-patterns", async () => {
  const { container, getByText } = render(<div><span>hello</span></div>);

  // no-container, no-node-access, prefer-screen-queries
  const child = container.firstChild;
  const queried = container.querySelector("span");
  getByText("hello");

  // prefer-presence-queries
  expect(screen.queryByText("hello")).toBeDefined();

  // await-async-queries
  screen.findByText("hello");

  // await-async-utils
  waitFor(() => {});

  // no-await-sync-queries
  await screen.getByText("hello");

  // no-unnecessary-act
  act(() => {
    screen.getByText("hello");
  });
});
