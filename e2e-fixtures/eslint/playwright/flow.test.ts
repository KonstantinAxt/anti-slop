import { test, expect } from "@playwright/test";

test("playwright anti-patterns", async ({ page }) => {
  // missing-playwright-await
  expect(page.locator("button")).toBeVisible();

  // no-element-handle
  const handle = await page.$("button");

  // no-eval
  await page.$eval("button", (el) => el.textContent);

  // prefer-web-first-assertions
  expect(await page.locator("button").isVisible()).toBe(true);

  // no-conditional-in-test
  const flag = true;
  if (flag) {
    await page.click("button");
  }
});
